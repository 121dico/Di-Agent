// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { shallow } from 'zustand/shallow';
import type { Message } from '@/types/message';
import type { TaskTimeline, TaskTimelineItem, TaskTimelineStep } from './taskTimeline';
import {
  isTaskPanelDragTarget,
  selectTaskPanelItems,
  TaskStepDisclosure,
} from './TaskProgressWidget';
import { selectTaskMessageLists } from './taskMessageSelector';

describe('TaskProgressWidget message selector', () => {
  it('returns a shallow-stable snapshot when the store state has not changed', () => {
    const messages: Record<string, Message[]> = {
      'agent-conv': [],
    };

    const first = selectTaskMessageLists(messages, ['agent-conv']);
    const second = selectTaskMessageLists(messages, ['agent-conv']);

    expect(shallow(first, second)).toBe(true);
  });
});

describe('TaskProgressWidget compact timeline', () => {
  it('shows every running task and only the three most recent completed tasks', () => {
    const item = (id: string, recordedAt: number, status: TaskTimelineItem['status']): TaskTimelineItem => ({
      id,
      messageId: id,
      conversationId: 'agent-conv',
      conversationTitle: '价格敏感度分析',
      agentName: '数据 Agent',
      title: id,
      status,
      recordedAt,
      steps: [],
      currentStep: '准备执行',
      completedStepCount: 0,
      progress: 0,
      result: '',
    });
    const timeline: TaskTimeline = {
      active: [item('active-2', 20, 'streaming'), item('active-1', 10, 'streaming')],
      completed: [
        item('done-4', 40, 'complete'),
        item('done-3', 30, 'complete'),
        item('done-2', 20, 'complete'),
        item('done-1', 10, 'complete'),
      ],
    };

    const visible = selectTaskPanelItems(timeline);

    expect(visible.active.map((task) => task.id)).toEqual(['active-2', 'active-1']);
    expect(visible.completed.map((task) => task.id)).toEqual(['done-4', 'done-3', 'done-2']);
  });
});

describe('TaskProgressWidget drag handle', () => {
  it('lets the collapsed task progress button drag while keeping panel controls clickable', () => {
    const headerLabel = document.createElement('span');
    const launcherButton = document.createElement('button');
    const launcherIcon = document.createElement('span');
    const collapseButton = document.createElement('button');
    const collapseIcon = document.createElement('span');
    launcherButton.dataset.taskProgressLauncher = 'true';
    launcherButton.append(launcherIcon);
    collapseButton.append(collapseIcon);

    expect(isTaskPanelDragTarget(headerLabel)).toBe(true);
    expect(isTaskPanelDragTarget(launcherButton)).toBe(true);
    expect(isTaskPanelDragTarget(launcherIcon)).toBe(true);
    expect(isTaskPanelDragTarget(collapseButton)).toBe(false);
    expect(isTaskPanelDragTarget(collapseIcon)).toBe(false);
    expect(isTaskPanelDragTarget(null)).toBe(false);
  });
});

describe('TaskStepDisclosure', () => {
  it('keeps the full information stream independently expandable and collapsed by default', () => {
    const step: TaskTimelineStep = {
      id: 'step-1',
      kind: 'tool_result',
      label: '工具返回',
      summary: '找到 3 个相关文件',
      detail: 'src/a.ts\nsrc/b.ts\nsrc/c.ts',
      status: 'completed',
    };

    const markup = renderToStaticMarkup(React.createElement(TaskStepDisclosure, { step }));

    expect(markup).toContain('<details');
    expect(markup).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
    expect(markup).toContain('<summary');
    expect(markup).toContain('工具返回');
    expect(markup).toContain('已完成');
    expect(markup).toContain('找到 3 个相关文件');
    expect(markup).toContain('src/a.ts\nsrc/b.ts\nsrc/c.ts');
  });
});
