package main

import (
	"os"
	"strings"
	"testing"
)

func TestKnowledgeRAGMigrationUsesBGEVectorContract(t *testing.T) {
	content, err := os.ReadFile("../../migrations/058_add_knowledge_rag.sql")
	if err != nil {
		t.Fatalf("read RAG migration: %v", err)
	}
	sql := strings.ToLower(string(content))
	for _, required := range []string{
		"create extension if not exists vector",
		"embedding vector(1024)",
		"using hnsw (embedding vector_cosine_ops)",
		"idx_knowledge_chunks_kb_id",
		"idx_knowledge_chunks_file_id",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("RAG migration missing %q", required)
		}
	}
	if strings.Contains(sql, "vector(768)") {
		t.Fatal("RAG migration still contains legacy 768-dimensional vector")
	}
}
