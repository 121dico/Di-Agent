package rag

import (
	"context"
	"errors"
)

var (
	ErrEmbeddingUnavailable = errors.New("embedding unavailable")
	ErrInvalidEmbedding     = errors.New("invalid embedding response")
	ErrInvalidRerank        = errors.New("invalid rerank response")
)

// Embedder 隔离具体向量服务，保证切块与业务层不依赖 Ollama 的 HTTP 协议。
type Embedder interface {
	Embed(ctx context.Context, inputs []string) ([][]float32, error)
	Model() string
}

// Reranker scores raw query/text pairs. Implementations must return exactly
// one validated result for every input text; callers retain vector ordering on
// any error.
type Reranker interface {
	Rerank(ctx context.Context, query string, texts []string) ([]RerankResult, error)
	Model() string
}

type RerankResult struct {
	Index int     `json:"index"`
	Score float64 `json:"score"`
}

type Config struct {
	SemanticThreshold float64
	TargetChunkChars  int
	MaxChunkChars     int
	ChunkOverlapChars int
	MinChunkChars     int
	SummaryMaxChars   int
}

type Chunk struct {
	Type      string
	Content   string
	Summary   string
	Index     int
	CharCount int
}

const (
	ChunkTypeSummary  = "summary"
	ChunkTypeSemantic = "semantic"
	ChunkTypeString   = "string"
)
