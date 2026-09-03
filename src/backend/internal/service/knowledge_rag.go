package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/rag"
)

const maxRAGErrorRunes = 1000

type KnowledgeRAGConfig struct {
	Enabled           bool
	Dimensions        int
	SemanticThreshold float64
	TargetChunkChars  int
	MaxChunkChars     int
	ChunkOverlapChars int
	TopK              int
	CandidateTopN     int
	BatchSize         int
	RerankerEnabled   bool
}

type KnowledgeRAGResult struct {
	ID              string   `json:"id"`
	KnowledgeBaseID string   `json:"knowledge_base_id"`
	FileID          string   `json:"file_id"`
	Filename        string   `json:"filename"`
	ChunkIndex      int      `json:"chunk_index"`
	ChunkType       string   `json:"chunk_type"`
	Summary         string   `json:"summary"`
	Content         string   `json:"content"`
	Score           float64  `json:"score"`
	VectorScore     float64  `json:"vector_score"`
	RerankScore     *float64 `json:"rerank_score,omitempty"`
	EmbeddingModel  string   `json:"embedding_model,omitempty"`
	RetrievalMode   string   `json:"retrieval_mode"`
}

type KnowledgeReindexResult struct {
	KnowledgeBaseID string `json:"knowledge_base_id"`
	TotalFiles      int    `json:"total_files"`
	IndexedFiles    int    `json:"indexed_files"`
	FailedFiles     int    `json:"failed_files"`
	SkippedFiles    int    `json:"skipped_files"`
}

// ConfigureRAG installs the optional retrieval pipeline. The embedder is kept
// behind a port so adding another provider does not affect knowledge services.
func (s *KnowledgeService) ConfigureRAG(config KnowledgeRAGConfig, embedder rag.Embedder, reranker rag.Reranker) {
	if config.TopK <= 0 {
		config.TopK = 6
	}
	if config.BatchSize <= 0 {
		config.BatchSize = 32
	}
	if config.CandidateTopN <= 0 {
		config.CandidateTopN = 20
	}
	if config.CandidateTopN < config.TopK {
		config.CandidateTopN = config.TopK
	}
	if config.Dimensions <= 0 {
		config.Dimensions = 1024
	}
	s.ragConfig = config
	s.ragEmbedder = &batchEmbedder{inner: embedder, size: config.BatchSize, dimensions: config.Dimensions}
	s.ragReranker = reranker
	s.ragChunker = rag.NewChunker(rag.Config{
		SemanticThreshold: config.SemanticThreshold,
		TargetChunkChars:  config.TargetChunkChars,
		MaxChunkChars:     config.MaxChunkChars,
		ChunkOverlapChars: config.ChunkOverlapChars,
	}, s.ragEmbedder)
}

func (s *KnowledgeService) indexFileBestEffort(ctx context.Context, file *model.KnowledgeFile) {
	if file == nil {
		return
	}
	started := time.Now()
	err := s.indexFile(ctx, file)
	if err != nil {
		// The request context may already be cancelled. Use a short cleanup
		// context so the failure remains observable instead of leaving the row
		// permanently in "indexing".
		statusCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		_ = s.kbRepo.UpdateFileRAGStatus(statusCtx, file.KnowledgeBaseID, file.ID, "failed", truncateString(err.Error(), maxRAGErrorRunes), file.ChunkCount, nil)
		cancel()
		slog.Warn("knowledge rag indexing failed", "knowledge_base_id", file.KnowledgeBaseID, "file_id", file.ID, "model", s.ragModel(), "elapsed_ms", time.Since(started).Milliseconds(), "error", err)
		return
	}
	slog.Info("knowledge rag indexing completed", "knowledge_base_id", file.KnowledgeBaseID, "file_id", file.ID, "chunks", file.ChunkCount, "model", s.ragModel(), "elapsed_ms", time.Since(started).Milliseconds())
}

