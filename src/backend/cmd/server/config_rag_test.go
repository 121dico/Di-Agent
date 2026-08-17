package main

import "testing"

func TestRAGDefaults(t *testing.T) {
	t.Setenv("AGENTHUB_RAG_ENABLED", "")
	var cfg Config
	cfg.applyRAGDefaults(false)
	if !cfg.RAG.Enabled || cfg.RAG.Model != "bge-m3" || cfg.RAG.Dimensions != 1024 || cfg.RAG.TopK != 6 || cfg.RAG.CandidateTopN != 20 {
		t.Fatalf("unexpected RAG defaults: %+v", cfg.RAG)
	}
	if !cfg.RAG.RerankerEnabled || cfg.RAG.RerankerURL != "http://localhost:8081" || cfg.RAG.RerankerModel != "BAAI/bge-reranker-v2-m3" || cfg.RAG.RerankerTimeoutSecs != 30 {
		t.Fatalf("unexpected reranker defaults: %+v", cfg.RAG)
	}
}

func TestRAGValidationRejectsNonBGEVectorDimension(t *testing.T) {
	var cfg Config
	cfg.Server.Port = 8080
	cfg.Database.Host = "localhost"
	cfg.Database.DBName = "agenthub"
	cfg.JWT.Secret = "test"
	cfg.applyRAGDefaults(false)
	cfg.RAG.Dimensions = 1023
	if err := cfg.validate(); err == nil || err.Error() != "rag.dimensions must be 1024 for the current pgvector schema" {
		t.Fatalf("validate dimension error = %v", err)
	}
}

func TestRAGEnvironmentOverrides(t *testing.T) {
	t.Setenv("AGENTHUB_RAG_ENABLED", "false")
	t.Setenv("AGENTHUB_RAG_OLLAMA_URL", "http://ollama:11434")
	t.Setenv("AGENTHUB_RAG_TOP_K", "9")
	t.Setenv("AGENTHUB_RAG_CANDIDATE_TOP_N", "25")
	t.Setenv("AGENTHUB_RAG_RERANKER_ENABLED", "false")
	t.Setenv("AGENTHUB_RAG_RERANKER_URL", "http://tei:80")
	t.Setenv("AGENTHUB_RAG_RERANKER_MODEL", "custom-reranker")
	t.Setenv("AGENTHUB_RAG_RERANKER_TIMEOUT_SECONDS", "45")
	var cfg Config
	cfg.applyRAGDefaults(false)
	if cfg.RAG.Enabled || cfg.RAG.OllamaURL != "http://ollama:11434" || cfg.RAG.TopK != 9 || cfg.RAG.CandidateTopN != 25 {
		t.Fatalf("environment overrides not applied: %+v", cfg.RAG)
	}
	if cfg.RAG.RerankerEnabled || cfg.RAG.RerankerURL != "http://tei:80" || cfg.RAG.RerankerModel != "custom-reranker" || cfg.RAG.RerankerTimeoutSecs != 45 {
		t.Fatalf("reranker environment overrides not applied: %+v", cfg.RAG)
	}
}

func TestRAGDefaultsPreserveExplicitRerankerDisable(t *testing.T) {
	var cfg Config
	cfg.RAG.RerankerEnabled = false
	cfg.applyRAGDefaults(false, true)
	if cfg.RAG.RerankerEnabled {
		t.Fatal("explicit reranker_enabled=false was overwritten")
	}
}

func TestRAGValidationRejectsInvalidRetrievalConfig(t *testing.T) {
	var cfg Config
	cfg.Server.Port = 8080
	cfg.Database.Host = "localhost"
	cfg.Database.DBName = "agenthub"
	cfg.JWT.Secret = "test"
	cfg.applyRAGDefaults(false)
	cfg.RAG.TargetChunkChars = cfg.RAG.MaxChunkChars + 1
	if err := cfg.validate(); err == nil {
		t.Fatal("validate accepted target chunk size larger than max")
	}
}

func TestRAGValidationRejectsCandidateBelowTopK(t *testing.T) {
	var cfg Config
	cfg.Server.Port = 8080
	cfg.Database.Host = "localhost"
	cfg.Database.DBName = "agenthub"
	cfg.JWT.Secret = "test"
	cfg.applyRAGDefaults(false)
	cfg.RAG.CandidateTopN = cfg.RAG.TopK - 1
	if err := cfg.validate(); err == nil {
		t.Fatal("validate accepted candidate_top_n below top_k")
	}
}

func TestRAGValidationRejectsInvalidRerankerTimeout(t *testing.T) {
	var cfg Config
	cfg.Server.Port = 8080
	cfg.Database.Host = "localhost"
	cfg.Database.DBName = "agenthub"
	cfg.JWT.Secret = "test"
	cfg.applyRAGDefaults(false)
	cfg.RAG.RerankerTimeoutSecs = -1
	if err := cfg.validate(); err == nil {
		t.Fatal("validate accepted negative reranker timeout")
	}
}
