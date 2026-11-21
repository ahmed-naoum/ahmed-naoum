// Materials and light. Metal is a mirror: it only looks as good as the studio it reflects.
import * as THREE from "three";

// ---------------------------------------------------------------- brushed finishes

/** Groove pattern of the finish, named the way product designers name them. */
export type Brush = "straight" | "concentric" | "sunburst";

/**
 * Anisotropy direction map, generated in code at boot (no image files).
 * RG = highlight-stretch direction in tangent space (-1..1 -> 0..1), B = strength.
 * Highlights stretch ACROSS grooves, so: straight grooves along X -> stretch along Y;
 * concentric grooves (turned / vinyl) -> radial streaks; sunburst grooves -> circular arcs.
 * If a finish looks rotated 90 degrees on your geometry, set material.anisotropyRotation = Math.PI / 2.
 */
export function brushMap(kind: Brush, size = 512, strength = 1): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5, v = (y + 0.5) / size - 0.5, r = Math.hypot(u, v) || 1e-6;
      const [dx, dy] = kind === "straight" ? [0, 1] : kind === "concentric" ? [u / r, v / r] : [-v / r, u / r];
      const k = (y * size + x) * 4;
      data[k] = (dx * 0.5 + 0.5) * 255;
      data[k + 1] = (dy * 0.5 + 0.5) * 255;
      data[k + 2] = strength * 255;
      data[k + 3] = 255;
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace; // direction data, not colour
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- materials

export interface MetalOptions {
  /** On metal, colour is only the tint of the reflection. Steel ~#a6a29c, gold ~#e6c27a, copper ~#d9906a. */
  color?: THREE.ColorRepresentation;
  /** 0.05 polished, 0.3 satin, 0.5 bead-blasted. */
  roughness?: number;
  brush?: Brush;
  anisotropy?: number;
}

export const metal = (o: MetalOptions = {}) =>
  new THREE.MeshPhysicalMaterial({
    color: o.color ?? "#a6a29c",
    metalness: 1,
    roughness: o.roughness ?? 0.3,
    ...(o.brush ? { anisotropy: o.anisotropy ?? 0.8, anisotropyMap: brushMap(o.brush) } : {}),
  });

/**
 * Two materials per part: [flat face, edge]. Matches ExtrudeGeometry groups (0 = faces, 1 = walls + bevel).
 * The satin-face / polished-edge contrast is what reads as expensive.
 */
export const faceAndEdge = (face: MetalOptions = {}, edge: MetalOptions = {}) =>
  [metal({ brush: "straight", ...face }), metal({ color: face.color, roughness: 0.06, ...edge })] as const;

/** Heat-tinted / anodised steel. */
export const heatTint = (o: MetalOptions = {}) => {
  const m = metal(o);
  m.iridescence = 1;
  m.iridescenceIOR = 1.8;
  m.iridescenceThicknessRange = [180, 520];
  return m;
};

/** Lacquer / paint over a base colour. */
export const lacquer = (color: THREE.ColorRepresentation) =>
  new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.04 });

/** Gemstone. Transmission costs an extra render pass — use on one hero part, not twenty. */
export const gem = (color: THREE.ColorRepresentation, ior = 2.42) =>
  new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: 0, ior, transmission: 1, thickness: 2, dispersion: 0.2 });

/**
 * Glass that reflects the studio ONLY, added on top of what's behind it. Black base = no diffuse,
 * so all you see is Fresnel reflection. No transmission pass, no fake hot spot — as long as the scene
 * has no punctual lights (the studio environment is the only light; see createStudio).
 */
export const glass = (intensity = 1.4) =>
  new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    metalness: 0,
    roughness: 0.02,
    envMapIntensity: intensity,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

// ---------------------------------------------------------------- the studio

export interface Studio {
  env: THREE.Texture;
  /** Call every frame with the eased cursor/tilt in -1..1. Rotating the studio moves every reflection. */
  aim(scene: THREE.Scene, x: number, y: number): void;
  dispose(): void;
}

export interface StudioOptions {
  room?: THREE.ColorRepresentation;
  blur?: number;
  /**
   * The hero camera angle (polar/azimuth in degrees, as in a cue). A flat metal face mirrors ONE
   * direction; if no panel sits there, the face renders black. Given a hero angle, the key softbox
   * is placed in the face's mirror direction, `offAxis` degrees to the side so it lands as a
   * gradient instead of a flat white sheet. Without it, the key sits at the guide's default spot.
   */
  hero?: { polar: number; azimuth: number };
  offAxis?: number;
}

const DEG = Math.PI / 180;

/** Mirror direction of a camera at (polar, azimuth) off an upward-facing face: same polar, opposite azimuth. */
export function mirrorKey(polar: number, azimuth: number, offAxis = 30, dist = 32): [number, number, number] {
  const p = polar * DEG, a = (azimuth + 180 + offAxis) * DEG;
  return [Math.sin(p) * Math.sin(a) * dist, Math.cos(p) * dist, Math.sin(p) * Math.cos(a) * dist];
}

/**
 * A tiny photo studio baked into the environment map: dark room, one off-axis key softbox,
 * two strip lights that draw the edge lines. Add NO DirectionalLight/PointLight to the main scene:
 * the environment is the light, and glass stays free of hot spots.
 */
export function createStudio(renderer: THREE.WebGLRenderer, opts: StudioOptions = {}): Studio {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(opts.room ?? 0x030303);
  const geos: THREE.BufferGeometry[] = [];
  const panel = (w: number, h: number, power: number, pos: [number, number, number]) => {
    const g = new THREE.PlaneGeometry(w, h);
    geos.push(g);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    studio.add(m);
  };
  panel(22, 14, 3.2, opts.hero ? mirrorKey(opts.hero.polar, opts.hero.azimuth, opts.offAxis) : [-22, 20, 20]); // key softbox, off-axis
  panel(2.4, 34, 7, [30, 4, 12]); //  strip -> right edge line
  panel(2.4, 34, 7, [-30, 4, -14]); // strip -> left rim line
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(studio, opts.blur ?? 0.02);
  pmrem.dispose();
  geos.forEach((g) => g.dispose());
  return {
    env: target.texture,
    aim: (scene, x, y) => scene.environmentRotation.set(y * 0.45, -x * 0.8, 0),
    dispose: () => target.dispose(),
  };
}