func (s *KnowledgeService) indexFile(ctx context.Context, file *model.KnowledgeFile) error {
	if !s.ragConfig.Enabled || s.ragChunker == nil || s.ragEmbedder == nil {
		return s.kbRepo.UpdateFileRAGStatus(ctx, file.KnowledgeBaseID, file.ID, "skipped", "RAG is disabled", 0, nil)
	}
	if file.PreviewType != "text" || strings.TrimSpace(file.PreviewText) == "" {
		if err := s.kbRepo.ReplaceChunks(ctx, file.KnowledgeBaseID, file.ID, nil); err != nil {
			return err
		}
		return s.kbRepo.UpdateFileRAGStatus(ctx, file.KnowledgeBaseID, file.ID, "skipped", "no extractable text", 0, nil)
	}
	if err := s.kbRepo.UpdateFileRAGStatus(ctx, file.KnowledgeBaseID, file.ID, "indexing", "", 0, nil); err != nil {
		return err
	}

	parts, chunkErr := s.ragChunker.Chunk(ctx, file.PreviewText)
	if len(parts) == 0 {
		return s.failFileIndex(ctx, file, nil, fmt.Errorf("chunker returned no content"))
	}
	inputs := make([]string, len(parts))
	for i, part := range parts {
		inputs[i] = strings.TrimSpace(part.Summary + "\n" + part.Content)
	}
	var (
		vectors  [][]float32
		embedErr error
	)
	if chunkErr != nil {
		// The semantic pass already proved that the embedding provider is
		// unavailable or malformed. Persist the string fallback immediately
		// instead of making a second request that can double upload latency.
		embedErr = chunkErr
	} else {
		vectors, embedErr = s.ragEmbedder.Embed(ctx, inputs)
	}

	chunks := make([]model.KnowledgeChunk, 0, len(parts))
	for i, part := range parts {
		digest := sha256.Sum256([]byte(part.Content))
		metadata, _ := json.Marshal(map[string]any{"filename": file.Filename, "preview_type": file.PreviewType})
		var vector []float32
		if embedErr == nil && i < len(vectors) {
			vector = vectors[i]
		}
		chunks = append(chunks, model.KnowledgeChunk{
			FileID: file.ID, KnowledgeBaseID: file.KnowledgeBaseID,
			ChunkIndex: part.Index, ChunkType: part.Type, Content: part.Content, Summary: part.Summary,
			TokenCount: approximateTokens(part.Content), CharCount: part.CharCount,
			Metadata: metadata, Embedding: vector, EmbeddingModel: s.ragModel(), ContentHash: hex.EncodeToString(digest[:]),
		})
	}
	if err := s.kbRepo.ReplaceChunks(ctx, file.KnowledgeBaseID, file.ID, chunks); err != nil {
		return s.failFileIndex(ctx, file, nil, err)
	}
	file.ChunkCount = len(chunks)
	if embedErr != nil {
		return s.failFileIndex(ctx, file, chunks, fmt.Errorf("embed final chunks: %w", embedErr))
	}
	now := time.Now().UTC()
	if err := s.kbRepo.UpdateFileRAGStatus(ctx, file.KnowledgeBaseID, file.ID, "indexed", "", len(chunks), &now); err != nil {
		return err
	}
	file.RAGStatus, file.RAGError, file.IndexedAt = "indexed", "", &now
	if chunkErr != nil {
		slog.Info("knowledge chunker used string fallback", "file_id", file.ID, "reason", chunkErr)
	}
	return nil
}

func (s *KnowledgeService) failFileIndex(ctx context.Context, file *model.KnowledgeFile, chunks []model.KnowledgeChunk, cause error) error {
	message := truncateString(cause.Error(), maxRAGErrorRunes)
	count := len(chunks)
	if err := s.kbRepo.UpdateFileRAGStatus(ctx, file.KnowledgeBaseID, file.ID, "failed", message, count, nil); err != nil {
		return fmt.Errorf("%v; update rag status: %w", cause, err)
	}
	file.RAGStatus, file.RAGError, file.ChunkCount = "failed", message, count
	return cause
}

