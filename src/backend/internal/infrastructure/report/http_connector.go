package report

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/agent-hub/backend/internal/model"
	"github.com/agent-hub/backend/internal/service"
)

var ErrCredentialsMissing = service.ErrReportCredentialsMissing

type Signer interface {
	Headers(ctx context.Context, source model.ReportDataSource, date time.Time, body []byte) (map[string]string, error)
}

// EnvSigner 只读取环境变量引用，避免把真实认证值写进数据库或响应。
type EnvSigner struct{}

func (EnvSigner) Headers(_ context.Context, source model.ReportDataSource, date time.Time, _ []byte) (map[string]string, error) {
	appKey := strings.TrimSpace(os.Getenv(source.AppKeyEnv))
	if appKey == "" {
		return nil, ErrCredentialsMissing
	}
	requestDate := date.UTC().Format(time.RFC3339)
	if source.XDateEnv != "" {
		requestDate = strings.TrimSpace(os.Getenv(source.XDateEnv))
		if requestDate == "" {
			return nil, ErrCredentialsMissing
		}
	}
	signature := strings.TrimSpace(os.Getenv(source.SignatureEnv))
	if source.AppSecretEnv != "" {
		appSecret := strings.TrimSpace(os.Getenv(source.AppSecretEnv))
		if appSecret != "" {
			toSign := strings.Join([]string{
				http.MethodPost,
				dataServiceURL(source),
				requestDate,
				appKey,
				"",
			}, "\n")
			mac := hmac.New(sha256.New, []byte(appSecret))
			_, _ = mac.Write([]byte(toSign))
			signature = base64.StdEncoding.EncodeToString(mac.Sum(nil))
		}
	}
	if signature == "" {
		return nil, ErrCredentialsMissing
	}
	return map[string]string{
		"x-app-key": appKey,
		"x-date":    requestDate,
		"sign":      signature,
	}, nil
}

func dataServiceURL(source model.ReportDataSource) string {
	return strings.TrimRight(source.Endpoint, "/") + "/dataservice/gateway/v1/api/" + url.PathEscape(source.APIName)
}

type HTTPConnector struct {
	client *http.Client
	signer Signer
}

func NewHTTPConnector(client *http.Client, signer Signer) *HTTPConnector {
	if client == nil {
		client = &http.Client{Timeout: 45 * time.Second}
	}
	if signer == nil {
		signer = EnvSigner{}
	}
	return &HTTPConnector{client: client, signer: signer}
}

func (c *HTTPConnector) Query(ctx context.Context, source model.ReportDataSource, query []byte) (model.ReportQueryResult, error) {
	base, err := url.Parse(strings.TrimRight(source.Endpoint, "/"))
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" {
		return model.ReportQueryResult{}, errors.New("数据源地址无效")
	}
	var body map[string]any
	if err := json.Unmarshal(query, &body); err != nil {
		return model.ReportQueryResult{}, fmt.Errorf("解析报表查询配置: %w", err)
	}
	body["apiName"] = source.APIName
	payload, err := json.Marshal(body)
	if err != nil {
		return model.ReportQueryResult{}, fmt.Errorf("编码报表查询: %w", err)
	}
	headers, err := c.signer.Headers(ctx, source, time.Now(), payload)
	if err != nil {
		return model.ReportQueryResult{}, err
	}
	requestURL := dataServiceURL(source)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(payload))
	if err != nil {
		return model.ReportQueryResult{}, fmt.Errorf("创建数据查询请求: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "data-service-sdk-v1")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	started := time.Now()
	resp, err := c.client.Do(req)
	if err != nil {
		return model.ReportQueryResult{}, fmt.Errorf("调用数据服务: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return model.ReportQueryResult{}, fmt.Errorf("数据服务返回 HTTP %d", resp.StatusCode)
	}
	var envelope struct {
		ResultCode string `json:"resultCode"`
		ReturnMsg  string `json:"returnMsg"`
		Data       struct {
			Rows       []map[string]any `json:"data"`
			Pagination struct {
				Total     int64 `json:"total"`
				PageSize  int   `json:"pageSize"`
				PageCount int   `json:"pageCount"`
				Page      int   `json:"page"`
			} `json:"paginationDTO"`
			QueryID      string         `json:"queryId"`
			MaxPartition map[string]any `json:"maxAccPartition"`
		} `json:"data"`
	}
	decoder := json.NewDecoder(resp.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&envelope); err != nil {
		return model.ReportQueryResult{}, fmt.Errorf("解析数据服务响应: %w", err)
	}
	if envelope.ResultCode != "0" {
		return model.ReportQueryResult{}, fmt.Errorf("数据服务查询失败: %s", envelope.ReturnMsg)
	}
	partition := ""
	if value, ok := envelope.Data.MaxPartition["dt"]; ok {
		partition = fmt.Sprint(value)
	}
	return model.ReportQueryResult{
		Rows: envelope.Data.Rows,
		Pagination: model.ReportPagination{
			Total: envelope.Data.Pagination.Total, Page: envelope.Data.Pagination.Page,
			PageSize: envelope.Data.Pagination.PageSize, PageCount: envelope.Data.Pagination.PageCount,
		},
		Partition: partition, QueryID: envelope.Data.QueryID, Duration: time.Since(started),
	}, nil
}
