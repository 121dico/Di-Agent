package service

import (
	"context"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	ErrDataMapNotConfigured = errors.New("数据地图凭据尚未配置")
	ErrDataMapForbidden     = errors.New("当前账号无权使用数据地图试点凭据")
	ErrDataMapInvalid       = errors.New("数据地图检索参数无效")
	ErrDataMapUnavailable   = errors.New("数据地图接口暂时不可用")
	ErrDataMapProtocol      = errors.New("数据地图返回格式尚未验证")
	dataMapIdentifier       = regexp.MustCompile(`^[A-Za-z0-9_]{1,128}$`)
)

const (
	dataMapSearchPath    = "/dp_metadata_api/hive/table/pageByPrefix"
	dataMapResponseLimit = 256 << 10
	dataMapMinInterval   = 1100 * time.Millisecond // 个人配额低于 1 QPS；单进程中串行预约。
)

type DataMapConfig struct {
	BaseURL     string
	ClientID    string
	Token       string
	OwnerUserID string
}

type DataMapHiveSearch struct {
	DBName   string `json:"db_name"`
	Prefix   string `json:"prefix"`
	PageNo   int    `json:"page_no"`
	PageSize int    `json:"page_size"`
}

type DataMapHiveTable struct {
	DBName    string `json:"db_name"`
	TableName string `json:"table_name"`
}

type DataMapHiveSearchResult struct {
	Source           string             `json:"source"`
	Capability       string             `json:"capability"`
	Endpoint         string             `json:"endpoint"`
	Query            DataMapHiveSearch  `json:"query"`
	Tables           []DataMapHiveTable `json:"tables"`
	HasPrefixMatches bool               `json:"has_prefix_matches"`
	ResultScope      string             `json:"result_scope"`
}

type DataMapStatus struct {
	Status     string `json:"status"`
	Capability string `json:"capability"`
}

type DataMapService struct {
	config     DataMapConfig
	baseURL    *url.URL
	client     *http.Client
	now        func() time.Time
	mu         sync.Mutex
	nextCall   time.Time
	lastStatus string
	lastCheck  time.Time
}

func NewDataMapService(config DataMapConfig, client *http.Client, now func() time.Time) *DataMapService {
	config.BaseURL = strings.TrimSpace(config.BaseURL)
	config.ClientID = strings.TrimSpace(config.ClientID)
	config.OwnerUserID = strings.TrimSpace(config.OwnerUserID)
	if client == nil {
		client = &http.Client{Timeout: 6 * time.Second}
	}
	// 签名头不能随 3xx 跳转到另一个目标；复制 client，避免改动调用方的 HTTP 设置。
	safeClient := *client
	safeClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	if now == nil {
		now = time.Now
	}
	s := &DataMapService{config: config, client: &safeClient, now: now}
	if config.BaseURL == "" || config.ClientID == "" || config.Token == "" || config.OwnerUserID == "" {
		return s
	}
	parsed, err := url.Parse(config.BaseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || (parsed.Path != "" && parsed.Path != "/") {
		return s
	}
	s.baseURL = parsed
	return s
}

func (s *DataMapService) Status(userID string) DataMapStatus {
	status := DataMapStatus{Status: "not_configured", Capability: "hive_table_metadata_only"}
	if s.baseURL == nil {
		return status
	}
	if userID == "" || userID != s.config.OwnerUserID {
		status.Status = "no_permission"
		return status
	}
	s.mu.Lock()
	status.Status = s.lastStatus
	lastCheck := s.lastCheck
	s.mu.Unlock()
	if status.Status == "" || (status.Status == "connected" && s.now().Sub(lastCheck) > 5*time.Minute) {
		status.Status = "configured_unverified"
	}
	return status
}

func (s *DataMapService) SearchHiveTables(ctx context.Context, userID string, input DataMapHiveSearch) (*DataMapHiveSearchResult, error) {
	if s.baseURL == nil {
		return nil, ErrDataMapNotConfigured
	}
	if userID == "" || userID != s.config.OwnerUserID {
		return nil, ErrDataMapForbidden
	}
	input.DBName = strings.TrimSpace(input.DBName)
	input.Prefix = strings.TrimSpace(input.Prefix)
	if input.PageNo == 0 {
		input.PageNo = 1
	}
	if input.PageSize == 0 {
		input.PageSize = 10
	}
	if !dataMapIdentifier.MatchString(input.Prefix) || (input.DBName != "" && !dataMapIdentifier.MatchString(input.DBName)) || input.PageNo < 1 || input.PageNo > 1000 || input.PageSize < 1 || input.PageSize > 20 {
		return nil, ErrDataMapInvalid
	}
	if err := s.waitForQuota(ctx); err != nil {
		return nil, fmt.Errorf("wait for data map quota: %w", ErrDataMapUnavailable)
	}
	requestURL := *s.baseURL
	requestURL.Path = dataMapSearchPath
	query := requestURL.Query()
	query.Set("prefix", input.Prefix)
	query.Set("pageNo", strconv.Itoa(input.PageNo))
	query.Set("pageSize", strconv.Itoa(input.PageSize))
	if input.DBName != "" {
		query.Set("dbName", input.DBName)
	}
	requestURL.RawQuery = query.Encode()
	requestCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build data map request: %w", ErrDataMapUnavailable)
	}
	timestamp := strconv.FormatInt(s.now().UnixMilli(), 10)
	req.Header.Set("client", s.config.ClientID)
	req.Header.Set("timeStamp", timestamp)
	req.Header.Set("sign", dataMapSign(timestamp, s.config.Token))
	resp, err := s.client.Do(req)
	if err != nil {
		s.markStatus("temporarily_unavailable")
		return nil, fmt.Errorf("request data map: %w", ErrDataMapUnavailable)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		s.markStatus("no_permission")
		return nil, ErrDataMapForbidden
	}
	if resp.StatusCode != http.StatusOK {
		s.markStatus("temporarily_unavailable")
		return nil, ErrDataMapUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, dataMapResponseLimit+1))
	if err != nil || len(body) > dataMapResponseLimit {
		s.markStatus("temporarily_unavailable")
		return nil, ErrDataMapProtocol
	}
	tables, err := parseDataMapHiveTables(body, input)
	if err != nil {
		if errors.Is(err, ErrDataMapForbidden) {
			s.markStatus("no_permission")
		} else {
			s.markStatus("temporarily_unavailable")
		}
		return nil, err
	}
	s.markStatus("connected")
	return &DataMapHiveSearchResult{
		Source: "data_map", Capability: "hive_table_metadata_only", Endpoint: dataMapSearchPath,
		Query: input, Tables: tables, HasPrefixMatches: len(tables) > 0, ResultScope: "requested_prefix_page",
	}, nil
}