func (s *KnowledgeService) Reindex(ctx context.Context, userID, kbID string) (*KnowledgeReindexResult, error) {
	kb, err := s.kbRepo.GetByID(ctx, kbID)
	if err != nil {
		return nil, err
	}
	if kb == nil {
		return nil, ErrKBNotFound
	}
	if kb.UserID != userID {
		return nil, ErrKBNoPermission
	}
	files, err := s.kbRepo.ListFiles(ctx, kbID)
	if err != nil {
		return nil, err
	}
	result := &KnowledgeReindexResult{KnowledgeBaseID: kbID, TotalFiles: len(files)}
	for i := range files {
		if err := ctx.Err(); err != nil {
			return nil, fmt.Errorf("reindex knowledge base cancelled: %w", err)
		}
		s.ensureFilePreview(ctx, &files[i])
		if files[i].PreviewType != "text" || strings.TrimSpace(files[i].PreviewText) == "" {
			_ = s.indexFile(ctx, &files[i])
			result.SkippedFiles++
			continue
		}
		if err := s.indexFile(ctx, &files[i]); err != nil {
			result.FailedFiles++
		} else {
			result.IndexedFiles++
		}
	}
	return result, nil
}

func (s *KnowledgeService) SearchRAG(ctx context.Context, userID, kbID, query string, limit int) ([]KnowledgeRAGResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []KnowledgeRAGResult{}, nil
	}
	kb, err := s.kbRepo.GetByID(ctx, kbID)
	if err != nil {
		return nil, err
	}
	if kb == nil {
		return nil, ErrKBNotFound
	}
	if kb.UserID != userID && kb.Visibility != "public" {
		return nil, ErrKBNoPermission
	}
	if limit <= 0 || limit > 50 {
		limit = s.ragConfig.TopK
		if limit <= 0 {
			limit = 6
		}
	}
	if s.ragConfig.Enabled && s.ragEmbedder != nil {
		vectors, embedErr := s.ragEmbedder.Embed(ctx, []string{query})
		if embedErr == nil && len(vectors) == 1 {
			candidateLimit := s.ragConfig.CandidateTopN
			if candidateLimit < limit {
				candidateLimit = limit
			}
			if candidateLimit > 50 {
				candidateLimit = 50
			}
			matches, searchErr := s.kbRepo.SearchChunks(ctx, kbID, userID, s.ragModel(), vectors[0], candidateLimit)
			if searchErr == nil && len(matches) > 0 {
				results := make([]KnowledgeRAGResult, 0, len(matches))
				for _, match := range matches {
					results = append(results, chunkSearchResult(match))
				}
				if s.ragConfig.RerankerEnabled && s.ragReranker != nil {
					reranked, rerankErr := s.rerankKnowledgeResults(ctx, query, results)
					if rerankErr == nil {
						return truncateRAGResults(reranked, limit), nil
					}
					if ctxErr := ctx.Err(); ctxErr != nil {
						return nil, fmt.Errorf("rerank knowledge results cancelled: %w", ctxErr)
					}
					slog.Warn("knowledge reranker failed; preserving vector order", "kb_id", kbID, "model", s.ragReranker.Model(), "candidate_count", len(results), "error", rerankErr)
				}
				return truncateRAGResults(results, limit), nil
			}
			if searchErr != nil {
				slog.Warn("pgvector retrieval failed; using keyword fallback", "kb_id", kbID, "error", searchErr)
			}
		} else if embedErr != nil {
			slog.Warn("query embedding failed; using keyword fallback", "kb_id", kbID, "error", embedErr)
		}
	}
	return s.keywordRAGFallback(ctx, userID, kbID, query, limit)
}

func (s *KnowledgeService) keywordRAGFallback(ctx context.Context, userID, kbID, query string, limit int) ([]KnowledgeRAGResult, error) {
	files, err := s.SearchFiles(ctx, userID, kbID, query, limit)
	if err != nil {
		return nil, err
	}
	results := make([]KnowledgeRAGResult, 0, len(files))
	for _, file := range files {
		content := file.PreviewText
		if strings.TrimSpace(content) == "" {
			content = file.Snippet
		}
		results = append(results, KnowledgeRAGResult{ID: file.ID, KnowledgeBaseID: kbID, FileID: file.ID, Filename: file.Filename, ChunkType: "string", Content: truncateString(content, kbMaxInlineChars), RetrievalMode: "keyword"})
	}
	return results, nil
}

