package rag

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeEmbedder struct {
	model string
	err   error
	fn    func([]string) [][]float32
}

func (f fakeEmbedder) Embed(_ context.Context, inputs []string) ([][]float32, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.fn(inputs), nil
}

func (f fakeEmbedder) Model() string { return f.model }

func TestChunkerBuildsSummaryAndSemanticBoundaries(t *testing.T) {
	embedder := fakeEmbedder{model: "fake", fn: func(inputs []string) [][]float32 {
		vectors := make([][]float32, len(inputs))
		for i := range inputs {
			if strings.Contains(inputs[i], "数据库") {
				vectors[i] = []float32{0, 1}
			} else {
				vectors[i] = []float32{1, 0}
			}
		}
		return vectors
	}}
	chunker := NewChunker(Config{
		SemanticThreshold: 0.72,
		TargetChunkChars:  200,
		MaxChunkChars:     260,
		ChunkOverlapChars: 10,
		MinChunkChars:     10,
		SummaryMaxChars:   70,
	}, embedder)

	text := "# Di Agent 架构\n\nDaemon 负责识别本地 CLI 并管理它们的生命周期。\n\n数据库使用 PostgreSQL 保存结构化业务数据。数据库向量由 pgvector 承载。"
	chunks, err := chunker.Chunk(context.Background(), text)
	if err != nil {
		t.Fatalf("Chunk() error = %v", err)
	}
	if len(chunks) < 3 {
		t.Fatalf("Chunk() returned %d chunks, want summary and at least two semantic chunks: %#v", len(chunks), chunks)
	}
	if chunks[0].Type != ChunkTypeSummary {
		t.Fatalf("first chunk type = %q, want %q", chunks[0].Type, ChunkTypeSummary)
	}
	if !strings.Contains(chunks[0].Content, "Di Agent 架构") {
		t.Fatalf("summary %q does not preserve title", chunks[0].Content)
	}
	semanticCount := 0
	for i, chunk := range chunks {
		if chunk.Index != i {
			t.Errorf("chunk[%d].Index = %d", i, chunk.Index)
		}
		if chunk.CharCount != runeCount(chunk.Content) {
			t.Errorf("chunk[%d].CharCount = %d, want %d", i, chunk.CharCount, runeCount(chunk.Content))
		}
		if chunk.Type == ChunkTypeSemantic {
			semanticCount++
		}
	}
	if semanticCount < 2 {
		t.Fatalf("semantic chunk count = %d, want at least 2: %#v", semanticCount, chunks)
	}
	if strings.Contains(chunks[1].Content, "pgvector") {
		t.Fatalf("semantic boundary did not separate unrelated adjacent units: %#v", chunks)
	}
}

func TestChunkerUsesStringFallbackForOversizedSemanticChunk(t *testing.T) {
	embedder := fakeEmbedder{model: "fake", fn: func(inputs []string) [][]float32 {
		vectors := make([][]float32, len(inputs))
		for i := range inputs {
			vectors[i] = []float32{1, 0}
		}
		return vectors
	}}
	chunker := NewChunker(Config{
		SemanticThreshold: 0.72,
		TargetChunkChars:  60,
		MaxChunkChars:     80,
		ChunkOverlapChars: 10,
		MinChunkChars:     20,
		SummaryMaxChars:   30,
	}, embedder)

	chunks, err := chunker.Chunk(context.Background(), strings.Repeat("向", 215))
	if err != nil {
		t.Fatalf("Chunk() error = %v", err)
	}
	stringCount := 0
	for _, chunk := range chunks[1:] {
		if chunk.Type != ChunkTypeString {
			t.Fatalf("oversized chunk type = %q, want %q", chunk.Type, ChunkTypeString)
		}
		if chunk.CharCount > 80 {
			t.Fatalf("fallback chunk has %d chars, want <= 80", chunk.CharCount)
		}
		stringCount++
	}
	if stringCount < 3 {
		t.Fatalf("string fallback count = %d, want at least 3", stringCount)
	}
}

func TestChunkerReturnsFallbackAndErrorWhenEmbeddingFails(t *testing.T) {
	embedErr := errors.New("ollama offline")
	chunker := NewChunker(Config{MaxChunkChars: 50, ChunkOverlapChars: 5, SummaryMaxChars: 20}, fakeEmbedder{err: embedErr})

	chunks, err := chunker.Chunk(context.Background(), strings.Repeat("knowledge ", 30))
	if !errors.Is(err, embedErr) {
		t.Fatalf("Chunk() error = %v, want wrapped %v", err, embedErr)
	}
	if len(chunks) < 2 || chunks[0].Type != ChunkTypeSummary {
		t.Fatalf("fallback did not preserve summary: %#v", chunks)
	}
	for _, chunk := range chunks[1:] {
		if chunk.Type != ChunkTypeString {
			t.Fatalf("fallback chunk type = %q, want string", chunk.Type)
		}
		if chunk.CharCount > 50 {
			t.Fatalf("fallback chunk has %d chars, want <= 50", chunk.CharCount)
		}
	}
}

func TestChunkerRejectsMalformedEmbeddingBatch(t *testing.T) {
	chunker := NewChunker(Config{}, fakeEmbedder{fn: func(_ []string) [][]float32 {
		return [][]float32{{1, 0}}
	}})

	chunks, err := chunker.Chunk(context.Background(), "第一段内容。\n\n第二段内容。")
	if !errors.Is(err, ErrInvalidEmbedding) {
		t.Fatalf("Chunk() error = %v, want ErrInvalidEmbedding", err)
	}
	if len(chunks) < 2 || chunks[1].Type != ChunkTypeString {
		t.Fatalf("malformed batch should degrade to string chunks: %#v", chunks)
	}
}
