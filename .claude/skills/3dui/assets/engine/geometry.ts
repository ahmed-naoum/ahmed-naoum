// Procedural part geometry in real millimetres (1 three.js unit = 1 mm).
// Pipeline: 2D signed-distance shapes -> smooth union ("melt") -> marching-squares
// trace -> THREE.Shape with holes -> ExtrudeGeometry with a tiny polished bevel.
import * as THREE from "three";

/** A 2D signed-distance field in mm. d < 0 is inside. `b` = conservative bounds [minX, minY, maxX, maxY]. */
export interface Sdf {
  d: (x: number, y: number) => number;
  b: [number, number, number, number];
}

export const circle = (cx: number, cy: number, r: number): Sdf => ({
  d: (x, y) => Math.hypot(x - cx, y - cy) - r,
  b: [cx - r, cy - r, cx + r, cy + r],
});

/** Stadium from (ax,ay) to (bx,by) with radius r. */
export const capsule = (ax: number, ay: number, bx: number, by: number, r: number): Sdf => {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-12;
  return {
    d: (x, y) => {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      return Math.hypot(x - ax - dx * t, y - ay - dy * t) - r;
    },
    b: [Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r],
  };
};

/** Rectangle centred on (cx,cy), size w x h, corner radius r. */
export const roundRect = (cx: number, cy: number, w: number, h: number, r = 0): Sdf => {
  const hx = w / 2 - r, hy = h / 2 - r;
  return {
    d: (x, y) => {
      const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    },
    b: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
  };
};

// Quadratic smooth-min: the blend region is ~k mm wide, which reads as a fillet of radius ~k.
const smin = (a: number, b: number, k: number) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

const unionBounds = (shapes: Sdf[], pad: number): Sdf["b"] => [
  Math.min(...shapes.map((s) => s.b[0])) - pad,
  Math.min(...shapes.map((s) => s.b[1])) - pad,
  Math.max(...shapes.map((s) => s.b[2])) + pad,
  Math.max(...shapes.map((s) => s.b[3])) + pad,
];

/** "Melt" shapes together with a fillet of radius ~k mm. k = 0 is a hard union. */
export const smooth = (k: number, ...shapes: Sdf[]): Sdf => ({
  d: (x, y) => shapes.reduce((acc, s) => smin(acc, s.d(x, y), k), Infinity),
  b: unionBounds(shapes, k),
});

/** Cut b out of a (holes, notches). k > 0 rounds the cut's edges. */
export const subtract = (a: Sdf, b: Sdf, k = 0): Sdf => ({
  d: (x, y) => -smin(-a.d(x, y), b.d(x, y), k),
  b: a.b,
});

/** Grow (r > 0) or shrink (r < 0) a shape. */
export const offset = (s: Sdf, r: number): Sdf => ({
  d: (x, y) => s.d(x, y) - r,
  b: [s.b[0] - Math.max(r, 0), s.b[1] - Math.max(r, 0), s.b[2] + Math.max(r, 0), s.b[3] + Math.max(r, 0)],
});

/** Hollow outline of a shape, `wall` mm thick (rings, bezels). */
export const shell = (s: Sdf, wall: number): Sdf => ({
  d: (x, y) => Math.abs(s.d(x, y)) - wall / 2,
  b: [s.b[0] - wall, s.b[1] - wall, s.b[2] + wall, s.b[3] + wall],
});

/**
 * Marching squares: trace the d = 0 contour into THREE.Shapes (outer loops CCW, holes CW and
 * attached to their parent). `cell` is the sample spacing in mm — 0.05–0.1 mm is plenty.
 */
export function traceLoops(s: Sdf, cell = 0.08): THREE.Shape[] {
  const pad = cell * 2;
  const ox = s.b[0] - pad, oy = s.b[1] - pad;
  const nx = Math.ceil((s.b[2] - s.b[0] + 2 * pad) / cell) + 1;
  const ny = Math.ceil((s.b[3] - s.b[1] + 2 * pad) / cell) + 1;
  const v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const d = s.d(ox + i * cell, oy + j * cell);
      v[j * nx + i] = d === 0 ? 1e-9 : d; // never exactly on the contour: avoids duplicate points
    }

  // Edge ids: horizontal edge (i,j)->(i+1,j) = 2k, vertical edge (i,j)->(i,j+1) = 2k+1, k = j*nx+i.
  const H = (i: number, j: number) => (j * nx + i) * 2;
  const V = (i: number, j: number) => (j * nx + i) * 2 + 1;
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  };

  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const v00 = v[j * nx + i], v10 = v[j * nx + i + 1], v11 = v[(j + 1) * nx + i + 1], v01 = v[(j + 1) * nx + i];
      const c = (v00 < 0 ? 1 : 0) | (v10 < 0 ? 2 : 0) | (v11 < 0 ? 4 : 0) | (v01 < 0 ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const bot = H(i, j), right = V(i + 1, j), top = H(i, j + 1), left = V(i, j);
      const centreIn = v00 + v10 + v11 + v01 < 0;
      switch (c) {
        case 1: case 14: link(left, bot); break;
        case 2: case 13: link(bot, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(right, top); break;
        case 6: case 9: link(bot, top); break;
        case 7: case 8: link(left, top); break;
        case 5: if (centreIn) { link(bot, right); link(top, left); } else { link(left, bot); link(right, top); } break;
        case 10: if (centreIn) { link(left, bot); link(right, top); } else { link(bot, right); link(top, left); } break;
      }
    }

  const pointOf = (id: number) => {
    const k = id >> 1, i = k % nx, j = (k / nx) | 0;
    const a = v[j * nx + i];
    if (id & 1) { const b = v[(j + 1) * nx + i]; const t = a / (a - b); return new THREE.Vector2(ox + i * cell, oy + (j + t) * cell); }
    const b = v[j * nx + i + 1]; const t = a / (a - b); return new THREE.Vector2(ox + (i + t) * cell, oy + j * cell);
  };

  // Walk the adjacency graph into closed loops.
  const seen = new Set<number>();
  const loops: THREE.Vector2[][] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const ids = [start]; seen.add(start);
    let prev = start, cur = adj.get(start)![0];
    for (let guard = 0; cur !== start && guard < 1e7; guard++) {
      ids.push(cur); seen.add(cur);
      const n = adj.get(cur)!;
      const next = n[0] === prev ? n[1] : n[0];
      prev = cur; cur = next;
    }
    if (ids.length >= 3) loops.push(simplify(ids.map(pointOf), cell * 0.03));
  }

  // Nesting: even depth = outer boundary, odd depth = hole.
  const area = loops.map((l) => THREE.ShapeUtils.area(l));
  const depth = loops.map((l, a) => loops.reduce((n, o, b) => (a !== b && inside(l[0], o) ? n + 1 : n), 0));
  const shapes = new Map<number, THREE.Shape>();
  loops.forEach((l, a) => {
    if (depth[a] % 2) return;
    shapes.set(a, new THREE.Shape(area[a] < 0 ? [...l].reverse() : l));
  });
  loops.forEach((l, a) => {
    if (depth[a] % 2 === 0) return;
    let parent = -1;
    shapes.forEach((_, o) => {
      if (depth[o] === depth[a] - 1 && inside(l[0], loops[o]) && (parent < 0 || Math.abs(area[o]) < Math.abs(area[parent]))) parent = o;
    });
    if (parent >= 0) shapes.get(parent)!.holes.push(new THREE.Path(area[a] > 0 ? [...l].reverse() : l));
  });
  return [...shapes.values()];
}

