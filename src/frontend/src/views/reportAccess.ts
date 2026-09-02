export interface ReportAccessPolicy {
  canViewAnalytics: boolean;
  canSearch: boolean;
  canBrowseFullDetail: boolean;
  canViewRunHistory: boolean;
  canManageReports: boolean;
}

export function buildReportAccessPolicy(isAdmin: boolean): ReportAccessPolicy {
  return {
    canViewAnalytics: true,
    canSearch: true,
    canBrowseFullDetail: isAdmin,
    canViewRunHistory: isAdmin,
    canManageReports: isAdmin,
  };
}
