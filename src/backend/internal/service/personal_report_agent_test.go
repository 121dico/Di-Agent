package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

const (
	testReportOwner        = "11111111-1111-4111-8111-111111111111"
	testReportSource       = "22222222-2222-4222-8222-222222222222"
	testReportQuery        = "33333333-3333-4333-8333-333333333333"
	testReportConversation = "55555555-5555-4555-8555-555555555555"
)

type personalReportStoreFake struct{ report *model.PersonalReport }

func (f *personalReportStoreFake) ListByOwner(context.Context, string) ([]model.PersonalReport, error) {
	return nil, nil
}
func (f *personalReportStoreFake) GetByID(context.Context, string) (*model.PersonalReport, error) {
	return f.report, nil
}
func (f *personalReportStoreFake) Create(_ context.Context, report *model.PersonalReport) error {
	f.report = report
	report.ID = "report-1"
	return nil
}
func (f *personalReportStoreFake) Update(_ context.Context, report *model.PersonalReport) error {
	f.report = report
	return nil
}
func (f *personalReportStoreFake) Delete(context.Context, string, string) (bool, error) {
	return true, nil
}

type personalReportReceiptFake struct {
	receipt  *model.ReportAgentQueryReceipt
	receipts map[string]*model.ReportAgentQueryReceipt
}

type personalReportConversationFake struct{ owner string }

func (f personalReportConversationFake) GetByID(_ context.Context, id string) (*model.Conversation, error) {
	if id != testReportConversation {
		return nil, nil
	}
	return &model.Conversation{ID: id, UserID: f.owner}, nil
}

func (f personalReportReceiptFake) GetByOwner(_ context.Context, owner, id string) (*model.ReportAgentQueryReceipt, error) {
	if f.receipts != nil {
		receipt := f.receipts[id]
		if receipt != nil && receipt.OwnerUserID == owner {
			return receipt, nil
		}
		return nil, nil
	}
	if f.receipt == nil || owner != f.receipt.OwnerUserID || id != f.receipt.ID {
		return nil, nil
	}
	return f.receipt, nil
}

func TestAgentPersonalReportHydratesMultipleQueries(t *testing.T) {
	metric := reportReceipt(`[{"user_count":123}]`, 1)
	metric.RequestJSON = json.RawMessage(`{"source_id":"` + testReportSource + `","fields":[{"name":"duid","alias":"user_count","aggregation":"COUNT DISTINCT"}]}`)
	trend := reportReceipt(`[{"dt":"2026-09-21","user_count":100},{"dt":"2026-09-22","user_count":123}]`, 2)
	trend.ID = "66666666-6666-4666-8666-666666666666"
	store := &personalReportStoreFake{}
	svc := NewPersonalReportService(store)
	svc.SetReceiptStore(personalReportReceiptFake{receipts: map[string]*model.ReportAgentQueryReceipt{metric.ID: metric, trend.ID: trend}})
	input := reportAgentInput()
	input.Document = json.RawMessage(`{"sections":[{"id":"overview","type":"metrics","title":"概览","metrics":[{"field":"user_count","label":"用户数"}]},{"id":"trend","type":"chart","title":"趋势","query_id":"` + trend.ID + `","chart_type":"line","x_field":"dt","series":[{"field":"user_count","label":"用户数"}]}]}`)
	report, err := svc.CreateAgent(context.Background(), testReportOwner, input)
	if err != nil {
		t.Fatal(err)
	}
	var document agentReportDocument
	if err := json.Unmarshal(report.DocumentJSON, &document); err != nil {
		t.Fatal(err)
	}
	if len(document.Sections) != 2 || len(document.Sections[0].Data.Rows) != 1 || len(document.Sections[1].Data.Rows) != 2 || document.Sections[1].Data.Rows[1]["user_count"] != float64(123) {
		t.Fatalf("multiple receipt bindings failed: %s", report.DocumentJSON)
	}
}

func reportReceipt(rows string, total int64) *model.ReportAgentQueryReceipt {
	request := model.ReportAgentQueryRequest{SourceID: testReportSource, Fields: []model.ReportAgentQueryField{
		{Name: "dt"}, {Name: "duid", Aggregation: "COUNT DISTINCT", Alias: "user_count"},
	}}
	requestJSON, _ := json.Marshal(request)
	paginationJSON, _ := json.Marshal(model.ReportPagination{Total: total, PageCount: 1})
	return &model.ReportAgentQueryReceipt{
		ID: testReportQuery, OwnerUserID: testReportOwner, SourceID: testReportSource,
		SourceName: "价敏 V1.3", SourcePartition: "2026-09-22", RequestJSON: requestJSON,
		RowsJSON: json.RawMessage(rows), PaginationJSON: paginationJSON, CreatedAt: time.Now(),
	}
}

