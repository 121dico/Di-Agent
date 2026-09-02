const COMPACT_VIEWPORT = 1024;
const BASE_VIEWPORT = 1440;
const LARGE_VIEWPORT = 2560;
const MIN_DESKTOP_SCALE = 0.9;
const MAX_DESKTOP_SCALE = 1.22;
const MOBILE_CUTOFF = 768;

const interpolate = (value: number, from: number, to: number, start: number, end: number) => (
  start + ((value - from) / (to - from)) * (end - start)
);

/**
 * Keeps dense laptop layouts compact while making the entire workbench easier
 * to read on large external displays. Mobile keeps native sizing so touch
 * targets never shrink.
 */
export const calculateDisplayScale = (viewportWidth: number): number => {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 1;
  if (viewportWidth <= MOBILE_CUTOFF) return 1;
  if (viewportWidth < COMPACT_VIEWPORT) {
    return Number(interpolate(
      viewportWidth,
      MOBILE_CUTOFF,
      COMPACT_VIEWPORT,
      1,
      MIN_DESKTOP_SCALE,
    ).toFixed(3));
  }
  if (viewportWidth === COMPACT_VIEWPORT) return MIN_DESKTOP_SCALE;
  if (viewportWidth < BASE_VIEWPORT) {
    return Number(interpolate(
      viewportWidth,
      COMPACT_VIEWPORT,
      BASE_VIEWPORT,
      MIN_DESKTOP_SCALE,
      1,
    ).toFixed(3));
  }
  if (viewportWidth < LARGE_VIEWPORT) {
    return Number(interpolate(
      viewportWidth,
      BASE_VIEWPORT,
      LARGE_VIEWPORT,
      1,
      MAX_DESKTOP_SCALE,
    ).toFixed(3));
  }
  return MAX_DESKTOP_SCALE;
};

export const applyDisplayScale = () => {
  const scale = CSS.supports('zoom', '1')
    ? calculateDisplayScale(window.innerWidth)
    : 1;
  const root = document.documentElement;

  root.style.setProperty('--ui-display-scale', String(scale));
  root.style.setProperty('--ui-viewport-width', `${window.innerWidth / scale}px`);
  root.style.setProperty('--ui-viewport-height', `${window.innerHeight / scale}px`);
  root.dataset.displayScale = scale.toFixed(3);
};

export const installDisplayScale = () => {
  let frame = 0;
  const schedule = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(applyDisplayScale);
  };

  applyDisplayScale();
  window.addEventListener('resize', schedule, { passive: true });

  return () => {
    window.cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
  };
};
