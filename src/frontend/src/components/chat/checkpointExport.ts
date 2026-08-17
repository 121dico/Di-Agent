import type { ConversationCheckpoint } from '@/types/context';

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
}

export function checkpointExportFilename(checkpoint: ConversationCheckpoint): string {
  const version = checkpoint.version ?? checkpoint.generation;
  const conversation = safeFilenamePart(checkpoint.conversation_id).slice(0, 12);
  return `checkpoint-${version}-${conversation}.md`;
}

export function checkpointExportMarkdown(checkpoint: ConversationCheckpoint): string {
  const version = checkpoint.version ?? checkpoint.generation;
  const metadata = [
    '# Conversation Checkpoint',
    '',
    `- Conversation ID: \`${checkpoint.conversation_id}\``,
    `- Source Agent ID: \`${checkpoint.source_agent_id}\``,
    `- Session generation: ${checkpoint.generation}`,
    `- Checkpoint version: ${version}`,
    `- Scope: \`${checkpoint.scope}\``,
    `- Created at: ${checkpoint.created_at}`,
    '',
    '---',
    '',
  ];
  return `${metadata.join('\n')}${checkpoint.markdown_content.trim()}\n`;
}

export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
