// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import AuthLayout from './AuthLayout';

describe('AuthLayout', () => {
  it('presents product context separately from the account form', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<AuthLayout><form aria-label="测试登录表单"><button type="submit">进入</button></form></AuthLayout>);
    });

    expect(container.querySelector('main')).not.toBeNull();
    expect(container.querySelector('[aria-label="Di Agent 产品介绍"]')?.textContent).toContain('多 Agent 协作');
    expect(container.querySelector('[aria-label="账户访问"] form')).not.toBeNull();
    expect(container.textContent).toContain('Di Agent');

    act(() => root.unmount());
    container.remove();
  });
});
