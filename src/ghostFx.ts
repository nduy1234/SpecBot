// Timing/opacity curves for the Halloween ghost-sheet effects (pure, unit-tested).

// Sheet stays solid above 30% battery, fades gently to 0.6 at 10% and below.
export function sheetOpacity(battery: number) {
  const t = Math.min(1, Math.max(0, (battery - 10) / 20));
  return 0.6 + 0.4 * t;
}

export const BOO_MS = 1600;

// "Boo!" bubble after the robot starts moving: quick pop in, hold, fade out. Returns { alpha, scale }.
export function booStyle(msSinceStart: number) {
  if (msSinceStart < 0 || msSinceStart >= BOO_MS) return { alpha: 0, scale: 0.8 };
  const pop = Math.min(1, msSinceStart / 150);
  const fade = Math.min(1, (BOO_MS - msSinceStart) / 400);
  return { alpha: Math.min(pop, fade), scale: 0.8 + 0.25 * pop - 0.05 * (1 - fade) };
}

// Afterimage i of n (0 = closest to the robot), scaled by how fast the robot is moving (0..1).
export function trailAlpha(i: number, n: number, speed: number) {
  return 0.3 * (1 - i / n) * Math.min(1, Math.max(0, speed));
}
