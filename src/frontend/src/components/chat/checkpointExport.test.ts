import { describe, expect, it } from 'vitest';
import type { ConversationCheckpoint } from '@/types/context';
import {
  checkpointExportFilename,
  checkpointExportMarkdown,
} from './checkpointExport';

const checkpoint: ConversationCheckpoint = {
  id: 'checkpoint-1',
  conversation_id: 'a9edcb2f-4412-49b0-b43f-146ed8843f2d',
  source_agent_id: 'agent-1',
  generation: 2,
  version: 3,
  markdown_content: '# 当前目标\n继续完成上下文迁移。',
  scope: 'conversation_shared',
  status: 'ready',
  created_at: '2026-07-16T00:00:00+08:00',
};

describe('checkpoint export', () => {
  it('creates a portable Markdown document with source metadata', () => {
    const markdown = checkpointExportMarkdown(checkpoint);

    expect(markdown).toContain('Conversation ID: `a9edcb2f-4412-49b0-b43f-146ed8843f2d`');
    expect(markdown).toContain('Checkpoint version: 3');
    expect(markdown).toContain('# 当前目标');
    expect(checkpointExportFilename(checkpoint)).toBe(
      'checkpoint-3-a9edcb2f-441.md',
    );
  });
});
