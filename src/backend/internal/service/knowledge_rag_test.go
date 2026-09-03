package service

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/rag"
	"github.com/121dico/Di-Agent/src/backend/internal/repository"
)

type ragContextResolver struct {
	results []KnowledgeRAGResult
}

func (r ragContextResolver) ResolveKnowledgeRef(context.Context, string, string, string) (*model.KnowledgeBase, []model.KnowledgeFile, error) {
	return &model.KnowledgeBase{ID: "kb-1", Name: "docs", Visibility: "private"}, []model.KnowledgeFile{{ID: "file-old", Filename: "whole.md", PreviewType: "text", PreviewText: "legacy whole file"}}, nil
}

func (r ragContextResolver) SearchRAG(context.Context, string, string, string, int) ([]KnowledgeRAGResult, error) {
	return r.results, nil
}

func TestKBBuilderUsesRAGChunksBeforeWholeFiles(t *testing.T) {
	builder := &KBBuilder{KBResolver: ragContextResolver{results: []KnowledgeRAGResult{{
		FileID: "file-1", Filename: "guide.md", ChunkIndex: 2, Content: "the relevant answer", Score: 0.91, RetrievalMode: "vector",
	}}}}
	got := builder.resolveKB(context.Background(), "question {{alice/docs}}", "user-1")
	if !strings.Contains(got, "the relevant answer") || !strings.Contains(got, "chunk=2") {
		t.Fatalf("expected cited RAG chunk, got %q", got)
	}
	if strings.Contains(got, "legacy whole file") {
		t.Fatalf("whole-file fallback should not be injected when RAG matched: %q", got)
	}
}

func TestKBBuilderFallsBackWhenRAGHasNoMatches(t *testing.T) {
	builder := &KBBuilder{KBResolver: ragContextResolver{}}
	got := builder.resolveKB(context.Background(), "question {{alice/docs}}", "user-1")
	if !strings.Contains(got, "legacy whole file") {
		t.Fatalf("expected legacy fallback, got %q", got)
	}
}

type ragIndexStore struct {
	repository.KnowledgeStore
	chunks      []model.KnowledgeChunk
	status      string
	ragError    string
	count       int
	kb          *model.KnowledgeBase
	search      []model.KnowledgeChunkSearchResult
	searchLimit int
	searchModel string
}

func (s *ragIndexStore) GetByID(context.Context, string) (*model.KnowledgeBase, error) {
	return s.kb, nil
}

func (s *ragIndexStore) SearchChunks(_ context.Context, _, _, modelName string, _ []float32, limit int) ([]model.KnowledgeChunkSearchResult, error) {
	s.searchLimit, s.searchModel = limit, modelName
	return s.search, nil
}

func (s *ragIndexStore) ReplaceChunks(_ context.Context, _, _ string, chunks []model.KnowledgeChunk) error {
	s.chunks = append([]model.KnowledgeChunk(nil), chunks...)
	return nil
}

func (s *ragIndexStore) UpdateFileRAGStatus(_ context.Context, _, _, status, ragError string, count int, _ *time.Time) error {
	s.status, s.ragError, s.count = status, ragError, count
	return nil
}

type ragTestEmbedder struct {
	err         error
	emptyVector bool
	calls       *int
}

func (e ragTestEmbedder) Model() string { return "test-bge-m3" }
func (e ragTestEmbedder) Embed(_ context.Context, inputs []string) ([][]float32, error) {
	if e.calls != nil {
		*e.calls++
	}
	if e.err != nil {
		return nil, e.err
	}
	vectors := make([][]float32, len(inputs))
	for i := range vectors {
		if e.emptyVector {
			continue
		}
		vectors[i] = make([]float32, 1024)
		vectors[i][i%1024] = 1
	}
	return vectors, nil
}

func TestKnowledgeIndexFileRejectsEmptyEmbeddings(t *testing.T) {
	store := &ragIndexStore{}
	svc := &KnowledgeService{kbRepo: store}
	svc.ConfigureRAG(KnowledgeRAGConfig{Enabled: true}, ragTestEmbedder{emptyVector: true}, nil)
	file := &model.KnowledgeFile{ID: "file-1", KnowledgeBaseID: "kb-1", Filename: "guide.md", PreviewType: "text", PreviewText: "content that must receive an embedding"}

	if err := svc.indexFile(context.Background(), file); !errors.Is(err, rag.ErrInvalidEmbedding) {
		t.Fatalf("index file error = %v, want ErrInvalidEmbedding", err)
	}
	if store.status != "failed" || len(store.chunks) == 0 {
		t.Fatalf("empty embeddings must persist fallback chunks and failed status: status=%s chunks=%d", store.status, len(store.chunks))
	}
	for _, chunk := range store.chunks {
		if len(chunk.Embedding) != 0 {
			t.Fatalf("fallback chunk %d unexpectedly has an embedding", chunk.ChunkIndex)
		}
	}
}

