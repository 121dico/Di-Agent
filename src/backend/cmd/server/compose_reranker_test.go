package main

import (
	"os"
	"strings"
	"testing"
)

func TestComposeRAGProfileIncludesTEIReranker(t *testing.T) {
	content, err := os.ReadFile("../../../../docker-compose.yml")
	if err != nil {
		t.Fatalf("read docker-compose.yml: %v", err)
	}
	compose := string(content)
	for _, required := range []string{
		"reranker:",
		"ghcr.io/huggingface/text-embeddings-inference:cpu-1.9",
		`profiles: ["rag"]`,
		`"/data/bge-reranker-v2-m3"`,
		`"8081:80"`,
		"./model-cache/ollama:/root/.ollama",
		"./model-cache/huggingface:/data:ro",
	} {
		if !strings.Contains(compose, required) {
			t.Fatalf("compose RAG profile missing %q", required)
		}
	}
	for _, removed := range []string{"ollamadata:/root/.ollama", "hfdata:/data", "  ollamadata:", "  hfdata:"} {
		if strings.Contains(compose, removed) {
			t.Fatalf("compose still uses removed named model volume %q", removed)
		}
	}
}
