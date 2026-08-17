import React, { useEffect, useMemo, useState } from 'react';
import KnowledgePanel from '@/components/knowledge/KnowledgePanel';
import KnowledgeFilePreview from '@/components/knowledge/KnowledgeFilePreview';
import KnowledgeRAGPanel from '@/components/knowledge/KnowledgeRAGPanel';
import type { KnowledgeBase, KnowledgeFile } from '@/types/knowledge';
import { useUIStore } from '@/store/uiStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import styles from '@/layout/AppLayout.module.css';

const KnowledgeView: React.FC = () => {
  const selectedKnowledgeFile = useUIStore((s) => s.selectedKnowledgeFile);
  const selectedKbId = useUIStore((s) => s.selectedKbId);
  const setSelectedKnowledgeFile = useUIStore((s) => s.setSelectedKnowledgeFile);
  const knowledgeBases = useKnowledgeStore((s) => s.knowledgeBases);
  const [ragKbId, setRagKbId] = useState<string | null>(null);
  const ragKnowledgeBase = useMemo(
    () => knowledgeBases.find((kb) => kb.id === ragKbId) ?? null,
    [knowledgeBases, ragKbId],
  );

  const handleFileSelect = (file: KnowledgeFile, kbId: string) => {
    setRagKbId(null);
    setSelectedKnowledgeFile(file, kbId);
  };

  const handleRAGSelect = (knowledgeBase: KnowledgeBase) => {
    setRagKbId(knowledgeBase.id);
  };

  // Sync selected file when knowledge base data updates
  useEffect(() => {
    if (!selectedKnowledgeFile || !selectedKbId) return;
    const kb = knowledgeBases.find((k) => k.id === selectedKbId);
    if (!kb) return;
    const updated = kb.files?.find((f) => f.id === selectedKnowledgeFile.id);
    if (updated && updated !== selectedKnowledgeFile) {
      setSelectedKnowledgeFile(updated, selectedKbId);
    }
  }, [knowledgeBases, selectedKnowledgeFile, selectedKbId, setSelectedKnowledgeFile]);

  return (
    <div className={styles.chatPanel}>
      <KnowledgePanel
        onFileSelect={handleFileSelect}
        onRAGSelect={handleRAGSelect}
        selectedFileId={selectedKnowledgeFile?.id ?? null}
        selectedKbId={selectedKbId}
      />
      {/* 右侧面板 */}
      <div className={styles.rightPanel}>
        {ragKnowledgeBase ? (
          <KnowledgeRAGPanel knowledgeBase={ragKnowledgeBase} onFileSelect={handleFileSelect} />
        ) : selectedKnowledgeFile && selectedKbId ? (
          <KnowledgeFilePreview
            file={selectedKnowledgeFile}
            kbId={selectedKbId}
            onFileRenamed={(file) => setSelectedKnowledgeFile(file, selectedKbId)}
          />
        ) : (
          <div className={styles.emptyRightPanel}>
            <div className={styles.emptyRightIcon}>📚</div>
            <div className={styles.emptyRightTitle}>知识库管理</div>
            <div className={styles.emptyRightDesc}>在左侧面板中管理你的知识库和文件</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default KnowledgeView;
