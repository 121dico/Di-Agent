-- 为知识库增加可观测的 RAG 索引状态和 pgvector 分块存储。
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS rag_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS rag_error TEXT NOT NULL DEFAULT '';
ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS chunk_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_files ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES knowledge_files(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    chunk_type VARCHAR(20) NOT NULL CHECK (chunk_type IN ('summary', 'semantic', 'string')),
    content TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    token_count INTEGER NOT NULL DEFAULT 0 CHECK (token_count >= 0),
    char_count INTEGER NOT NULL DEFAULT 0 CHECK (char_count >= 0),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(1024),
    embedding_model VARCHAR(200) NOT NULL DEFAULT '',
    content_hash VARCHAR(64) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 关系过滤使用 B-tree，向量近邻召回使用 HNSW + cosine。
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_chunks_file_index
    ON knowledge_chunks(file_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_kb_id
    ON knowledge_chunks(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_file_id
    ON knowledge_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_files_rag_status
    ON knowledge_files(rag_status);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_hnsw
    ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding IS NOT NULL;

---- DOWN
DROP INDEX IF EXISTS idx_knowledge_chunks_embedding_hnsw;
DROP INDEX IF EXISTS idx_knowledge_chunks_file_id;
DROP INDEX IF EXISTS idx_knowledge_chunks_kb_id;
DROP INDEX IF EXISTS uq_knowledge_chunks_file_index;
DROP TABLE IF EXISTS knowledge_chunks;
DROP INDEX IF EXISTS idx_knowledge_files_rag_status;
ALTER TABLE knowledge_files DROP COLUMN IF EXISTS indexed_at;
ALTER TABLE knowledge_files DROP COLUMN IF EXISTS chunk_count;
ALTER TABLE knowledge_files DROP COLUMN IF EXISTS rag_error;
ALTER TABLE knowledge_files DROP COLUMN IF EXISTS rag_status;
