import type { TokenUsage } from './tokenUsage';
export type CheckpointScope =
  | 'private_agent'
  | 'task_shared'
  | 'conversation_shared'
  | 'orchestrator_only';

export type CheckpointStatus =
  | 'draft'
  | 'generating'
  | 'ready'
  | 'fallback'
  | 'failed_fallback'
  | 'fallback_failed'
  | 'failed'
  | 'deleted';

export interface CheckpointSummary {
  objective?: string;
  completed_work?: string[];
  current_state?: string;
  decisions?: string[];
  constraints?: string[];
  remaining_work?: string[];
  changed_files?: string[];
  test_status?: string[];
  artifact_refs?: string[];
  open_questions?: string[];
}

export interface ConversationCheckpoint {
  id: string;
  conversation_id: string;
  task_id?: string | null;
  source_agent_id: string;
  source_agent_name?: string;
  source_session_id?: string | null;
  generation: number;
  version?: number;
  source_from_message_id?: string | null;
  source_to_message_id?: string | null;
  source_message_count?: number;
  summary_json?: CheckpointSummary | null;
  markdown_content: string;
  tokens_before?: number | null;
  tokens_after?: number | null;
  scope: CheckpointScope;
  status: CheckpointStatus;
  error_message?: string | null;
  created_at: string;
  updated_at?: string;
}

export type ContextUsageStatus = 'normal' | 'warning' | 'critical' | 'unknown';
export type ContextUsageSource = 'estimated' | 'actual' | 'reported';

export interface ContextUsage {
  my_messages?: { estimated_tokens: number; message_count: number; input_tokens?: number; output_tokens?: number; input_characters?: number; output_characters?: number; output_message_count?: number; source?: string; tokenizer?: string; model?: string };
  native_usage?: TokenUsage;
  native_totals?: TokenUsage;
  measured_turns?: number;
  estimated_submitted_tokens?: number;
  conversation_id: string;
  agent_id: string;
  agent_name?: string;
  session_id?: string | null;
  generation: number;
  active_context_tokens: number;
  context_window_tokens: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  usage_ratio: number;
  status: ContextUsageStatus;
  source: ContextUsageSource;
  compaction_count: number;
  checkpoint_id?: string;
  updated_at?: string;
}

export interface CreateCheckpointRequest {
  agent_id: string;
  scope: CheckpointScope;
  source_to_message_id?: string;
}

export interface ContinueCheckpointRequest {
  agent_id: string;
}

export interface ImportCheckpointRequest {
  source_conversation_id: string;
  checkpoint_id: string;
  agent_id: string;
}

export interface ContinueCheckpointResult {
  session_id: string;
  generation: number;
  checkpoint_id: string;
  attached?: boolean;
}

export interface ForkConversationRequest {
  checkpoint_id: string;
  agent_id: string;
  title?: string;
}

export interface ConversationFork {
  child_conversation_id: string;
  parent_conversation_id: string;
  checkpoint_id: string;
  forked_from_message_id: string;
  source_agent_id: string;
  target_agent_id: string;
  created_by: string;
  created_at: string;
  parent_title?: string;
}

export interface ConversationForkResult {
  conversation: import('@/types/conversation').Conversation;
  fork: ConversationFork;
  session: ContextUsage;
}