func TestKnowledgeIndexFileStoresVectorChunks(t *testing.T) {
	store := &ragIndexStore{}
	svc := &KnowledgeService{kbRepo: store}
	svc.ConfigureRAG(KnowledgeRAGConfig{Enabled: true, BatchSize: 2}, ragTestEmbedder{}, nil)
	file := &model.KnowledgeFile{ID: "file-1", KnowledgeBaseID: "kb-1", Filename: "guide.md", PreviewType: "text", PreviewText: "# Guide\n\nFirst topic explains setup. Second sentence adds details.\n\nAnother topic explains search."}
	if err := svc.indexFile(context.Background(), file); err != nil {
		t.Fatalf("index file: %v", err)
	}
	if store.status != "indexed" || len(store.chunks) == 0 || store.count != len(store.chunks) {
		t.Fatalf("unexpected persisted state: status=%s count=%d chunks=%d", store.status, store.count, len(store.chunks))
	}
	for _, chunk := range store.chunks {
		if len(chunk.Embedding) != 1024 || chunk.EmbeddingModel != "test-bge-m3" {
			t.Fatalf("chunk %d missing vector metadata", chunk.ChunkIndex)
		}
	}
}

func TestKnowledgeIndexFilePersistsFallbackChunksOnEmbeddingFailure(t *testing.T) {
	store := &ragIndexStore{}
	svc := &KnowledgeService{kbRepo: store}
	calls := 0
	svc.ConfigureRAG(KnowledgeRAGConfig{Enabled: true}, ragTestEmbedder{err: errors.New("ollama offline"), calls: &calls}, nil)
	file := &model.KnowledgeFile{ID: "file-1", KnowledgeBaseID: "kb-1", Filename: "guide.md", PreviewType: "text", PreviewText: strings.Repeat("fallback content. ", 100)}
	if err := svc.indexFile(context.Background(), file); err == nil {
		t.Fatal("expected embedding failure")
	}
	if store.status != "failed" || len(store.chunks) == 0 || !strings.Contains(store.ragError, "ollama offline") {
		t.Fatalf("fallback state not persisted: status=%s chunks=%d error=%q", store.status, len(store.chunks), store.ragError)
	}
	if calls != 1 {
		t.Fatalf("embedding provider called %d times after semantic failure, want 1", calls)
	}
	for _, chunk := range store.chunks {
		if len(chunk.Embedding) != 0 {
			t.Fatalf("fallback chunk %d unexpectedly has embedding", chunk.ChunkIndex)
		}
	}
}

type ragTestReranker struct {
	results []rag.RerankResult
	err     error
	calls   int
	query   string
	texts   []string
}

func (r *ragTestReranker) Model() string { return "BAAI/bge-reranker-v2-m3" }
func (r *ragTestReranker) Rerank(_ context.Context, query string, texts []string) ([]rag.RerankResult, error) {
	r.calls++
	r.query = query
	r.texts = append([]string(nil), texts...)
	return r.results, r.err
}

func searchCandidates() []model.KnowledgeChunkSearchResult {
	return []model.KnowledgeChunkSearchResult{
		{KnowledgeChunk: model.KnowledgeChunk{ID: "c1", Content: "first", EmbeddingModel: "test-bge-m3"}, Filename: "one.md", Score: 0.9},
		{KnowledgeChunk: model.KnowledgeChunk{ID: "c2", Content: "second", EmbeddingModel: "test-bge-m3"}, Filename: "two.md", Score: 0.8},
		{KnowledgeChunk: model.KnowledgeChunk{ID: "c3", Content: "third", EmbeddingModel: "test-bge-m3"}, Filename: "three.md", Score: 0.7},
	}
}

