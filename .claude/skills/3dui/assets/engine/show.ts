// The money shot: staggered exploded view, two-column callouts, blueprint toggle, scroll reveals.
import * as THREE from "three";

export interface Part {
  obj: THREE.Object3D;
  /** Assembled position. */
  base: THREE.Vector3;
  /** Offset at full explode, in mm. */
  lift: THREE.Vector3;
  /** 1 = top part (leaves first, returns last) ... 0.1 = bottom part. */
  order: number;
  /** Callout text, optional. */
  label?: string;
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** e: 0 assembled -> 1 exploded. Top parts leave first and come back last. */
export function explode(parts: Part[], e: number) {
  for (const p of parts) {
    const delay = (1 - p.order) * 0.42;
    const t = easeInOutCubic(clamp01((e - delay) / 0.58));
    p.obj.position.copy(p.base).addScaledVector(p.lift, t);
  }
}

/**
 * Build Part records from a vertical stack: order and lift from height. `gap` = mm between parts
 * at full explode. The bottom part stays put.
 */
export function stack(objs: THREE.Object3D[], gap: number, labels: string[] = []): Part[] {
  const sorted = [...objs].sort((a, b) => a.position.y - b.position.y);
  const n = Math.max(1, sorted.length - 1);
  return sorted.map((obj, i) => ({
    obj,
    base: obj.position.clone(),
    lift: new THREE.Vector3(0, gap * i, 0),
    order: 0.1 + (0.9 * i) / n,
    label: labels[objs.indexOf(obj)],
  }));
}

// ---------------------------------------------------------------- callouts

export interface CalloutLayout { x: number; y: number; lx: number; ly: number; side: "left" | "right"; text: string }

const _v = new THREE.Vector3();

/**
 * Project each part's world position to the screen and stack labels in two clean columns
 * (left half of the parts -> left column) without overlaps. Call every frame.
 */
export function layoutCallouts(parts: Part[], camera: THREE.Camera, w: number, h: number, opts = { margin: 16, gap: 30 }): CalloutLayout[] {
  const pts = parts
    .filter((p) => p.label)
    .map((p) => {
      p.obj.getWorldPosition(_v).project(camera);
      return { x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * h, text: p.label! };
    })
    .sort((a, b) => a.x - b.x);
  const half = Math.ceil(pts.length / 2);
  const out: CalloutLayout[] = [];
  ([["left", pts.slice(0, half)], ["right", pts.slice(half)]] as const).forEach(([side, col]) => {
    const ys = [...col].sort((a, b) => a.y - b.y);
    const ly = ys.map((p) => p.y);
    for (let i = 1; i < ly.length; i++) ly[i] = Math.max(ly[i], ly[i - 1] + opts.gap);
    const overflow = ly.length ? ly[ly.length - 1] - (h - opts.gap) : 0;
    if (overflow > 0) for (let i = 0; i < ly.length; i++) ly[i] -= overflow;
    // Labels pin to the screen margins and sit ON their leader line, so they never overflow a phone.
    ys.forEach((p, i) => out.push({ ...p, side, ly: ly[i], lx: side === "left" ? opts.margin : w - opts.margin }));
  });
  return out;
}

/** Minimal SVG renderer: dot -> elbow -> margin, label text riding on the line. `svg` = fixed full-screen overlay. */
export function drawCallouts(svg: SVGSVGElement, layout: CalloutLayout[], opacity = 1) {
  svg.style.opacity = String(opacity);
  const w = svg.clientWidth || innerWidth;
  svg.innerHTML = layout
    .map((c) => {
      const left = c.side === "left";
      const elbow = left ? Math.min(c.x - 12, w * 0.3) : Math.max(c.x + 12, w * 0.7);
      return `<circle cx="${c.x}" cy="${c.y}" r="2.5" fill="currentColor"/>` +
        `<polyline points="${c.x},${c.y} ${elbow},${c.ly} ${c.lx},${c.ly}" fill="none" stroke="currentColor" stroke-width="1" opacity=".55"/>` +
        `<text x="${c.lx}" y="${c.ly - 6}" text-anchor="${left ? "start" : "end"}" font-size="10" letter-spacing=".14em" fill="currentColor">${c.text}</text>`;
    })
    .join("");
}

// ---------------------------------------------------------------- blueprint mode

/** One toggle swaps every surface for its edges. Instant proof it's geometry, not a video. */
export function blueprint(root: THREE.Object3D, on: boolean, color: THREE.ColorRepresentation = 0x8fc7ff) {
  const line = (root.userData.blueprintMat ??= new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || o.userData.isBlueprint) return;
    let edges = o.userData.edges as THREE.LineSegments | undefined;
    if (!edges && on) {
      edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), line);
      edges.userData.isBlueprint = true;
      o.add(edges);
      o.userData.edges = edges;
    }
    if (edges) edges.visible = on;
    for (const mat of ([] as THREE.Material[]).concat(m.material)) mat.visible = !on;
  });
}

// ---------------------------------------------------------------- scroll-driven reveals

/**
 * Reveal copy from scroll POSITION, not IntersectionObserver: observers skip beats on heavy GPU
 * frames and text randomly never appears. Call update() every frame from the render loop.
 */
export function scrollReveals(selector = "[data-reveal]", threshold = 0.82) {
  let items: { el: HTMLElement; top: number }[] = [];
  const measure = () => {
    items = [...document.querySelectorAll<HTMLElement>(selector)].map((el) => ({ el, top: el.getBoundingClientRect().top + scrollY }));
  };
  measure();
  return {
    measure,
    update() {
      const line = scrollY + innerHeight * threshold;
      for (const it of items) it.el.classList.toggle("is-in", line > it.top);
    },
  };
}
