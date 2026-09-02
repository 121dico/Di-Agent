import { describe, expect, it } from 'vitest';
import {
  clearOptionalTools,
  getSelectionState,
  selectAllSkillIds,
  selectAllTools,
} from './agentCreateSelection';

describe('agentCreateSelection', () => {
  it('selects every currently available tool and skill', () => {
    expect(selectAllTools(['render_card', 'read_file', 'read_file'])).toEqual(['render_card', 'read_file']);
    expect(selectAllSkillIds([{ id: 's1' }, { id: 's2' }])).toEqual(new Set(['s1', 's2']));
  });

  it('keeps required platform tools when clearing optional tools', () => {
    expect(clearOptionalTools(['render_card'])).toEqual(['render_card']);
  });

  it('reports checked and indeterminate select-all states', () => {
    expect(getSelectionState(2, 3)).toEqual({ checked: false, indeterminate: true });
    expect(getSelectionState(3, 3)).toEqual({ checked: true, indeterminate: false });
    expect(getSelectionState(0, 0)).toEqual({ checked: false, indeterminate: false });
  });
});
