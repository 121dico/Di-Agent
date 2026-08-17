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
)

func TestOllamaEmbedder(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/api/embed" {
			t.Errorf("path = %s, want /api/embed", r.URL.Path)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("Content-Type = %q", r.Header.Get("Content-Type"))
		}
		var request struct {
			Model string   `json:"model"`
			Input []string `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request.Model != "bge-m3" {
			t.Errorf("model = %q", request.Model)
		}
		if !reflect.DeepEqual(request.Input, []string{"one", "two"}) {
			t.Errorf("input = %#v", request.Input)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"embeddings":[[1,0,0],[0,1,0]]}`))
	}))
	t.Cleanup(server.Close)

	embedder := NewOllamaEmbedder(server.URL+"/", "bge-m3", 3, server.Client())
	vectors, err := embedder.Embed(context.Background(), []string{"one", "two"})
	if err != nil {
		t.Fatalf("Embed() error = %v", err)
	}
	if embedder.Model() != "bge-m3" {
		t.Fatalf("Model() = %q", embedder.Model())
	}
	want := [][]float32{{1, 0, 0}, {0, 1, 0}}
	if !reflect.DeepEqual(vectors, want) {
		t.Fatalf("Embed() = %#v, want %#v", vectors, want)
	}
}

func TestOllamaEmbedderValidatesStatusAndDimensions(t *testing.T) {
	t.Run("status", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "model not found", http.StatusNotFound)
		}))
		t.Cleanup(server.Close)

		_, err := NewOllamaEmbedder(server.URL, "missing", 3, server.Client()).Embed(context.Background(), []string{"one"})
		if err == nil || !strings.Contains(err.Error(), "model not found") {
			t.Fatalf("Embed() error = %v, want response status/body", err)
		}
	})

	t.Run("dimensions", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"embeddings":[[1,0]]}`))
		}))
		t.Cleanup(server.Close)

		_, err := NewOllamaEmbedder(server.URL, "bge-m3", 3, server.Client()).Embed(context.Background(), []string{"one"})
		if !errors.Is(err, ErrInvalidEmbedding) {
			t.Fatalf("Embed() error = %v, want ErrInvalidEmbedding", err)
		}
	})

	t.Run("bge-m3 dimensions", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_ = json.NewEncoder(w).Encode(map[string]any{"embeddings": [][]float32{make([]float32, 1023)}})
		}))
		t.Cleanup(server.Close)

		_, err := NewOllamaEmbedder(server.URL, "bge-m3", 1024, server.Client()).Embed(context.Background(), []string{"one"})
		if !errors.Is(err, ErrInvalidEmbedding) || !strings.Contains(err.Error(), "want 1024") {
			t.Fatalf("Embed() error = %v, want BGE-M3 dimension rejection", err)
		}
	})
}
