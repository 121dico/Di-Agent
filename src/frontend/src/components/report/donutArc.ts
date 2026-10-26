const center = 130;
const radius = 84;

export function buildDonutArcPath(start: number, end: number): string {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '';
  const point = (turn: number) => {
    const angle = (turn % 1) * 2 * Math.PI;
    return `${center + radius * Math.cos(angle)} ${center + radius * Math.sin(angle)}`;
  };
  // 整圆必须拆成两段弧，SVG 单段弧的起终点重合时不会绘制。
  if (end - start >= 1) return `M ${point(start)} A ${radius} ${radius} 0 0 1 ${point(start + 0.5)} A ${radius} ${radius} 0 0 1 ${point(start)}`;
  return `M ${point(start)} A ${radius} ${radius} 0 ${end - start > 0.5 ? 1 : 0} 1 ${point(end)}`;
}
