// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppErrorFallback } from './AppErrorFallback';

describe('AppErrorFallback', () => {
  it('shows a safe recovery message for stale dynamic modules', () => {
    const markup = renderToStaticMarkup(
      <AppErrorFallback error={new TypeError('Failed to fetch dynamically imported module: /assets/SkillsView-old.js')} />,
    );

    expect(markup).toContain('页面版本已更新');
    expect(markup).toContain('重新加载');
    expect(markup).toContain('返回首页');
    expect(markup).toContain('MODULE_VERSION_MISMATCH');
    expect(markup).not.toContain('SkillsView-old.js');
    expect(markup).not.toContain('TypeError');
  });

  it('uses a generic message for unrelated rendering failures', () => {
    const markup = renderToStaticMarkup(<AppErrorFallback error={new Error('private internal detail')} />);

    expect(markup).toContain('页面暂时无法显示');
    expect(markup).not.toContain('private internal detail');
  });
});
