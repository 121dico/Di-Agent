package rag

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const maxOllamaErrorBody = 4096

type OllamaEmbedder struct {
	baseURL    string
	model      string
	dimensions int
	client     *http.Client
}

func NewOllamaEmbedder(baseURL, model string, dimensions int, client *http.Client) *OllamaEmbedder {
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	return &OllamaEmbedder{
		baseURL:    strings.TrimRight(baseURL, "/"),
		model:      model,
		dimensions: dimensions,
		client:     client,
	}
}

func (e *OllamaEmbedder) Model() string { return e.model }

func (e *OllamaEmbedder) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	if len(inputs) == 0 {
		return [][]float32{}, nil
	}
	payload, err := json.Marshal(struct {
		Model string   `json:"model"`
		Input []string `json:"input"`
	}{Model: e.model, Input: inputs})
	if err != nil {
		return nil, fmt.Errorf("marshal ollama embed request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.baseURL+"/api/embed", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create ollama embed request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call ollama embed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, maxOllamaErrorBody))
		if readErr != nil {
			return nil, fmt.Errorf("ollama embed returned %s and error body could not be read: %w", resp.Status, readErr)
		}
		return nil, fmt.Errorf("ollama embed returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}

	var decoded struct {
		Embeddings [][]float32 `json:"embeddings"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<20)).Decode(&decoded); err != nil {
		return nil, fmt.Errorf("decode ollama embed response: %w", err)
	}
	if len(decoded.Embeddings) != len(inputs) {
		return nil, fmt.Errorf("%w: ollama returned %d vectors for %d inputs", ErrInvalidEmbedding, len(decoded.Embeddings), len(inputs))
	}
	for i, embedding := range decoded.Embeddings {
		if len(embedding) == 0 {
			return nil, fmt.Errorf("%w: ollama vector %d is empty", ErrInvalidEmbedding, i)
		}
		if e.dimensions > 0 && len(embedding) != e.dimensions {
			return nil, fmt.Errorf("%w: ollama vector %d has %d dimensions, want %d", ErrInvalidEmbedding, i, len(embedding), e.dimensions)
		}
	}
	return decoded.Embeddings, nil
}
