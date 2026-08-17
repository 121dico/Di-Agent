package rag

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestTEIRerankerProtocolAndMapping(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/rerank" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		var request struct {
			Query     string   `json:"query"`
			Texts     []string `json:"texts"`
			RawScores *bool    `json:"raw_scores"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request.Query != "original question" || !reflect.DeepEqual(request.Texts, []string{"first", "second"}) {
			t.Errorf("unexpected request: %+v", request)
		}
		if request.RawScores == nil || *request.RawScores {
			t.Errorf("raw_scores must be explicitly false: %+v", request.RawScores)
		}
		_ = json.NewEncoder(w).Encode([]RerankResult{{Index: 1, Score: 0.9}, {Index: 0, Score: 0.2}})
	}))
	t.Cleanup(server.Close)

	reranker := NewTEIReranker(server.URL+"/", "BAAI/bge-reranker-v2-m3", server.Client())
	results, err := reranker.Rerank(context.Background(), "original question", []string{"first", "second"})
	if err != nil {
		t.Fatalf("Rerank() error = %v", err)
	}
	if reranker.Model() != "BAAI/bge-reranker-v2-m3" || !reflect.DeepEqual(results, []RerankResult{{Index: 1, Score: 0.9}, {Index: 0, Score: 0.2}}) {
		t.Fatalf("unexpected reranker output: model=%q results=%+v", reranker.Model(), results)
	}
}

func TestTEIRerankerRejectsInvalidResponses(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "missing", body: `[{"index":0,"score":0.8}]`},
		{name: "missing index field", body: `[{"score":0.8},{"index":1,"score":0.7}]`},
		{name: "missing score field", body: `[{"index":0},{"index":1,"score":0.7}]`},
		{name: "duplicate", body: `[{"index":0,"score":0.8},{"index":0,"score":0.7}]`},
		{name: "out of range", body: `[{"index":0,"score":0.8},{"index":2,"score":0.7}]`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(test.body)) }))
			t.Cleanup(server.Close)
			_, err := NewTEIReranker(server.URL, "test", server.Client()).Rerank(context.Background(), "q", []string{"a", "b"})
			if !errors.Is(err, ErrInvalidRerank) {
				t.Fatalf("Rerank() error = %v, want ErrInvalidRerank", err)
			}
		})
	}
}

func TestTEIRerankerStatusAndTimeout(t *testing.T) {
	t.Run("status", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "model unavailable", http.StatusServiceUnavailable)
		}))
		t.Cleanup(server.Close)
		_, err := NewTEIReranker(server.URL, "test", server.Client()).Rerank(context.Background(), "q", []string{"a"})
		if err == nil || !strings.Contains(err.Error(), "model unavailable") {
			t.Fatalf("Rerank() error = %v", err)
		}
	})

	t.Run("timeout", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			time.Sleep(50 * time.Millisecond)
			_, _ = w.Write([]byte(`[{"index":0,"score":0.5}]`))
		}))
		t.Cleanup(server.Close)
		client := &http.Client{Timeout: 5 * time.Millisecond}
		_, err := NewTEIReranker(server.URL, "test", client).Rerank(context.Background(), "q", []string{"a"})
		if err == nil {
			t.Fatal("Rerank() accepted timed-out request")
		}
	})
}