func TestSearchRAGReranksCandidateTopNToFinalTopK(t *testing.T) {
	store := &ragIndexStore{kb: &model.KnowledgeBase{ID: "kb-1", UserID: "user-1"}, search: searchCandidates()}
	reranker := &ragTestReranker{results: []rag.RerankResult{{Index: 2, Score: 0.95}, {Index: 1, Score: 0.6}, {Index: 0, Score: 0.1}}}
	svc := &KnowledgeService{kbRepo: store}
	svc.ConfigureRAG(KnowledgeRAGConfig{Enabled: true, TopK: 2, CandidateTopN: 20, RerankerEnabled: true}, ragTestEmbedder{}, reranker)

	results, err := svc.SearchRAG(context.Background(), "user-1", "kb-1", "original question", 2)
	if err != nil {
		t.Fatalf("SearchRAG() error = %v", err)
	}
	if store.searchLimit != 20 || store.searchModel != "test-bge-m3" {
		t.Fatalf("vector recall = limit %d model %q, want Candidate Top-20 and matching model", store.searchLimit, store.searchModel)
	}
	if reranker.query != "original question" || !reflect.DeepEqual(reranker.texts, []string{"first", "second", "third"}) {
		t.Fatalf("reranker received query=%q texts=%v", reranker.query, reranker.texts)
	}
	if len(results) != 2 || results[0].ID != "c3" || results[1].ID != "c2" {
		t.Fatalf("reranked results = %+v", results)
	}
	if results[0].RetrievalMode != "reranked" || results[0].VectorScore != 0.7 || results[0].RerankScore == nil || *results[0].RerankScore != 0.95 || results[0].Score != 0.95 {
		t.Fatalf("rerank scores not observable: %+v", results[0])
	}
}

func TestSearchRAGRerankerErrorPreservesVectorOrder(t *testing.T) {
	store := &ragIndexStore{kb: &model.KnowledgeBase{ID: "kb-1", UserID: "user-1"}, search: searchCandidates()}
	reranker := &ragTestReranker{err: errors.New("TEI timeout")}
	svc := &KnowledgeService{kbRepo: store}
	svc.ConfigureRAG(KnowledgeRAGConfig{Enabled: true, TopK: 2, CandidateTopN: 20, RerankerEnabled: true}, ragTestEmbedder{}, reranker)

	results, err := svc.SearchRAG(context.Background(), "user-1", "kb-1", "query", 2)
	if err != nil {
		t.Fatalf("SearchRAG() error = %v", err)
	}
	if len(results) != 2 || results[0].ID != "c1" || results[1].ID != "c2" || results[0].RetrievalMode != "vector" || results[0].Score != results[0].VectorScore || results[0].RerankScore != nil {
		t.Fatalf("vector fallback order/scores changed: %+v", results)
	}
}

func TestSearchRAGPropagatesCancellationFromReranker(t *testing.T) {
	store := &ragIndexStore{kb: &model.KnowledgeBase{ID: "kb-1", UserID: "user-1"}, search: searchCandidates()}
	reranker := &ragTestReranker{err: context.Canceled}
	svc := &KnowledgeService{kbRepo: store}
	svc.ConfigureRAG(KnowledgeRAGConfig{Enabled: true, TopK: 2, CandidateTopN: 20, RerankerEnabled: true}, ragTestEmbedder{}, reranker)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := svc.SearchRAG(ctx, "user-1", "kb-1", "query", 2)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("SearchRAG() error = %v, want context.Canceled", err)
	}
}

func TestSearchRAGRerankerDisabled(t *testing.T) {
	store := &ragIndexStore{kb: &model.KnowledgeBase{ID: "kb-1", UserID: "user-1"}, search: searchCandidates()}
	reranker := &ragTestReranker{results: []rag.RerankResult{{Index: 2, Score: 1}, {Index: 1, Score: 0.5}, {Index: 0, Score: 0}}}
	svc := &KnowledgeService{kbRepo: store}
	svc.ConfigureRAG(KnowledgeRAGConfig{Enabled: true, TopK: 2, CandidateTopN: 20, RerankerEnabled: false}, ragTestEmbedder{}, reranker)

	results, err := svc.SearchRAG(context.Background(), "user-1", "kb-1", "query", 2)
	if err != nil || len(results) != 2 || results[0].ID != "c1" || reranker.calls != 0 {
		t.Fatalf("disabled reranker changed vector retrieval: results=%+v calls=%d err=%v", results, reranker.calls, err)
	}
}

func TestRerankKnowledgeResultsKeepsVectorOrderForTiedScores(t *testing.T) {
	reranker := &ragTestReranker{results: []rag.RerankResult{{Index: 2, Score: 0.5}, {Index: 0, Score: 0.5}, {Index: 1, Score: 0.5}}}
	svc := &KnowledgeService{ragReranker: reranker}
	candidates := []KnowledgeRAGResult{{ID: "c1", Content: "first"}, {ID: "c2", Content: "second"}, {ID: "c3", Content: "third"}}
	results, err := svc.rerankKnowledgeResults(context.Background(), "query", candidates)
	if err != nil {
		t.Fatalf("rerankKnowledgeResults() error = %v", err)
	}
	if results[0].ID != "c1" || results[1].ID != "c2" || results[2].ID != "c3" {
		t.Fatalf("tied rerank scores lost vector order: %+v", results)
	}
}
