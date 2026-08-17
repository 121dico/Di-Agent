import { create } from 'zustand';
import { message } from '@/utils/message';
import type { Conversation, ConversationType } from '@/types/conversation';
import * as convApi from '@/api/conversation';
import { forkConversation as forkConversationApi } from '@/api/context';
import type { ConversationForkResult, ForkConversationRequest } from '@/types/context';
import { STORAGE_KEYS } from '@/config/constants';



interface ConversationState {
  conversations: Conversation[];
  activeConversationId: string | null;
  directAgentChats: Record<string, string>;
  memberPanelOpen: boolean;
  loading: boolean;
  _fetching: boolean;
  _mutationVersion: number;
  fetchConversations: () => Promise<void>;
  forkConversation: (sourceConversationId: string, body: ForkConversationRequest) => Promise<ConversationForkResult>;
  createConversation: (type: ConversationType, title: string) => Promise<Conversation>;
  archiveConversationLocal: (id: string) => void;
  deleteConversation: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  setActive: (id: string | null) => void;
  bindDirectAgentChat: (conversationId: string, agentId: string) => void;
  unbindDirectAgentChat: (conversationId: string) => void;
  setMemberPanelOpen: (open: boolean) => void;
}

function loadDirectAgentChats(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DIRECT_AGENT_CHATS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

/** 置顶优先，再按更新时间倒序 */
function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  activeConversationId: localStorage.getItem(STORAGE_KEYS.ACTIVE_CONV),
  directAgentChats: loadDirectAgentChats(),
  memberPanelOpen: false,
  loading: false,
  _fetching: false,
  _mutationVersion: 0,

  fetchConversations: async () => {
    if (get()._fetching) return;
    const version = get()._mutationVersion;
    set({ _fetching: true, loading: true });
    try {
      const list = await convApi.getConversations();
      if (version === get()._mutationVersion) {
        set({ conversations: sortConversations(list) });
      }
    } finally {
      set({ loading: false, _fetching: false });
    }
  },

  forkConversation: async (sourceConversationId, body) => {
    const result = await forkConversationApi(sourceConversationId, body);
    localStorage.setItem(STORAGE_KEYS.ACTIVE_CONV, result.conversation.id);
    set((state) => ({
      conversations: sortConversations([
        result.conversation,
        ...state.conversations.filter((item) => item.id !== result.conversation.id),
      ]),
      activeConversationId: result.conversation.id,
      memberPanelOpen: false,
      _mutationVersion: state._mutationVersion + 1,
    }));
    return result;
  },

  createConversation: async (type, title) => {
    try {
      const conv = await convApi.createConversation(type, title);
      set((state) => ({
        conversations: sortConversations([...state.conversations, conv]),
        activeConversationId: conv.id,
      }));
      return conv;
    } catch {
      message.error('创建对话失败');
      throw new Error('创建对话失败');
    }
  },

  archiveConversationLocal: (id) => {
    set((state) => {
      const next = state.conversations.filter((c) => c.id !== id);
      const activeId =
        state.activeConversationId === id
          ? (next[0]?.id ?? null)
          : state.activeConversationId;
      return { conversations: next, activeConversationId: activeId };
    });
  },

  deleteConversation: async (id) => {
    let removeLocally = false;
    try {
      await convApi.deleteConversation(id);
      removeLocally = true;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 403 || status === 404) {
        // Conversation inaccessible (removed from group, already deleted, etc.) — remove from local list
        removeLocally = true;
      } else {
        message.error('删除对话失败');
      }
    }
    if (removeLocally) {
      set((state) => {
        const next = state.conversations.filter((c) => c.id !== id);
        const activeId =
          state.activeConversationId === id
            ? (next[0]?.id ?? null)
            : state.activeConversationId;
        return { conversations: next, activeConversationId: activeId };
      });
    }
  },

  togglePin: async (id) => {
    try {
      await convApi.togglePin(id);
      set((state) => ({
        conversations: sortConversations(
          state.conversations.map((c) =>
            c.id === id ? { ...c, pinned: !c.pinned } : c,
          ),
        ),
      }));
    } catch {
      message.error('置顶操作失败');
    }
  },

  renameConversation: async (id, title) => {
    const prev = get().conversations;
    set((state) => ({
      conversations: sortConversations(
        state.conversations.map((c) =>
          c.id === id ? { ...c, title } : c,
        ),
      ),
    }));
    try {
      await convApi.renameConversation(id, title);
    } catch {
      set({ conversations: prev });
      message.error('重命名失败');
    }
  },

  setActive: (id) => {
    if (id) localStorage.setItem(STORAGE_KEYS.ACTIVE_CONV, id);
    else localStorage.removeItem(STORAGE_KEYS.ACTIVE_CONV);
    set({ activeConversationId: id, memberPanelOpen: false });
  },

  bindDirectAgentChat: (conversationId, agentId) => {
    set((state) => {
      const next = { ...state.directAgentChats, [conversationId]: agentId };
      localStorage.setItem(STORAGE_KEYS.DIRECT_AGENT_CHATS, JSON.stringify(next));
      return { directAgentChats: next };
    });
  },

  unbindDirectAgentChat: (conversationId) => {
    set((state) => {
      const next = { ...state.directAgentChats };
      delete next[conversationId];
      localStorage.setItem(STORAGE_KEYS.DIRECT_AGENT_CHATS, JSON.stringify(next));
      return { directAgentChats: next };
    });
  },

  setMemberPanelOpen: (open) => {
    set({ memberPanelOpen: open });
  },
}));

export function resetConversationStore() {
  useConversationStore.setState({
    conversations: [],
    activeConversationId: null,
    directAgentChats: {},
    memberPanelOpen: false,
    loading: false,
    _fetching: false,
    _mutationVersion: 0,
  });
  localStorage.removeItem(STORAGE_KEYS.ACTIVE_CONV);
  localStorage.removeItem(STORAGE_KEYS.DIRECT_AGENT_CHATS);
}
