// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PersonalReportCard } from './PersonalReportCard';
import { usePersonalReportStore } from '@/store/personalReportStore';

let host: HTMLDivElement;
let root: Root;

function CurrentLocation() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}{location.search}</span>;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('opens a report card in 我的报表 when clicked from the report Agent', async () => {
  const openWorkspace = vi.fn();
  usePersonalReportStore.setState({ openWorkspace });
  await act(async () => root.render(<MemoryRouter initialEntries={['/reports']}><Routes><Route path="/reports" element={<><PersonalReportCard card={{ type: 'personal_report', id: 'card', report_id: 'report-123', title: '生成的报表' }} conversationId="c" messageId="m" onAction={() => {}} /><CurrentLocation /></>} /></Routes></MemoryRouter>));
  await act(async () => host.querySelector('button')?.click());
  expect(host.querySelector('[data-testid="location"]')?.textContent).toBe('/reports?personalReport=report-123');
  expect(openWorkspace).not.toHaveBeenCalled();
});
