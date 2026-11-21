// The scroll directs the camera: a list of cues pinned to page sections, blended by scroll
// position, then eased toward every frame so fast flicks still glide.
import * as THREE from "three";

export interface Shot {
  /** Millimetres that fit across the SMALLER screen dimension. Frame by size, never by distance. */
  frame: number;
  /** Degrees down from straight above (three.js Spherical phi). 10 = near top-down, 90 = side-on. */
  polar: number;
  /** Degrees around the vertical axis. Go past 360 for a full "around" orbit. */
  azimuth: number;
  /** Push the object sideways by this fraction of screen width (+ = right) to make room for copy. */
  offsetX: number;
  /** Point the camera looks at, in mm (y lets you aim at a raised, exploded stack). */
  lookY: number;
  /** 0 = assembled, 1 = fully exploded. */
  explode: number;
  /** Clock speed. 1/12 = real slow motion in the close-up. */
  timeScale: number;
}

export interface Cue {
  id: string;
  /** Scroll progress 0..1. Overwritten by pinToSections() when a [data-cue="id"] element exists. */
  at: number;
  shot: Partial<Shot>;
}

const BASE: Shot = { frame: 60, polar: 60, azimuth: 0, offsetX: 0, lookY: 0, explode: 0, timeScale: 1 };
const KEYS = Object.keys(BASE) as (keyof Shot)[];
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export class Director {
  private cues: { id: string; at: number; shot: Shot }[] = [];
  readonly current: Shot = { ...BASE };
  private target: Shot = { ...BASE };
  private first = true;

  /** damping: higher = snappier. 4 feels like a dolly, 8 like a handheld. */
  constructor(cues: Cue[], public damping = 4) {
    this.setCues(cues);
  }

  /** Each cue inherits whatever it doesn't specify from the cue before it. */
  setCues(cues: Cue[]) {
    let prev: Shot = BASE;
    this.cues = [...cues]
      .sort((a, b) => a.at - b.at)
      .map((c) => {
        prev = { ...prev, ...c.shot } as Shot;
        return { id: c.id, at: c.at, shot: prev };
      });
  }

  /** Pin cue.at to the top of the section marked data-cue="<id>". Call on load and on resize. */
  pinToSections(root: ParentNode = document) {
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    for (const c of this.cues) {
      const el = root.querySelector<HTMLElement>(`[data-cue="${c.id}"]`);
      if (el) c.at = Math.min(1, Math.max(0, (el.getBoundingClientRect().top + scrollY) / max));
    }
    this.cues.sort((a, b) => a.at - b.at);
  }

  /** Blend the two cues around `progress`. */
  shotAt(progress: number, out: Shot = { ...BASE }): Shot {
    const cs = this.cues;
    if (!cs.length) return Object.assign(out, BASE);
    let i = 0;
    while (i < cs.length - 1 && progress >= cs[i + 1].at) i++;
    const a = cs[i], b = cs[Math.min(i + 1, cs.length - 1)];
    const t = b === a ? 0 : smoother(Math.min(1, Math.max(0, (progress - a.at) / (b.at - a.at))));
    for (const k of KEYS) out[k] = a.shot[k] + (b.shot[k] - a.shot[k]) * t;
    return out;
  }

  /** Blend, ease, and place the camera. Returns the eased shot (read explode / timeScale from it). */
  update(progress: number, dt: number, camera: THREE.PerspectiveCamera): Shot {
    this.shotAt(progress, this.target);
    const k = this.first ? 1 : 1 - Math.exp(-this.damping * dt);
    this.first = false;
    for (const key of KEYS) this.current[key] += (this.target[key] - this.current[key]) * k;
    place(camera, this.current);
    return this.current;
  }
}

const DEG = Math.PI / 180;
const _look = new THREE.Vector3(), _right = new THREE.Vector3();

/** Fit `frame` mm across the smaller screen dimension — the same cue works on a phone and a monitor. */
export function place(camera: THREE.PerspectiveCamera, s: Shot) {
  const halfV = Math.tan((camera.fov * DEG) / 2);
  const half = Math.min(halfV, halfV * camera.aspect);
  const dist = s.frame / 2 / half;
  const p = s.polar * DEG, az = s.azimuth * DEG;
  _look.set(0, s.lookY, 0);
  camera.position.set(Math.sin(p) * Math.sin(az), Math.cos(p), Math.sin(p) * Math.cos(az)).multiplyScalar(dist).add(_look);
  camera.lookAt(_look);
  // Slide the camera sideways so the object sits offsetX of the screen width off-centre.
  const visibleW = 2 * dist * halfV * camera.aspect;
  _right.setFromMatrixColumn(camera.matrixWorld, 0);
  camera.position.addScaledVector(_right, -s.offsetX * visibleW);
  const near = dist / 50, far = dist * 50;
  if (Math.abs(camera.near - near) > near * 0.05 || Math.abs(camera.far - far) > far * 0.05) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}

/** Page scroll as 0..1. */
export const scrollProgress = () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
};
