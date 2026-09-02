export interface PanelPosition {
  x: number;
  y: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface PanelGeometry {
  position: PanelPosition;
  size: PanelSize;
}

export interface PanelSizeConstraints {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

export const DEFAULT_PANEL_SIZE: PanelSize = { width: 320, height: 520 };
export const PANEL_VIEWPORT_MARGIN = 8;
export const PANEL_SNAP_THRESHOLD = 20;
export const PANEL_SIZE_CONSTRAINTS: PanelSizeConstraints = {
  minWidth: 280,
  minHeight: 360,
  maxWidth: 560,
  maxHeight: 760,
};

export function parsePanelPosition(value: string | null): PanelPosition | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as { x?: unknown; y?: unknown };
    if (typeof candidate.x !== 'number' || !Number.isFinite(candidate.x)) return null;
    if (typeof candidate.y !== 'number' || !Number.isFinite(candidate.y)) return null;
    return { x: candidate.x, y: candidate.y };
  } catch {
    return null;
  }
}

export function parsePanelSize(value: string | null): PanelSize | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as { width?: unknown; height?: unknown };
    if (typeof candidate.width !== 'number' || !Number.isFinite(candidate.width) || candidate.width <= 0) return null;
    if (typeof candidate.height !== 'number' || !Number.isFinite(candidate.height) || candidate.height <= 0) return null;
    return { width: candidate.width, height: candidate.height };
  } catch {
    return null;
  }
}

export function clampPanelPosition(
  position: PanelPosition,
  viewport: PanelSize,
  panel: PanelSize,
  margin = PANEL_VIEWPORT_MARGIN,
): PanelPosition {
  const marginX = viewport.width >= panel.width + margin * 2 ? margin : 0;
  const marginY = viewport.height >= panel.height + margin * 2 ? margin : 0;
  const maxX = Math.max(marginX, viewport.width - panel.width - marginX);
  const maxY = Math.max(marginY, viewport.height - panel.height - marginY);
  return {
    x: Math.min(Math.max(position.x, marginX), maxX),
    y: Math.min(Math.max(position.y, marginY), maxY),
  };
}

export interface PanelSnapEdges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

export interface PanelExclusionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function detectPanelSnapEdges(
  position: PanelPosition,
  viewport: PanelSize,
  panel: PanelSize,
  threshold = PANEL_SNAP_THRESHOLD,
  margin = PANEL_VIEWPORT_MARGIN,
): PanelSnapEdges {
  const clamped = clampPanelPosition(position, viewport, panel, margin);
  const marginX = viewport.width >= panel.width + margin * 2 ? margin : 0;
  const marginY = viewport.height >= panel.height + margin * 2 ? margin : 0;
  const right = Math.max(marginX, viewport.width - panel.width - marginX);
  const bottom = Math.max(marginY, viewport.height - panel.height - marginY);
  return {
    left: Math.abs(clamped.x - marginX) <= threshold,
    right: Math.abs(clamped.x - right) <= threshold,
    top: Math.abs(clamped.y - marginY) <= threshold,
    bottom: Math.abs(clamped.y - bottom) <= threshold,
  };
}

export function snapPanelPosition(
  position: PanelPosition,
  viewport: PanelSize,
  panel: PanelSize,
  threshold = PANEL_SNAP_THRESHOLD,
  margin = PANEL_VIEWPORT_MARGIN,
): PanelPosition {
  const clamped = clampPanelPosition(position, viewport, panel, margin);
  const edges = detectPanelSnapEdges(clamped, viewport, panel, threshold, margin);
  const marginX = viewport.width >= panel.width + margin * 2 ? margin : 0;
  const marginY = viewport.height >= panel.height + margin * 2 ? margin : 0;
  const right = Math.max(marginX, viewport.width - panel.width - marginX);
  const bottom = Math.max(marginY, viewport.height - panel.height - marginY);
  return {
    x: edges.left ? marginX : edges.right ? right : clamped.x,
    y: edges.top ? marginY : edges.bottom ? bottom : clamped.y,
  };
}

