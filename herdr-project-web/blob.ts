// The shape of the blob that stands for the page's state.

// How many points the blob's outline passes through.
const POINTS = 7;

/** Returns the points of the blob's outline at time t, in seconds, in a
 * square of size, each moved from a circle by up to wobble times a
 * quarter of its radius. */
export function blobPoints(t: number, size: number, wobble: number): [number, number][] {
  const c = size / 2;
  const r = size * 0.38;
  return Array.from({ length: POINTS }, (_, i) => {
    const angle = (i / POINTS) * 2 * Math.PI;
    const d = 0.16 * Math.sin(t * (0.9 + i * 0.13) + i * 2.1) + 0.09 * Math.sin(t * 1.7 + i * 1.3);
    const ri = r * (1 + wobble * d);
    return [c + ri * Math.cos(angle), c + ri * Math.sin(angle)];
  });
}

/** Returns an SVG path through points, closed and smoothed with cubic
 * curves. */
export function blobPath(points: [number, number][]): string {
  const n = points.length;
  const at = (i: number) => points[(i + n) % n];
  const f = (v: number) => v.toFixed(2);
  let d = `M${f(points[0][0])},${f(points[0][1])}`;
  for (let i = 0; i < n; i++) {
    // Catmull-Rom through each point, as Bézier control points.
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return `${d}Z`;
}
