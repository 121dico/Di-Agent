import { create } from 'zustand';

export interface AgentApprovalRequest {
  approval_id: string;
  conversation_id: string;
  task_id: string;
  agent_id: string;
  kind: string;
  method: string;
  details?: Record<string, unknown>;
  expires_at?: string;
}

interface AgentApprovalState {
  pending: Record<string, AgentApprovalRequest>;
  upsert: (request: AgentApprovalRequest) => void;
  remove: (approvalId: string) => void;
  clear: () => void;
}

export function isAgentApprovalRequest(value: unknown): value is AgentApprovalRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AgentApprovalRequest>;
  return typeof candidate.approval_id === 'string'
    && typeof candidate.conversation_id === 'string';
}

export const useAgentApprovalStore = create<AgentApprovalState>((set) => ({
  pending: {},
  upsert: (request) => set((state) => ({
    pending: { ...state.pending, [request.approval_id]: request },
  })),
  remove: (approvalId) => set((state) => {
    if (!state.pending[approvalId]) return state;
    const pending = { ...state.pending };
    delete pending[approvalId];
    return { pending };
  }),
  clear: () => set({ pending: {} }),
}));