func reportAgentInput() AgentPersonalReportInput {
	return AgentPersonalReportInput{
		Title: "V1.3 人群趋势", DataSourceID: testReportSource, QueryID: testReportQuery,
		Document: json.RawMessage(`{"template_id":"template-1","sections":[{"id":"trend","type":"chart","title":"人群趋势","chart_type":"line","x_field":"dt","series":[{"field":"user_count","label":"用户数"}],"data":{"rows":[{"dt":"伪造日期","user_count":999999}]}}]}`),
	}
}

func TestAgentPersonalReportHydratesOnlyServerRows(t *testing.T) {
	store := &personalReportStoreFake{}
	svc := NewPersonalReportService(store)
	svc.SetReceiptStore(personalReportReceiptFake{receipt: reportReceipt(`[{"dt":"2026-09-22","user_count":123}]`, 1)})
	report, err := svc.CreateAgent(context.Background(), testReportOwner, reportAgentInput())
	if err != nil {
		t.Fatal(err)
	}
	var document agentReportDocument
	if err := json.Unmarshal(report.DocumentJSON, &document); err != nil {
		t.Fatal(err)
	}
	if len(document.Sections) != 1 || document.Sections[0].Data.Rows[0]["user_count"] != float64(123) {
		t.Fatalf("report must use receipt rows, got %s", report.DocumentJSON)
	}
	if document.TemplateVersion != "1.0.0" || report.Status != model.PersonalReportSaved {
		t.Fatalf("unexpected template or status: %#v", report)
	}
	if report.OwnerUserID != testReportOwner {
		t.Fatalf("owner = %q", report.OwnerUserID)
	}
}

func TestAgentPersonalReportLocksTemplateAndDiscardsModelColors(t *testing.T) {
	store := &personalReportStoreFake{}
	svc := NewPersonalReportService(store)
	svc.SetReceiptStore(personalReportReceiptFake{receipt: reportReceipt(`[{"dt":"2026-09-22","user_count":123}]`, 1)})
	input := reportAgentInput()
	input.Document = json.RawMessage(`{"template_id":"template-1","template_version":"1.0.0","sections":[{"id":"trend","type":"chart","title":"趋势","chart_type":"line","x_field":"dt","series":[{"field":"user_count","label":"用户数","color":"#ff00ff"}]}]}`)
	report, err := svc.CreateAgent(context.Background(), testReportOwner, input)
	if err != nil {
		t.Fatal(err)
	}
	var document agentReportDocument
	if err := json.Unmarshal(report.DocumentJSON, &document); err != nil {
		t.Fatal(err)
	}
	if document.TemplateVersion != DefaultReportTemplateVersion || document.Sections[0].Series[0].Color != "" {
		t.Fatalf("model-controlled style leaked into stored template: %s", report.DocumentJSON)
	}
	input.Document = json.RawMessage(`{"template_id":"template-1","template_version":"9.9.9","sections":[{"id":"trend","type":"chart","title":"趋势","chart_type":"line","x_field":"dt","series":[{"field":"user_count","label":"用户数"}]}]}`)
	if _, err := svc.CreateAgent(context.Background(), testReportOwner, input); !errors.Is(err, ErrPersonalReportInvalid) {
		t.Fatalf("unsupported template version accepted: %v", err)
	}
}

func TestAgentPersonalReportAcceptsOnlyTrustedPreparedV12Dashboard(t *testing.T) {
	store := &personalReportStoreFake{}
	svc := NewPersonalReportService(store)
	receipt := reportReceipt(`[{"analytics":{"prepared":true,"data_date":"2026-09-22","trend":[{"dt":"2026-09-22","total_user_count":123}]}}]`, 1)
	receipt.RequestJSON = json.RawMessage(`{"source_id":"` + testReportSource + `","prepared_view":"v12_dashboard","fields":[{"name":"dt"}]}`)
	svc.SetReceiptStore(personalReportReceiptFake{receipt: receipt})
	input := reportAgentInput()
	input.Document = json.RawMessage(`{"template_id":"template-1","sections":[{"id":"v12_snapshot","type":"v12_dashboard","title":"价敏 V1.2"}]}`)
	report, err := svc.CreateAgent(context.Background(), testReportOwner, input)
	if err != nil {
		t.Fatal(err)
	}
	var document agentReportDocument
	if err := json.Unmarshal(report.DocumentJSON, &document); err != nil {
		t.Fatal(err)
	}
	if document.Sections[0].Data.Rows[0]["analytics"] == nil {
		t.Fatal("prepared analytics were not stored from the receipt")
	}
	receipt.RequestJSON = json.RawMessage(`{"source_id":"` + testReportSource + `","fields":[{"name":"dt"}]}`)
	_, err = svc.CreateAgent(context.Background(), testReportOwner, input)
	if !errors.Is(err, ErrPersonalReportInvalid) {
		t.Fatalf("ordinary query accepted as prepared dashboard: %v", err)
	}
}

