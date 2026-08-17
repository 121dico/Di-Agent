import { describe, expect, it } from 'vitest';
import { buildCommands } from './connectCommand';

describe('buildCommands', () => {
  it('builds Windows-safe commands without shell comments', () => {
    const commands = buildCommands(
      'npx @hust-agenthub/daemon@0.3.0 --server-url http://127.0.0.1:8080 --api-key sk_machine_test',
      'D:/agenthub/src/daemon-npm',
    );

    expect(commands.npx).toBe(
      'npx "@hust-agenthub/daemon@0.3.0" --server-url "http://127.0.0.1:8080" --api-key "sk_machine_test"',
    );
    expect(commands.node).toBe(
      'node "D:/agenthub/src/daemon-npm/bin/agenthub-daemon.js" --server-url "http://127.0.0.1:8080" --api-key "sk_machine_test"',
    );
    expect(commands.npx).not.toContain('#');
    expect(commands.node).not.toContain('#');
  });
});
