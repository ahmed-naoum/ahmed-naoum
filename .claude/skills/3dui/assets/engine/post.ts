// Finish it like film: MSAA HDR -> bloom (glints only) -> ACES -> grain. Then keep it at 40+ fps.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const GrainShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 0.04 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time; uniform float amount; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float n = hash(gl_FragCoord.xy + fract(time * 7.13) * 911.0) - 0.5;
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb += n * amount * (1.0 - lum * 0.6); // grain lives in the shadows, like film
      gl_FragColor = c;
    }`,
};

export interface Post {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  grain: ShaderPass;
  setSize(w: number, h: number, pixelRatio: number): void;
  render(dt: number): void;
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Post {
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // applied by OutputPass, not on the HDR buffer
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }); // MSAA HDR
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  // HDR threshold > 1: only specular glints off the strip lights bloom, never the whole object.
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.25, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grain = new ShaderPass(GrainShader);
  composer.addPass(grain);
  return {
    composer,
    bloom,
    grain,
    setSize(w, h, pr) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
    },
    render(dt) {
      grain.uniforms.time.value += dt;
      composer.render(dt);
    },
  };
}

export const isPhone = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/**
 * Adaptive quality. Start at min(DPR, 1.75 on phones / 2 elsewhere). If fps < 40 over a 1 s
 * window: step resolution down by 0.25 (floor 1), then turn bloom off. Never steps back up —
 * oscillating quality is worse than slightly soft.
 */
export class Governor {
  pixelRatio: number;
  private frames = 0;
  private acc = 0;
  private grace = 2; // seconds to ignore after start: shader warm-up isn't representative
  constructor(private apply: (pr: number, bloom: boolean) => void, public minFps = 40) {
    this.pixelRatio = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, isPhone() ? 1.75 : 2);
  }
  private bloom = true;
  tick(dt: number) {
    if ((this.grace -= dt) > 0) return;
    this.frames++;
    this.acc += dt;
    if (this.acc < 1) return;
    const fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    if (fps >= this.minFps) return;
    if (this.pixelRatio > 1) this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
    else if (this.bloom) this.bloom = false;
    else return;
    this.apply(this.pixelRatio, this.bloom);
    this.grace = 1;
  }
}