func chunkSearchResult(match model.KnowledgeChunkSearchResult) KnowledgeRAGResult {
	return KnowledgeRAGResult{ID: match.ID, KnowledgeBaseID: match.KnowledgeBaseID, FileID: match.FileID, Filename: match.Filename, ChunkIndex: match.ChunkIndex, ChunkType: match.ChunkType, Summary: match.Summary, Content: match.Content, Score: match.Score, VectorScore: match.Score, EmbeddingModel: match.EmbeddingModel, RetrievalMode: "vector"}
}

func (s *KnowledgeService) rerankKnowledgeResults(ctx context.Context, query string, candidates []KnowledgeRAGResult) ([]KnowledgeRAGResult, error) {
	texts := make([]string, len(candidates))
	originalRank := make(map[string]int, len(candidates))
	for i, candidate := range candidates {
		texts[i] = candidate.Content
		originalRank[candidate.ID] = i
	}
	scores, err := s.ragReranker.Rerank(ctx, query, texts)
	if err != nil {
		return nil, err
	}
	if len(scores) != len(candidates) {
		return nil, fmt.Errorf("%w: reranker returned %d scores for %d candidates", rag.ErrInvalidRerank, len(scores), len(candidates))
	}
	reranked := make([]KnowledgeRAGResult, 0, len(candidates))
	seen := make([]bool, len(candidates))
	for _, score := range scores {
		if score.Index < 0 || score.Index >= len(candidates) {
			return nil, fmt.Errorf("%w: reranker index %d out of range", rag.ErrInvalidRerank, score.Index)
		}
		if seen[score.Index] {
			return nil, fmt.Errorf("%w: duplicate reranker index %d", rag.ErrInvalidRerank, score.Index)
		}
		seen[score.Index] = true
		candidate := candidates[score.Index]
		rerankScore := score.Score
		candidate.RerankScore = &rerankScore
		candidate.Score = score.Score
		candidate.RetrievalMode = "reranked"
		reranked = append(reranked, candidate)
	}
	sort.SliceStable(reranked, func(i, j int) bool {
		if reranked[i].Score == reranked[j].Score {
			return originalRank[reranked[i].ID] < originalRank[reranked[j].ID]
		}
		return reranked[i].Score > reranked[j].Score
	})
	return reranked, nil
}

func truncateRAGResults(results []KnowledgeRAGResult, limit int) []KnowledgeRAGResult {
	if limit >= 0 && len(results) > limit {
		return results[:limit]
	}
	return results
}

func approximateTokens(value string) int {
	count := utf8.RuneCountInString(value)
	if count == 0 {
		return 0
	}
	return (count + 3) / 4
}
func (s *KnowledgeService) ragModel() string {
	if s.ragEmbedder == nil {
		return ""
	}
	return s.ragEmbedder.Model()
}

type batchEmbedder struct {
	inner      rag.Embedder
	size       int
	dimensions int
}

func (e *batchEmbedder) Model() string {
	if e == nil || e.inner == nil {
		return ""
	}
	return e.inner.Model()
}
func (e *batchEmbedder) Embed(ctx context.Context, inputs []string) ([][]float32, error) {
	if e == nil || e.inner == nil {
		return nil, rag.ErrEmbeddingUnavailable
	}
	if len(inputs) == 0 {
		return [][]float32{}, nil
	}
	size := e.size
	if size <= 0 {
		size = 32
	}
	result := make([][]float32, 0, len(inputs))
	for start := 0; start < len(inputs); start += size {
		end := start + size
		if end > len(inputs) {
			end = len(inputs)
		}
		vectors, err := e.inner.Embed(ctx, inputs[start:end])
		if err != nil {
			return nil, err
		}
		if len(vectors) != end-start {
			return nil, fmt.Errorf("%w: batch returned %d vectors for %d inputs", rag.ErrInvalidEmbedding, len(vectors), end-start)
		}
		for i, vector := range vectors {
			if len(vector) == 0 {
				return nil, fmt.Errorf("%w: batch vector %d is empty", rag.ErrInvalidEmbedding, start+i)
			}
			if e.dimensions > 0 && len(vector) != e.dimensions {
				return nil, fmt.Errorf("%w: batch vector %d has %d dimensions, want %d", rag.ErrInvalidEmbedding, start+i, len(vector), e.dimensions)
			}
		}
		result = append(result, vectors...)
	}
	return result, nil
}
