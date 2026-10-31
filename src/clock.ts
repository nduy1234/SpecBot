// Offset between this browser's clock and the Convex server clock.
let offset = 0;

export function setServerOffset(o: number) {
  offset = o;
}

export function serverNow() {
  return Date.now() + offset;
}