func TestAgentPersonalReportRejectsOtherUsersReceipt(t *testing.T) {
	store := &personalReportStoreFake{}
	svc := NewPersonalReportService(store)
	svc.SetReceiptStore(personalReportReceiptFake{receipt: reportReceipt(`[{"dt":"2026-09-22","user_count":123}]`, 1)})
	_, err := svc.CreateAgent(context.Background(), "44444444-4444-4444-8444-444444444444", reportAgentInput())
	if !errors.Is(err, ErrPersonalReportInvalid) || store.report != nil {
		t.Fatalf("foreign receipt should be rejected, got %v", err)
	}
}

func TestAgentPersonalReportBindsOnlyOwnersConversation(t *testing.T) {
	store := &personalReportStoreFake{}
	svc := NewPersonalReportService(store)
	svc.SetReceiptStore(personalReportReceiptFake{receipt: reportReceipt(`[{"dt":"2026-09-22","user_count":123}]`, 1)})
	svc.SetConversationStore(personalReportConversationFake{owner: testReportOwner})
	input := reportAgentInput()
	input.ConversationID = testReportConversation
	report, err := svc.CreateAgent(context.Background(), testReportOwner, input)
	if err != nil || report.ConversationID == nil || *report.ConversationID != testReportConversation {
		t.Fatalf("owned conversation not bound: %#v %v", report, err)
	}
	svc.SetConversationStore(personalReportConversationFake{owner: "other-user"})
	_, err = svc.CreateAgent(context.Background(), testReportOwner, input)
	if !errors.Is(err, ErrPersonalReportForbidden) {
		t.Fatalf("foreign conversation accepted: %v", err)
	}
}

func TestAgentPersonalReportRejectsIncompleteChartPage(t *testing.T) {
	store := &personalReportStoreFake{}
	svc := NewPersonalReportService(store)
	svc.SetReceiptStore(personalReportReceiptFake{receipt: reportReceipt(`[{"dt":"2026-09-22","user_count":123}]`, 2)})
	_, err := svc.CreateAgent(context.Background(), testReportOwner, reportAgentInput())
	if !errors.Is(err, ErrPersonalReportInvalid) || store.report != nil {
		t.Fatalf("incomplete page should be rejected, got %v", err)
	}
}

func TestAgentPersonalReportRejectsMissingBoundField(t *testing.T) {
	store := &personalReportStoreFake{}
	svc := NewPersonalReportService(store)
	svc.SetReceiptStore(personalReportReceiptFake{receipt: reportReceipt(`[{"dt":"2026-09-22","other":123}]`, 1)})
	_, err := svc.CreateAgent(context.Background(), testReportOwner, reportAgentInput())
	if !errors.Is(err, ErrPersonalReportInvalid) || store.report != nil {
		t.Fatalf("missing bound field should be rejected, got %v", err)
	}
}

func TestPersonalReportRestCreateCannotForgeTemplateRows(t *testing.T) {
	store := &personalReportStoreFake{}
	svc := NewPersonalReportService(store)
	_, err := svc.Create(context.Background(), testReportOwner, model.PersonalReport{
		Title: "伪造", DocumentJSON: json.RawMessage(`{"template_id":"template-1","sections":[{"data":{"rows":[{"value":999}]}}]}`),
	})
	if !errors.Is(err, ErrPersonalReportInvalid) || store.report != nil {
		t.Fatalf("REST create should reject template data, got %v", err)
	}
}

func TestPersonalReportRestUpdatePreservesGeneratedEvidence(t *testing.T) {
	store := &personalReportStoreFake{}
	svc := NewPersonalReportService(store)
	svc.SetReceiptStore(personalReportReceiptFake{receipt: reportReceipt(`[{"dt":"2026-09-22","user_count":123}]`, 1)})
	created, err := svc.CreateAgent(context.Background(), testReportOwner, reportAgentInput())
	if err != nil {
		t.Fatal(err)
	}
	originalDocument := string(created.DocumentJSON)
	originalProvenance := string(created.ProvenanceJSON)
	updated, err := svc.Update(context.Background(), testReportOwner, created.ID, model.PersonalReport{
		Title: "重命名", DocumentJSON: json.RawMessage(`{"template_id":"template-1","sections":[{"data":{"rows":[{"value":999}]}}]}`),
		ProvenanceJSON: json.RawMessage(`{"query_id":"forged"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(updated.DocumentJSON) != originalDocument || string(updated.ProvenanceJSON) != originalProvenance {
		t.Fatalf("generated rows or provenance changed through REST update: %#v", updated)
	}
}
