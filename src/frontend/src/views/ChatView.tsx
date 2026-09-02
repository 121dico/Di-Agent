import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { MessageSquare, Plus, RefreshCw } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { PersonalReportComposer } from '@/components/personal-report/PersonalReportComposer';
import { ConversationList } from '@/components/sidebar/ConversationList';
import { useConversation } from '@/hooks/useConversation';
import { useConversationStore } from '@/store/conversationStore';
import { usePersonalReportStore } from '@/store/personalReportStore';
import styles from './ChatView.module.css';

const ChatView: React.FC = () => {
  const { activeId } = useConversation();
  const fetchConversations = useConversationStore((state) => state.fetchConversations);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const { openNewConversation } = useOutletContext<{ openNewConversation: () => void }>();
  const workspaceOpen = usePersonalReportStore((state) => state.workspaceOpen);
  const openReportWorkspace = usePersonalReportStore((state) => state.openWorkspace);
  const closeReportWorkspace = usePersonalReportStore((state) => state.closeWorkspace);
  const previousActiveId = useRef(activeId);

  useEffect(() => {
    if (previousActiveId.current !== activeId) closeReportWorkspace();
    previousActiveId.current = activeId;
  }, [activeId, closeReportWorkspace]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshFailed(false);
    try {
      await fetchConversations();
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [fetchConversations, refreshing]);

  return (
    <div className={`${styles.workbench} ${workspaceOpen ? styles.reportWorkspaceOpen : ''}`}>
      <aside className={styles.conversationPanel} aria-label="对话列表">
        <div className={styles.conversationHeader}>
          <strong>消息</strong>
          <div className={styles.conversationTools}>
            {refreshFailed && <span className={styles.refreshError} role="status">刷新失败，列表仍可用</span>}
            <Button type="text" icon={<Plus size={16} />} aria-label="新建对话" onClick={openNewConversation} />
            <Button
              type="text"
              icon={<RefreshCw size={15} />}
              aria-label={refreshFailed ? '重试刷新对话' : '刷新对话'}
              loading={refreshing}
              disabled={refreshing}
              onClick={() => void handleRefresh()}
            />
          </div>
        </div>
        <ConversationList onNavigateContacts={() => {}} />
      </aside>

      <main className={styles.chatWorkspace}>
        {activeId ? (
          <>
            <section className={styles.chatPane}>
              <ChatWindow
                personalReportOpen={workspaceOpen}
                onOpenPersonalReport={() => void openReportWorkspace(undefined, activeId)}
              />
            </section>
            {workspaceOpen && <PersonalReportComposer conversationId={activeId} />}
          </>
        ) : (
          <div className={styles.empty}>
            <span className={styles.icon}><MessageSquare /></span>
            <div className={styles.title}>打开一个对话</div>
            <div className={styles.subtitle}>选择左侧会话，或新建一个对话开始协作</div>
            <button className={styles.emptyAction} type="button" onClick={openNewConversation}>
              <Plus size={15} /> 新建对话
            </button>
          </div>
        )}
      </main>
    </div>
  );
};

export default ChatView;
