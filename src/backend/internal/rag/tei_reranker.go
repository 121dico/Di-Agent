package rag

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"
)

const maxTEIErrorBody = 4096

// TEIReranker implements Hugging Face Text Embeddings Inference /rerank.
// The model is loaded by the TEI process; model is retained for observability.
type TEIReranker struct {
	baseURL string
	model   string
	client  *http.Client
}

func NewTEIReranker(baseURL, model string, client *http.Client) *TEIReranker {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &TEIReranker{baseURL: strings.TrimRight(baseURL, "/"), model: strings.TrimSpace(model), client: client}
}

func (r *TEIReranker) Model() string { return r.model }

func (r *TEIReranker) Rerank(ctx context.Context, query string, texts []string) ([]RerankResult, error) {
	if len(texts) == 0 {
		return []RerankResult{}, nil
	}
	payload, err := json.Marshal(struct {
		Query     string   `json:"query"`
		Texts     []string `json:"texts"`
		RawScores bool     `json:"raw_scores"`
	}{Query: query, Texts: texts, RawScores: false})
	if err != nil {
		return nil, fmt.Errorf("marshal TEI rerank request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.baseURL+"/rerank", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create TEI rerank request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := r.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call TEI reranker: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, maxTEIErrorBody))
		if readErr != nil {
			return nil, fmt.Errorf("TEI reranker returned %s and error body could not be read: %w", resp.Status, readErr)
		}
		return nil, fmt.Errorf("TEI reranker returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var wireResults []struct {
		Index *int     `json:"index"`
		Score *float64 `json:"score"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 16<<20)).Decode(&wireResults); err != nil {
		return nil, fmt.Errorf("decode TEI rerank response: %w", err)
	}
	if len(wireResults) != len(texts) {
		return nil, fmt.Errorf("%w: TEI returned %d results for %d texts", ErrInvalidRerank, len(wireResults), len(texts))
	}
	results := make([]RerankResult, len(wireResults))
	seen := make([]bool, len(texts))
	for position, wire := range wireResults {
		if wire.Index == nil || wire.Score == nil {
			return nil, fmt.Errorf("%w: result %d is missing index or score", ErrInvalidRerank, position)
		}
		result := RerankResult{Index: *wire.Index, Score: *wire.Score}
		if result.Index < 0 || result.Index >= len(texts) {
			return nil, fmt.Errorf("%w: result %d has out-of-range index %d", ErrInvalidRerank, position, result.Index)
		}
		if seen[result.Index] {
			return nil, fmt.Errorf("%w: duplicate index %d", ErrInvalidRerank, result.Index)
		}
		if math.IsNaN(result.Score) || math.IsInf(result.Score, 0) {
			return nil, fmt.Errorf("%w: result %d score is not finite", ErrInvalidRerank, position)
		}
		seen[result.Index] = true
		results[position] = result
	}
	for index, present := range seen {
		if !present {
			return nil, fmt.Errorf("%w: missing index %d", ErrInvalidRerank, index)
		}
	}
	return results, nil
}
