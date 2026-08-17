/** 知识库可见性 */
export type KnowledgeVisibility = 'private' | 'public';

export type KnowledgeRAGStatus = 'pending' | 'indexing' | 'indexed' | 'failed' | 'skipped';

/** 知识库中的文件 */
export interface KnowledgeFile {
  id: string;
  filename: string;
  url?: string;
  size: number;
  mime_type: string;
  preview_type: 'text' | 'image' | 'binary' | 'too_large';
  preview_text?: string;
  rag_status?: KnowledgeRAGStatus;
  rag_error?: string;
  chunk_count?: number;
  indexed_at?: string;
  uploaded_at: string;
}

export type KnowledgeRetrievalMode = 'keyword' | 'vector' | 'reranked';

export interface KnowledgeRAGResult {
  id: string;
  knowledge_base_id: string;
  file_id: string;
  filename: string;
  chunk_index: number;
  chunk_type: string;
  summary: string;
  content: string;
  score: number;
  vector_score: number;
  rerank_score?: number;
  embedding_model?: string;
  retrieval_mode: KnowledgeRetrievalMode;
}

export interface KnowledgeReindexResult {
  knowledge_base_id: string;
  total_files: number;
  indexed_files: number;
  failed_files: number;
  skipped_files: number;
}

export interface KnowledgeFileText {
  file_id: string;
  filename: string;
  mime_type: string;
  preview_type: KnowledgeFile['preview_type'];
  text: string;
  truncated: boolean;
}

/** 知识库 */
export interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  visibility: KnowledgeVisibility;
  files: KnowledgeFile[];
  file_count: number;
  created_at: string;
  updated_at: string;
}

/** 群组中可用的知识库（含 owner 信息） */
export interface GroupKnowledgeBase {
  id: string;
  name: string;
  description?: string;
  visibility: KnowledgeVisibility;
  username: string;
  file_count: number;
  created_at: string;
  updated_at: string;
}
export interface CreateKnowledgeBaseRequest {
  name: string;
  description?: string;
  visibility?: KnowledgeVisibility;
}

/** 更新知识库请求 */
export interface UpdateKnowledgeBaseRequest {
  name?: string;
  description?: string;
  visibility?: KnowledgeVisibility;
}
