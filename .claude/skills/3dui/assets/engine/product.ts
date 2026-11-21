// TEMPLATE PRODUCT — replace with the real object. Every part in real millimetres.
// Shown: SDF plate with a fillet + hole, brushed face / polished edge, a ring, additive glass,
// a lathe-turned crown, a stack explode, and a pose() driven by the shared clock.
import * as THREE from "three";
import { circle, capsule, smooth, subtract, shell, extrudePart, lathePart } from "./geometry";
import { faceAndEdge, metal, glass } from "./look";
import { stack } from "./show";
import type { Product } from "./Engine";
import type { Cue } from "./director";

export function buildProduct(): Product {
  const root = new THREE.Group();

  // Part list with real sizes (mm): base 52 x 32 x 4, dial Ø28 x 1.2, bezel Ø32 x 3, crystal Ø27 x 1, crown Ø11 x 4.5
  const baseShape = subtract(
    smooth(2.0, circle(0, 0, 16), capsule(0, 0, 26, 0, 5), circle(26, 0, 6)), // melt three shapes, 2 mm fillet
    circle(26, 0, 2.5), // lanyard hole
  );
  const base = new THREE.Mesh(extrudePart(baseShape, { depth: 4 }), [...faceAndEdge({ brush: "straight" })]);

  const dial = new THREE.Mesh(extrudePart(circle(0, 0, 14), { depth: 1.2 }), [
    ...faceAndEdge({ brush: "sunburst", color: "#b9b4ad", roughness: 0.25 }),
  ]);
  const bezel = new THREE.Mesh(extrudePart(shell(circle(0, 0, 15), 2), { depth: 3 }), [
    ...faceAndEdge({ brush: "concentric", roughness: 0.22 }),
  ]);
  const crystal = new THREE.Mesh(extrudePart(circle(0, 0, 13.5), { depth: 1, bevel: 0.3 }), glass());
  crystal.renderOrder = 10; // additive glass draws after the opaque parts

  // Closed profile [radius, height]; winding is fixed automatically.
  const crown = new THREE.Mesh(
    lathePart([[0, 0], [5.5, 0], [5.5, 3.6], [5.0, 4.5], [0, 4.5], [0, 0]], 128),
    metal({ roughness: 0.08 }),
  );

  base.position.y = 0;
  dial.position.y = 2.6;
  bezel.position.y = 3.6;
  crystal.position.y = 4.7;
  crown.position.y = 5.3;
  const objs = [base, dial, bezel, crystal, crown];
  objs.forEach((o) => root.add(o));
  const parts = stack(objs, 9, ["BASE · 316L", "DIAL · SUNBURST", "BEZEL · TURNED", "CRYSTAL", "CROWN"]);

  return {
    root,
    parts,
    pose(time) {
      crown.rotation.y = time * 0.6; // the clock, not a keyframe
    },
  };
}

/** Five beats: hero, close-up, apart, around, back together. */
export const cues: Cue[] = [
  { id: "hero", at: 0, shot: { frame: 70, polar: 28, azimuth: -20, offsetX: 0.17 } },
  { id: "close", at: 0.3, shot: { frame: 30, polar: 50, offsetX: 0, timeScale: 1 / 12 } },
  { id: "apart", at: 0.55, shot: { frame: 95, polar: 72, explode: 1, lookY: 16, timeScale: 1 } },
  { id: "around", at: 0.75, shot: { azimuth: 160 } },
  { id: "rebuild", at: 0.9, shot: { frame: 70, polar: 35, explode: 0, lookY: 0, azimuth: 320 } },
  { id: "outro", at: 1, shot: { polar: 28, azimuth: 340, offsetX: -0.17 } },
];
