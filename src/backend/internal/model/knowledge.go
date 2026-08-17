package model

import (
	"encoding/json"
	"time"
)

// KnowledgeBase 知识库模型
type KnowledgeBase struct {
	ID          string          `json:"id" db:"id"`
	UserID      string          `json:"user_id" db:"user_id"`
	Name        string          `json:"name" db:"name"`
	Description string          `json:"description" db:"description"`
	Visibility  string          `json:"visibility" db:"visibility"`
	CreatedAt   time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at" db:"updated_at"`
	Files       []KnowledgeFile `json:"files" db:"-"`
	FileCount   int             `json:"file_count" db:"file_count"`
	Username    string          `json:"username,omitempty" db:"username"`
}

// KnowledgeFile 知识库文件模型
type KnowledgeFile struct {
	ID              string     `json:"id" db:"id"`
	KnowledgeBaseID string     `json:"knowledge_base_id" db:"knowledge_base_id"`
	Filename        string     `json:"filename" db:"filename"`
	FilePath        string     `json:"-" db:"file_path"`
	URL             string     `json:"url,omitempty" db:"-"`
	FileSize        int64      `json:"size" db:"file_size"`
	MimeType        string     `json:"mime_type" db:"mime_type"`
	PreviewText     string     `json:"preview_text,omitempty" db:"preview_text"`
	PreviewType     string     `json:"preview_type" db:"preview_type"`
	RAGStatus       string     `json:"rag_status" db:"rag_status"`
	RAGError        string     `json:"rag_error,omitempty" db:"rag_error"`
	ChunkCount      int        `json:"chunk_count" db:"chunk_count"`
	IndexedAt       *time.Time `json:"indexed_at,omitempty" db:"indexed_at"`
	CreatedAt       time.Time  `json:"uploaded_at" db:"created_at"`
}

// KnowledgeChunk 是可独立召回并能追溯到原文件的知识片段。
type KnowledgeChunk struct {
	ID              string          `json:"id" db:"id"`
	KnowledgeBaseID string          `json:"knowledge_base_id" db:"knowledge_base_id"`
	FileID          string          `json:"file_id" db:"file_id"`
	ChunkIndex      int             `json:"chunk_index" db:"chunk_index"`
	ChunkType       string          `json:"chunk_type" db:"chunk_type"`
	Content         string          `json:"content" db:"content"`
	Summary         string          `json:"summary" db:"summary"`
	TokenCount      int             `json:"token_count" db:"token_count"`
	CharCount       int             `json:"char_count" db:"char_count"`
	Metadata        json.RawMessage `json:"metadata" db:"metadata"`
	Embedding       []float32       `json:"-" db:"-"`
	EmbeddingModel  string          `json:"embedding_model" db:"embedding_model"`
	ContentHash     string          `json:"content_hash" db:"content_hash"`
	CreatedAt       time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at" db:"updated_at"`
}

// KnowledgeChunkSearchResult 在分块内容之外返回 cosine 相似度和来源文件名。
type KnowledgeChunkSearchResult struct {
	KnowledgeChunk
	Filename string  `json:"filename" db:"filename"`
	Score    float64 `json:"score" db:"score"`
}