func (s *DataMapService) waitForQuota(ctx context.Context) error {
	s.mu.Lock()
	now := time.Now()
	callAt := now
	if s.nextCall.After(now) {
		callAt = s.nextCall
	}
	if callAt.Sub(now) > 5*time.Second {
		s.mu.Unlock()
		return ErrDataMapUnavailable
	}
	s.nextCall = callAt.Add(dataMapMinInterval)
	s.mu.Unlock()
	if delay := time.Until(callAt); delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
		}
	}
	return nil
}

func (s *DataMapService) markStatus(status string) {
	s.mu.Lock()
	s.lastStatus = status
	s.lastCheck = s.now()
	s.mu.Unlock()
}

func dataMapSign(timestamp, token string) string {
	encoded := base64.StdEncoding.EncodeToString([]byte(timestamp))
	sum := md5.Sum([]byte(encoded + ":" + token))
	return hex.EncodeToString(sum[:])
}

func parseDataMapHiveTables(body []byte, input DataMapHiveSearch) ([]DataMapHiveTable, error) {
	// 官方文档明确 meta.code=0；列表字段尚待实测，因此只接受明确的 data.list 资产标识。
	var envelope struct {
		Meta struct {
			Code *int `json:"code"`
		} `json:"meta"`
		Data struct {
			List *[]struct {
				DBName    string `json:"dbName"`
				TableName string `json:"tableName"`
			} `json:"list"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil || envelope.Meta.Code == nil {
		return nil, ErrDataMapProtocol
	}
	if *envelope.Meta.Code != 0 {
		if *envelope.Meta.Code == 401 || *envelope.Meta.Code == 403 {
			return nil, ErrDataMapForbidden
		}
		return nil, ErrDataMapUnavailable
	}
	if envelope.Data.List == nil || len(*envelope.Data.List) > input.PageSize {
		return nil, ErrDataMapProtocol
	}
	tables := make([]DataMapHiveTable, 0, len(*envelope.Data.List))
	for _, row := range *envelope.Data.List {
		if !dataMapIdentifier.MatchString(row.DBName) || !dataMapIdentifier.MatchString(row.TableName) || (input.DBName != "" && !strings.EqualFold(input.DBName, row.DBName)) || !strings.HasPrefix(strings.ToLower(row.TableName), strings.ToLower(input.Prefix)) {
			return nil, ErrDataMapProtocol
		}
		tables = append(tables, DataMapHiveTable{DBName: row.DBName, TableName: row.TableName})
	}
	return tables, nil
}
