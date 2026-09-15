// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { getReportSourceTimeCoverage, refreshReportSourceTimeCoverage } from './report';

afterEach(() => vi.unstubAllGlobals());
it('reads metadata with GET and explicitly verifies with POST without exposing source credentials', async () => {
  const response = { source_id: 'one', status: 'unchecked', continuous: false };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, data: response }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await getReportSourceTimeCoverage('one')).toEqual(response);
  expect(fetcher).toHaveBeenLastCalledWith('/api/reports/sources/one/time-coverage', expect.objectContaining({ method: 'GET', body: undefined }));
  fetcher.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: response }), { status: 200 }));
  await refreshReportSourceTimeCoverage('one');
  expect(fetcher).toHaveBeenLastCalledWith('/api/reports/sources/one/time-coverage', expect.objectContaining({ method: 'POST', body: undefined }));
});