function inside(p: THREE.Vector2, poly: THREE.Vector2[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

// Drop points that sit on the line between their neighbours (straight runs need 2 points, not 300).
function simplify(pts: THREE.Vector2[], eps: number) {
  let out = pts;
  for (let pass = 0; pass < 4; pass++) {
    const next: THREE.Vector2[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = next.length ? next[next.length - 1] : out[out.length - 1];
      const p = out[i], b = out[(i + 1) % out.length];
      const abx = b.x - a.x, aby = b.y - a.y, len = Math.hypot(abx, aby) || 1e-12;
      const dist = Math.abs(abx * (p.y - a.y) - aby * (p.x - a.x)) / len;
      if (dist > eps || i % 2) next.push(p); // keep every other point per pass so curves survive
    }
    if (next.length === out.length || next.length < 8) break;
    out = next;
  }
  return out;
}

/** Top-face UVs normalised to the part's bounds (0..1), so brushed direction maps line up with the part. */
function boundsUV(b: Sdf["b"]) {
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, size = Math.max(b[2] - b[0], b[3] - b[1]);
  return {
    generateTopUV(_g: THREE.ExtrudeGeometry, verts: number[], a: number, bb: number, c: number) {
      return [a, bb, c].map((k) => new THREE.Vector2((verts[k * 3] - cx) / size + 0.5, (verts[k * 3 + 1] - cy) / size + 0.5));
    },
    // Same as three's WorldUVGenerator: walls unwrap along whichever axis the wall runs.
    generateSideWallUV(_g: THREE.ExtrudeGeometry, verts: number[], a: number, bb: number, c: number, d: number) {
      const useX = Math.abs(verts[a * 3 + 1] - verts[bb * 3 + 1]) < Math.abs(verts[a * 3] - verts[bb * 3]);
      return [a, bb, c, d].map((k) => new THREE.Vector2(verts[k * 3 + (useX ? 0 : 1)], 1 - verts[k * 3 + 2]));
    },
  };
}

export interface ExtrudeOptions {
  /** Total thickness in mm, bevels included. */
  depth: number;
  /** Bevel size AND thickness in mm. 0.05 is the "luxury edge". Set both: three.js defaults thickness to 0.2. */
  bevel?: number;
  bevelSegments?: number;
  /** Marching-squares cell in mm. */
  cell?: number;
  /** Lay the part flat (thickness along +Y) so explode lifts are simply +Y. Default true. */
  flat?: boolean;
}

/**
 * Extrude a 2D SDF into a centred part. Material groups: 0 = flat faces, 1 = walls + bevel.
 * Use `mesh.material = [face, edge]`.
 */
export function extrudePart(s: Sdf, o: ExtrudeOptions): THREE.ExtrudeGeometry {
  const bevel = o.bevel ?? 0.05;
  const core = Math.max(o.depth - 2 * bevel, 0.001);
  const g = new THREE.ExtrudeGeometry(traceLoops(s, o.cell ?? 0.08), {
    depth: core,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelOffset: -bevel, // keep the outer wall on the true contour: dimensions stay honest
    bevelSegments: o.bevelSegments ?? 3,
    curveSegments: 1,
    UVGenerator: boundsUV(s.b) as any,
  });
  g.translate(0, 0, -core / 2);
  if (o.flat ?? true) g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * Turned parts (knobs, lens barrels, bottle necks). profile = [radius, height] pairs in mm.
 * A closed profile is auto-wound counter-clockwise: clockwise profiles render inside out.
 * Open profiles: faces point to the RIGHT of the path direction, so draw outer walls bottom -> top.
 */
export function lathePart(profile: [number, number][], segments = 96): THREE.LatheGeometry {
  let pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const closed = pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6;
  if (closed && THREE.ShapeUtils.isClockWise(pts)) pts = pts.reverse();
  return new THREE.LatheGeometry(pts, segments);
}
