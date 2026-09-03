package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/repository"
)

var (
	ErrPersonalReportNotFound  = errors.New("个人报表不存在")
	ErrPersonalReportForbidden = errors.New("无权访问该个人报表")
	ErrPersonalReportInvalid   = errors.New("个人报表参数错误")
)

type PersonalReportService struct {
	store repository.PersonalReportStore
}

func NewPersonalReportService(store repository.PersonalReportStore) *PersonalReportService {
	return &PersonalReportService{store: store}
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
