import type { DaemonMachine } from '@/types/agent';

const names = ['云杉', '银杏', '青松', '白桦', '枫林', '雪松', '海棠', '月桂', '竹影', '星河', '远山', '清风', '晴空', '山岚', '晨光', '听雨'];

/** 旧版时间命名只改变展示，不改连接 ID 或用户手动设置的名称。 */
export function computerDisplayName(machine: Pick<DaemonMachine, 'id' | 'name'>): string {
  if (!/^computer-\d{4}$/.test(machine.name)) return machine.name;
  let hash = 2166136261;
  for (const character of machine.id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const primary = hash % names.length;
  const remainder = Math.floor(hash / names.length) % (names.length - 1);
  const secondary = remainder >= primary ? remainder + 1 : remainder;
  return `${names[primary]}工作站 · ${names[secondary]}`;
}

export function defaultComputerName(machines: Pick<DaemonMachine, 'id' | 'name'>[]): string {
  const used = new Set(machines.map(computerDisplayName));
  for (const name of names) {
    const candidate = `${name}工作站`;
    if (!used.has(candidate)) return candidate;
  }
  let suffix = 2;
  while (used.has(`云杉工作站 ${suffix}`)) suffix += 1;
  return `云杉工作站 ${suffix}`;
}
