import { describe, expect, it } from 'vitest';
import { buildReportAccessPolicy } from './reportAccess';

describe('buildReportAccessPolicy', () => {
  it('keeps shared analytics and exact search visible while hiding operational data from regular users', () => {
    expect(buildReportAccessPolicy(false)).toEqual({
      canViewAnalytics: true,
      canSearch: true,
      canBrowseFullDetail: false,
      canViewRunHistory: false,
      canManageReports: false,
    });
  });

  it('allows administrators to manage and inspect the full report', () => {
    expect(buildReportAccessPolicy(true)).toEqual({
      canViewAnalytics: true,
      canSearch: true,
      canBrowseFullDetail: true,
      canViewRunHistory: true,
      canManageReports: true,
    });
  });
});