export function avoidPanelCollision(
  position: PanelPosition,
  viewport: PanelSize,
  panel: PanelSize,
  exclusion: PanelExclusionRect | null,
  margin = PANEL_VIEWPORT_MARGIN,
): PanelPosition {
  const clamped = clampPanelPosition(position, viewport, panel, margin);
  if (!exclusion) return clamped;
  const panelRect = {
    left: clamped.x,
    top: clamped.y,
    right: clamped.x + panel.width,
    bottom: clamped.y + panel.height,
  };
  const overlaps = panelRect.left < exclusion.right
    && panelRect.right > exclusion.left
    && panelRect.top < exclusion.bottom
    && panelRect.bottom > exclusion.top;
  if (!overlaps) return clamped;

  const candidates = [
    { x: clamped.x, y: exclusion.top - panel.height - margin },
    { x: exclusion.left - panel.width - margin, y: clamped.y },
    { x: exclusion.right + margin, y: clamped.y },
  ]
    .map((candidate) => clampPanelPosition(candidate, viewport, panel, margin))
    .filter((candidate) => {
      const rect = {
        left: candidate.x,
        top: candidate.y,
        right: candidate.x + panel.width,
        bottom: candidate.y + panel.height,
      };
      const stillOverlaps = rect.left < exclusion.right
        && rect.right > exclusion.left
        && rect.top < exclusion.bottom
        && rect.bottom > exclusion.top;
      return !stillOverlaps;
    });

  if (candidates.length === 0) return clamped;
  return candidates.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(nearest.x - clamped.x) + Math.abs(nearest.y - clamped.y);
    const candidateDistance = Math.abs(candidate.x - clamped.x) + Math.abs(candidate.y - clamped.y);
    return candidateDistance < nearestDistance ? candidate : nearest;
  });
}

export function clampPanelGeometry(
  position: PanelPosition,
  size: PanelSize,
  viewport: PanelSize,
  constraints: PanelSizeConstraints = PANEL_SIZE_CONSTRAINTS,
): PanelGeometry {
  const viewportWidth = Math.max(0, viewport.width);
  const viewportHeight = Math.max(0, viewport.height);
  const horizontalMargin = viewportWidth >= constraints.minWidth + PANEL_VIEWPORT_MARGIN * 2
    ? PANEL_VIEWPORT_MARGIN
    : 0;
  const verticalMargin = viewportHeight >= constraints.minHeight + PANEL_VIEWPORT_MARGIN * 2
    ? PANEL_VIEWPORT_MARGIN
    : 0;
  const usableWidth = Math.max(0, viewportWidth - horizontalMargin * 2);
  const usableHeight = Math.max(0, viewportHeight - verticalMargin * 2);
  const minWidth = Math.min(constraints.minWidth, usableWidth);
  const minHeight = Math.min(constraints.minHeight, usableHeight);
  const boundedPosition = {
    x: Math.min(
      Math.max(position.x, horizontalMargin),
      Math.max(horizontalMargin, viewportWidth - minWidth - horizontalMargin),
    ),
    y: Math.min(
      Math.max(position.y, verticalMargin),
      Math.max(verticalMargin, viewportHeight - minHeight - verticalMargin),
    ),
  };
  const availableWidth = viewportWidth - boundedPosition.x - horizontalMargin;
  const availableHeight = viewportHeight - boundedPosition.y - verticalMargin;
  const maxWidth = Math.max(minWidth, Math.min(constraints.maxWidth, availableWidth));
  const maxHeight = Math.max(minHeight, Math.min(constraints.maxHeight, availableHeight));

  return {
    position: boundedPosition,
    size: {
      width: Math.min(Math.max(size.width, minWidth), maxWidth),
      height: Math.min(Math.max(size.height, minHeight), maxHeight),
    },
  };
}
