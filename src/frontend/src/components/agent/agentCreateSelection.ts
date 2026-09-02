export const REQUIRED_AGENT_TOOLS = ['render_card'] as const;

export function selectAllTools(toolNames: string[]): string[] {
  return Array.from(new Set(toolNames));
}

export function clearOptionalTools(requiredTools: readonly string[] = REQUIRED_AGENT_TOOLS): string[] {
  return Array.from(new Set(requiredTools));
}

export function selectAllSkillIds(skills: Array<{ id: string }>): Set<string> {
  return new Set(skills.map((skill) => skill.id));
}

export function getSelectionState(selectedCount: number, totalCount: number): { checked: boolean; indeterminate: boolean } {
  if (totalCount <= 0) return { checked: false, indeterminate: false };
  return {
    checked: selectedCount === totalCount,
    indeterminate: selectedCount > 0 && selectedCount < totalCount,
  };
}
