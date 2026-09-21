// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReportAgentWidget } from './ReportAgentWidget';
vi.mock('./ReportAgentChat', () => ({ ReportAgentChat: ({ onClose }: { onClose: () => void }) => <div><p>报表对话</p><button onClick={onClose}>收起对话</button></div> }));
vi.mock('@/store/authStore', () => ({ useAuthStore: (select: (state: { user: { id: string } }) => unknown) => select({ user: { id: 'viewer' } }) }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('opens a report conversation and restores the launcher when dismissed', () => {
  act(() => root.render(<ReportAgentWidget context={{ reportName: '价敏用户报表', cities: [] }} />));
  const launcher = document.querySelector<HTMLButtonElement>('button[aria-label="打开报表agent"]')!;
  expect(launcher).not.toBeNull();
  expect(launcher.textContent).toBe('');
  act(() => launcher.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('报表对话');
  act(() => document.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click());
  const dialog = document.querySelector<HTMLDivElement>('[role="dialog"]')!;
  expect(dialog.hidden).toBe(true);
  act(() => launcher.click());
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  expect(dialog.hidden).toBe(false);
  expect(document.activeElement).toBe(launcher);
});
it('moves the launcher without treating a drag as a click, then allows the next click', () => {
  act(() => root.render(<ReportAgentWidget context={{ reportName: '价敏用户报表', cities: [] }} />));
  const launcher = document.querySelector<HTMLButtonElement>('button[aria-label="打开报表agent"]')!;
  launcher.setPointerCapture = vi.fn(); launcher.hasPointerCapture = () => true; launcher.releasePointerCapture = vi.fn();
  const pointer = (type: string, x: number, y: number) => { const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }); Object.defineProperty(event, 'pointerId', { value: 1 }); return event; };
  act(() => { launcher.dispatchEvent(pointer('pointerdown', 800, 600)); launcher.dispatchEvent(pointer('pointermove', 600, 400)); launcher.dispatchEvent(pointer('pointerup', 600, 400)); launcher.click(); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(localStorage.getItem('di_agent:report-agent-position:viewer')).not.toBeNull();
  act(() => launcher.click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
