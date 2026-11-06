export interface DistanceField { width: number; height: number; spread: number; data: Uint8Array }
/** Exact squared Euclidean distance transform, separable in rows and columns. */
function transform1d(f: Float64Array, n: number, out: Float64Array, sites: Int32Array, edges: Float64Array): void {
  let k = 0; sites[0] = 0; edges[0] = -Infinity; edges[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let v = sites[k]!, split = ((f[q]! + q * q) - (f[v]! + v * v)) / (2 * (q - v));
    while (split <= edges[k]! && k > 0) { v = sites[--k]!; split = ((f[q]! + q * q) - (f[v]! + v * v)) / (2 * (q - v)); }
    sites[++k] = q; edges[k] = split; edges[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (edges[k + 1]! < q) k++; const delta = q - sites[k]!; out[q] = delta * delta + f[sites[k]!]!; }
}
function distance(alpha: Uint8Array, width: number, height: number, inside: boolean): Float32Array {
  const size = Math.max(width, height), f = new Float64Array(size), out = new Float64Array(size), sites = new Int32Array(size), edges = new Float64Array(size + 1);
  const grid = new Float32Array(width * height), large = (width * width + height * height) * 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = (alpha[y * width + x]! >= 128) === inside ? 0 : large;
    transform1d(f, width, out, sites, edges); for (let x = 0; x < width; x++) grid[y * width + x] = out[x]!;
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]!;
    transform1d(f, height, out, sites, edges); for (let y = 0; y < height; y++) grid[y * width + x] = out[y]!;
  }
  return grid;
}
export function createDistanceField(alpha: Uint8Array, width: number, height: number, spread = 16): DistanceField {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 1100) || alpha.length !== width * height || !Number.isFinite(spread) || spread <= 0 || spread > 64) throw new Error('INVALID_ALPHA_MASK');
  const toInside = distance(alpha, width, height, true), toOutside = distance(alpha, width, height, false), data = new Uint8Array(alpha.length);
  for (let i = 0; i < data.length; i++) {
    const signed = Math.sqrt(toInside[i]!) - Math.sqrt(toOutside[i]!);
    data[i] = Math.round(255 * Math.max(0, Math.min(1, .5 + signed / (2 * spread))));
  }
  return { width, height, spread, data };
}
