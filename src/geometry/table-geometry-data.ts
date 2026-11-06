export interface RingGeometryData { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array }
interface Point { x: number; z: number; nx: number; nz: number }
const ARC = 32, LINE = 4, COUNT = 2 * (ARC + LINE);
function point(index: number, radius: number, length: number): Point {
  let i = index % COUNT; const half = length / 2;
  if (i < LINE) return { x: -half + length * i / LINE, z: radius, nx: 0, nz: 1 };
  i -= LINE;
  if (i < ARC) { const a = Math.PI / 2 - Math.PI * i / ARC; return { x: half + radius * Math.cos(a), z: radius * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) }; }
  i -= ARC;
  if (i < LINE) return { x: half - length * i / LINE, z: -radius, nx: 0, nz: -1 };
  i -= LINE;
  const a = -Math.PI / 2 - Math.PI * i / ARC;
  return { x: -half + radius * Math.cos(a), z: radius * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) };
}
export function createRingData(): RingGeometryData {
  const data = { positions: new Float32Array(COUNT * 16 * 3), normals: new Float32Array(COUNT * 16 * 3), uvs: new Float32Array(COUNT * 16 * 2), indices: new Uint16Array(COUNT * 24) };
  for (let q = 0; q < COUNT * 4; q++) { const v = q * 4; data.indices.set([v,v+1,v+2,v,v+2,v+3], q*6); }
  return data;
}
/** Updates fixed-topology buffers in place. Radius and height are never scaled by occupancy. */
export function updateRingData(data: RingGeometryData, inner: number, outer: number, length: number, bottom: number, top: number): void {
  if (![inner,outer,length,bottom,top].every(Number.isFinite) || inner <= 0 || outer <= inner || length < 0 || top <= bottom) throw new RangeError('INVALID_RING');
  let vertex = 0;
  const put = (p: Point, y: number, nx: number, ny: number, nz: number): void => {
    data.positions.set([p.x,y,p.z],vertex*3);data.normals.set([nx,ny,nz],vertex*3);data.uvs.set([p.x,p.z],vertex*2);vertex++;
  };
  for(let i=0;i<COUNT;i++) {
    const a=point(i,outer,length),b=point(i+1,outer,length),c=point(i+1,inner,length),d=point(i,inner,length);
    for(const p of [a,b,c,d])put(p,top,0,1,0);
    for(const p of [d,c,b,a])put(p,bottom,0,-1,0);
    put(a,bottom,a.nx,0,a.nz);put(b,bottom,b.nx,0,b.nz);put(b,top,b.nx,0,b.nz);put(a,top,a.nx,0,a.nz);
    put(d,bottom,-d.nx,0,-d.nz);put(d,top,-d.nx,0,-d.nz);put(c,top,-c.nx,0,-c.nz);put(c,bottom,-c.nx,0,-c.nz);
  }
}
