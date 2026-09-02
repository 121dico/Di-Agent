import { describe, expect, it } from 'vitest';
import { clampInspectorWidth, defaultInspectorTab, nextInspectorTabIndex, taskResultPreview } from './TaskInspector';

describe('TaskInspector state rules', () => {
  it('opens running and failed tasks on progress, terminal success on overview', () => {
    expect(defaultInspectorTab('streaming')).toBe('progress');
    expect(defaultInspectorTab('error')).toBe('progress');
    expect(defaultInspectorTab('complete')).toBe('overview');
    expect(defaultInspectorTab('canceled')).toBe('overview');
  });

  it('moves between tabs with arrow, Home, and End keys', () => {
    expect(nextInspectorTabIndex(3, 'ArrowRight', 4)).toBe(0);
    expect(nextInspectorTabIndex(0, 'ArrowLeft', 4)).toBe(3);
    expect(nextInspectorTabIndex(2, 'Home', 4)).toBe(0);
    expect(nextInspectorTabIndex(1, 'End', 4)).toBe(3);
  });

  it('keeps full task output available while collapsing long overview text', () => {
    expect(taskResultPreview('short result', 20)).toEqual({ preview: 'short result', collapsed: false });
    expect(taskResultPreview('012345678901234567890', 20)).toEqual({ preview: '01234567890123456789…', collapsed: true });
    expect(taskResultPreview('已完成\n```html\n<div>large artifact</div>\n```', 100)).toEqual({
      preview: '已完成\n\n[代码或产物内容已折叠]',
      collapsed: true,
    });
  });

  it('preserves a usable chat workspace while resizing the docked inspector', () => {
    expect(clampInspectorWidth(280, 1440)).toBe(360);
    expect(clampInspectorWidth(520, 1440)).toBe(520);
    expect(clampInspectorWidth(700, 1440)).toBe(560);
    expect(clampInspectorWidth(560, 1280)).toBe(444);
  });
});
