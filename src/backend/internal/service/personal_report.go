package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/repository"
	"github.com/google/uuid"
)

var (
	ErrPersonalReportNotFound  = errors.New("个人报表不存在")
	ErrPersonalReportForbidden = errors.New("无权访问该个人报表")
	ErrPersonalReportInvalid   = errors.New("个人报表参数错误")
	personalReportSectionID    = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,63}$`)
)

type PersonalReportService struct {
	store         repository.PersonalReportStore
	receipts      personalReportReceiptReader
	conversations personalReportConversationReader
}

type personalReportReceiptReader interface {
	GetByOwner(context.Context, string, string) (*model.ReportAgentQueryReceipt, error)
}

type personalReportConversationReader interface {
	GetByID(context.Context, string) (*model.Conversation, error)
}

type AgentPersonalReportInput struct {
	Title          string          `json:"title"`
	Description    string          `json:"description"`
	DataSourceID   string          `json:"data_source_id"`
	ConversationID string          `json:"conversation_id,omitempty"`
	QueryID        string          `json:"query_id"`
	Document       json.RawMessage `json:"document"`
}

type agentReportField struct {
	Field  string `json:"field"`
	Label  string `json:"label"`
	Suffix string `json:"suffix,omitempty"`
	Color  string `json:"color,omitempty"`
}

type agentReportSection struct {
	ID         string             `json:"id"`
	Type       string             `json:"type"`
	Title      string             `json:"title"`
	QueryID    string             `json:"query_id,omitempty"`
	ChartType  string             `json:"chart_type,omitempty"`
	XField     string             `json:"x_field,omitempty"`
	LabelField string             `json:"label_field,omitempty"`
	ValueField string             `json:"value_field,omitempty"`
	Metrics    []agentReportField `json:"metrics,omitempty"`
	Series     []agentReportField `json:"series,omitempty"`
	Columns    []agentReportField `json:"columns,omitempty"`
	Data       struct {
		Rows       []map[string]any       `json:"rows"`
		Pagination model.ReportPagination `json:"pagination"`
	} `json:"data"`
}

type agentReportDocument struct {
	TemplateID      string               `json:"template_id"`
	TemplateVersion string               `json:"template_version"`
	Sections        []agentReportSection `json:"sections"`
}

func NewPersonalReportService(store repository.PersonalReportStore) *PersonalReportService {
	return &PersonalReportService{store: store}
}

func (s *PersonalReportService) SetReceiptStore(store personalReportReceiptReader) {
	s.receipts = store
}

func (s *PersonalReportService) SetConversationStore(store personalReportConversationReader) {
	s.conversations = store
}

// CreateAgent replaces every model-provided data payload with the server's
// owner-scoped query receipt. The model selects chart bindings; it cannot set
// the displayed numbers, provenance, or template implementation.
func (s *PersonalReportService) CreateAgent(ctx context.Context, ownerUserID string, input AgentPersonalReportInput) (*model.PersonalReport, error) {
	if s.receipts == nil || strings.TrimSpace(ownerUserID) == "" || strings.TrimSpace(input.QueryID) == "" || strings.TrimSpace(input.DataSourceID) == "" {
		return nil, ErrPersonalReportInvalid
	}
	if _, err := uuid.Parse(input.QueryID); err != nil {
		return nil, ErrPersonalReportInvalid
	}
	var conversationID *string
	if input.ConversationID != "" {
		if s.conversations == nil {
			return nil, ErrPersonalReportInvalid
		}
		if _, err := uuid.Parse(input.ConversationID); err != nil {
			return nil, ErrPersonalReportInvalid
		}
		conversation, err := s.conversations.GetByID(ctx, input.ConversationID)
		if err != nil {
			return nil, err
		}
		if conversation == nil || conversation.UserID != ownerUserID {
			return nil, ErrPersonalReportForbidden
		}
		conversationID = &input.ConversationID
	}
	var document agentReportDocument
	if err := json.Unmarshal(input.Document, &document); err != nil {
		return nil, ErrPersonalReportInvalid
	}
	if document.TemplateID == "" {
		document.TemplateID = DefaultReportTemplateID
	}
	if document.TemplateID != DefaultReportTemplateID || (document.TemplateVersion != "" && document.TemplateVersion != DefaultReportTemplateVersion) || len(document.Sections) == 0 || len(document.Sections) > 16 {
		return nil, fmt.Errorf("%w: 模板或板块配置无效", ErrPersonalReportInvalid)
	}
	for _, section := range document.Sections {
		if section.Type == "v12_dashboard" && len(document.Sections) != 1 {
			return nil, fmt.Errorf("%w: V1.2 固定板块不能混用通用板块", ErrPersonalReportInvalid)
		}
	}
	document.TemplateVersion = DefaultReportTemplateVersion
	seenSections := map[string]bool{}
	seenReceipts := map[string]*model.ReportAgentQueryReceipt{}
	queryIDs := make([]string, 0, len(document.Sections))
	var primary *model.ReportAgentQueryReceipt
	for index := range document.Sections {
		section := &document.Sections[index]
		section.ID = strings.TrimSpace(section.ID)
		section.Title = strings.TrimSpace(section.Title)
		if !personalReportSectionID.MatchString(section.ID) || section.Title == "" || len([]rune(section.Title)) > 100 || seenSections[section.ID] {
			return nil, fmt.Errorf("%w: 报表板块 ID 或标题无效", ErrPersonalReportInvalid)
		}
		seenSections[section.ID] = true
		if section.QueryID == "" {
			section.QueryID = input.QueryID
		}
		if _, err := uuid.Parse(section.QueryID); err != nil {
			return nil, ErrPersonalReportInvalid
		}
		receipt := seenReceipts[section.QueryID]
		if receipt == nil {
			var err error
			receipt, err = s.receipts.GetByOwner(ctx, ownerUserID, section.QueryID)
			if err != nil {
				return nil, err
			}
			if receipt == nil || receipt.SourceID != input.DataSourceID || time.Since(receipt.CreatedAt) > 24*time.Hour || time.Until(receipt.CreatedAt) > time.Minute {
				return nil, fmt.Errorf("%w: 查询凭证不存在、已过期或与数据源不符", ErrPersonalReportInvalid)
			}
			seenReceipts[section.QueryID] = receipt
			queryIDs = append(queryIDs, section.QueryID)
		}
		if section.QueryID == input.QueryID {
			primary = receipt
		}
		var rows []map[string]any
		if err := json.Unmarshal(receipt.RowsJSON, &rows); err != nil {
			return nil, ErrPersonalReportInvalid
		}
		var pagination model.ReportPagination
		if err := json.Unmarshal(receipt.PaginationJSON, &pagination); err != nil {
			return nil, ErrPersonalReportInvalid
		}
		if err := validateAgentReportSection(section, receipt.RequestJSON, rows, pagination); err != nil {
			return nil, err
		}
		for i := range section.Metrics {
			section.Metrics[i].Color = ""
		}
		for i := range section.Series {
			section.Series[i].Color = ""
		}
		for i := range section.Columns {
			section.Columns[i].Color = ""
		}
		section.Data.Rows = rows
		section.Data.Pagination = pagination
	}
	if primary == nil {
		return nil, fmt.Errorf("%w: 主查询凭证未用于报表", ErrPersonalReportInvalid)
	}
	encodedDocument, err := json.Marshal(document)
	if err != nil {
		return nil, err
	}
	encodedQuery, err := json.Marshal(map[string]any{"query_ids": queryIDs})
	if err != nil {
		return nil, err
	}
	encodedProvenance, err := json.Marshal(map[string]any{
		"source_name": primary.SourceName, "source_partition": primary.SourcePartition,
		"query_id": primary.ID, "query_ids": queryIDs, "queried_at": primary.CreatedAt,
		"upstream_query_id": primary.UpstreamQueryID, "duration_ms": primary.DurationMS,
	})
	if err != nil {
		return nil, err
	}
	sourceID := input.DataSourceID
	return s.create(ctx, ownerUserID, model.PersonalReport{
		Title: input.Title, Description: input.Description, DataSourceID: &sourceID, ConversationID: conversationID,
		Status: model.PersonalReportSaved, StylePreset: "business", QueryJSON: encodedQuery,
		DocumentJSON: encodedDocument, ProvenanceJSON: encodedProvenance,
	})
}

func validateAgentReportSection(section *agentReportSection, requestJSON json.RawMessage, rows []map[string]any, pagination model.ReportPagination) error {
	var request model.ReportAgentQueryRequest
	if err := json.Unmarshal(requestJSON, &request); err != nil {
		return ErrPersonalReportInvalid
	}
	available := map[string]bool{}
	for _, field := range request.Fields {
		key := field.Alias
		if key == "" {
			key = field.Name
		}
		available[key] = true
	}
	check := func(field string) bool { return field != "" && available[field] }
	bound := []string{}
	switch section.Type {
	case "v12_dashboard":
		if request.PreparedView != "v12_dashboard" || len(rows) != 1 || pagination.Total != 1 {
			return fmt.Errorf("%w: V1.2 板块必须引用完整预计算快照", ErrPersonalReportInvalid)
		}
		encoded, err := json.Marshal(rows[0]["analytics"])
		if err != nil {
			return ErrPersonalReportInvalid
		}
		var snapshot model.ReportAnalyticsResult
		if err := json.Unmarshal(encoded, &snapshot); err != nil || !snapshot.Prepared || snapshot.DataDate == "" || len(snapshot.Trend) == 0 {
			return fmt.Errorf("%w: V1.2 预计算快照缺失", ErrPersonalReportInvalid)
		}
	case "metric", "metrics":
		if len(section.Metrics) == 0 || len(section.Metrics) > 8 {
			return ErrPersonalReportInvalid
		}
		if len(rows) > 1 || pagination.Total > 1 {
			return fmt.Errorf("%w: 指标查询必须只返回一行", ErrPersonalReportInvalid)
		}
		for _, item := range section.Metrics {
			if !check(item.Field) || item.Label == "" {
				return ErrPersonalReportInvalid
			}
			bound = append(bound, item.Field)
		}
	case "chart":
		if pagination.Total > int64(len(rows)) || pagination.PageCount > 1 {
			return fmt.Errorf("%w: 图表查询结果分页不完整", ErrPersonalReportInvalid)
		}
		switch section.ChartType {
		case "line", "bar":
			if !check(section.XField) || len(section.Series) == 0 || len(section.Series) > 5 {
				return ErrPersonalReportInvalid
			}
			bound = append(bound, section.XField)
			if section.ChartType == "bar" && len(section.Series) != 1 {
				return ErrPersonalReportInvalid
			}
			for _, item := range section.Series {
				if !check(item.Field) || item.Label == "" {
					return ErrPersonalReportInvalid
				}
				bound = append(bound, item.Field)
			}
		case "donut":
			if !check(section.LabelField) || !check(section.ValueField) {
				return ErrPersonalReportInvalid
			}
			bound = append(bound, section.LabelField, section.ValueField)
		default:
			return ErrPersonalReportInvalid
		}
	case "table":
		if len(section.Columns) == 0 || len(section.Columns) > 30 {
			return ErrPersonalReportInvalid
		}
		for _, item := range section.Columns {
			if !check(item.Field) || item.Label == "" {
				return ErrPersonalReportInvalid
			}
			bound = append(bound, item.Field)
		}
	default:
		return ErrPersonalReportInvalid
	}
	// Verify every requested numeric chart value before storing; missing values
	// remain unavailable rather than silently becoming zero.
	numeric := []string{}
	if section.Type == "metric" || section.Type == "metrics" {
		for _, item := range section.Metrics {
			numeric = append(numeric, item.Field)
		}
	}
	if section.Type == "chart" {
		if section.ChartType == "donut" {
			numeric = append(numeric, section.ValueField)
		} else {
			for _, item := range section.Series {
				numeric = append(numeric, item.Field)
			}
		}
	}
	for _, row := range rows {
		for _, field := range bound {
			if _, ok := row[field]; !ok {
				return fmt.Errorf("%w: 查询结果缺少字段 %s", ErrPersonalReportInvalid, field)
			}
		}
		for _, field := range numeric {
			value := row[field]
			if value == nil || value == "" {
				continue
			}
			switch value.(type) {
			case float64, json.Number, int, int64:
			default:
				return fmt.Errorf("%w: 图表字段 %s 含非数值", ErrPersonalReportInvalid, field)
			}
			if section.ChartType == "donut" && numericValueIsNegative(value) {
				return fmt.Errorf("%w: 环图不能显示负值", ErrPersonalReportInvalid)
			}
		}
	}
	return nil
}

func numericValueIsNegative(value any) bool {
	switch n := value.(type) {
	case float64:
		return n < 0
	case int:
		return n < 0
	case int64:
		return n < 0
	case json.Number:
		f, err := n.Float64()
		return err == nil && f < 0
	}
	return false
}

func (s *PersonalReportService) List(ctx context.Context, ownerUserID string) ([]model.PersonalReport, error) {
	return s.store.ListByOwner(ctx, ownerUserID)
}

func (s *PersonalReportService) Get(ctx context.Context, ownerUserID, id string) (*model.PersonalReport, error) {
	report, err := s.store.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if report == nil {
		return nil, ErrPersonalReportNotFound
	}
	if report.OwnerUserID != ownerUserID {
		return nil, ErrPersonalReportForbidden
	}
	return report, nil
}

func (s *PersonalReportService) Create(ctx context.Context, ownerUserID string, input model.PersonalReport) (*model.PersonalReport, error) {
	var generated struct {
		TemplateID string `json:"template_id"`
	}
	if json.Unmarshal(input.DocumentJSON, &generated) == nil && generated.TemplateID != "" {
		// Only CreateAgent may persist a template-backed report. That path binds
		// every data row to an owner-scoped server query receipt.
		return nil, ErrPersonalReportInvalid
	}
	return s.create(ctx, ownerUserID, input)
}

func (s *PersonalReportService) create(ctx context.Context, ownerUserID string, input model.PersonalReport) (*model.PersonalReport, error) {
	input.OwnerUserID = ownerUserID
	if err := normalizePersonalReport(&input); err != nil {
		return nil, err
	}
	if err := s.store.Create(ctx, &input); err != nil {
		return nil, err
	}
	return &input, nil
}

func (s *PersonalReportService) Update(ctx context.Context, ownerUserID, id string, input model.PersonalReport) (*model.PersonalReport, error) {
	existing, err := s.store.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, ErrPersonalReportNotFound
	}
	if existing.OwnerUserID != ownerUserID {
		return nil, ErrPersonalReportForbidden
	}
	input.ID = id
	input.OwnerUserID = ownerUserID
	input.CreatedAt = existing.CreatedAt
	var generated struct {
		TemplateID string `json:"template_id"`
	}
	if json.Unmarshal(existing.DocumentJSON, &generated) == nil && generated.TemplateID != "" {
		// A direct REST update may edit the title, but it cannot replace the
		// server-hydrated rows or provenance with model/user-supplied numbers.
		input.DataSourceID = existing.DataSourceID
		input.Status = existing.Status
		input.StylePreset = existing.StylePreset
		input.StylePrompt = existing.StylePrompt
		input.QueryJSON = existing.QueryJSON
		input.DocumentJSON = existing.DocumentJSON
		input.ProvenanceJSON = existing.ProvenanceJSON
	}
	if err := normalizePersonalReport(&input); err != nil {
		return nil, err
	}
	if err := s.store.Update(ctx, &input); err != nil {
		return nil, err
	}
	return &input, nil
}

func (s *PersonalReportService) Delete(ctx context.Context, ownerUserID, id string) error {
	existing, err := s.store.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if existing == nil {
		return ErrPersonalReportNotFound
	}
	if existing.OwnerUserID != ownerUserID {
		return ErrPersonalReportForbidden
	}
	deleted, err := s.store.Delete(ctx, id, ownerUserID)
	if err != nil {
		return err
	}
	if !deleted {
		return ErrPersonalReportNotFound
	}
	return nil
}

func normalizePersonalReport(report *model.PersonalReport) error {
	report.Title = strings.TrimSpace(report.Title)
	if report.Title == "" || len([]rune(report.Title)) > 180 {
		return ErrPersonalReportInvalid
	}
	report.Description = strings.TrimSpace(report.Description)
	if report.Status == "" {
		report.Status = model.PersonalReportDraft
	}
	switch report.Status {
	case model.PersonalReportDraft, model.PersonalReportSaved, model.PersonalReportFailed:
	default:
		return ErrPersonalReportInvalid
	}
	report.StylePreset = strings.TrimSpace(report.StylePreset)
	if report.StylePreset == "" {
		report.StylePreset = "balanced"
	}
	var err error
	report.QueryJSON, err = normalizeJSONObject(report.QueryJSON)
	if err != nil {
		return ErrPersonalReportInvalid
	}
	report.DocumentJSON, err = normalizeJSONObjectWithDefault(report.DocumentJSON, json.RawMessage(`{"sections":[]}`))
	if err != nil {
		return ErrPersonalReportInvalid
	}
	report.ProvenanceJSON, err = normalizeJSONObject(report.ProvenanceJSON)
	if err != nil {
		return ErrPersonalReportInvalid
	}
	return nil
}

func normalizeJSONObject(raw json.RawMessage) (json.RawMessage, error) {
	return normalizeJSONObjectWithDefault(raw, json.RawMessage(`{}`))
}

func normalizeJSONObjectWithDefault(raw, fallback json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback, nil
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return raw, nil
}
