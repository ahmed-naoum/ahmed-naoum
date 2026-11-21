// One engine class you fully control: one fixed full-screen canvas, one clock, one render loop.
import * as THREE from "three";
import { createStudio, type Studio } from "./look";
import { Director, scrollProgress, type Cue, type Shot } from "./director";
import { explode, layoutCallouts, drawCallouts, scrollReveals, blueprint, type Part } from "./show";
import { Pulse } from "./pulse";
import { createPost, Governor, type Post } from "./post";

export interface Product {
  root: THREE.Object3D;
  parts: Part[];
  /** Every moving part reads the same clock. Never keyframe. */
  pose?(time: number, shot: Shot): void;
}

export interface EngineOptions {
  cues: Cue[];
  /** Fixed full-screen <svg> for two-column callouts (optional). */
  callouts?: SVGSVGElement | null;
  background?: THREE.ColorRepresentation;
  fov?: number;
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly director: Director;
  readonly pulse = new Pulse();
  readonly studio: Studio;
  readonly post: Post;
  readonly governor: Governor;
  product?: Product;
  /** Hook for page-level effects that must stay in sync with the render loop. */
  onFrame?: (time: number, shot: Shot) => void;

  private reveals = scrollReveals();
  private raf = 0;
  private last = 0;
  private cursor = { x: 0, y: 0, tx: 0, ty: 0 };
  private blueprintOn = false;

  constructor(readonly canvas: HTMLCanvasElement, readonly opts: EngineOptions) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" }); // MSAA lives in the composer
    this.scene.background = new THREE.Color(opts.background ?? 0x050505);
    this.camera = new THREE.PerspectiveCamera(opts.fov ?? 30, 1, 0.1, 1000);
    const hero = opts.cues[0]?.shot ?? {};
    this.studio = createStudio(this.renderer, { hero: { polar: hero.polar ?? 60, azimuth: hero.azimuth ?? 0 } });
    this.scene.environment = this.studio.env; // the ONLY light in the scene
    this.director = new Director(opts.cues);
    this.post = createPost(this.renderer, this.scene, this.camera);
    this.governor = new Governor((pr, bloom) => {
      this.post.bloom.enabled = bloom;
      this.resize(pr);
    });
    addEventListener("resize", this.onResize);
    addEventListener("pointermove", this.onPointer);
  }

  /** Add the product, compile every shader behind the loader, then start the loop. */
  async start(product: Product) {
    this.product = product;
    this.scene.add(product.root);
    this.resize();
    this.frame(performance.now(), true); // place camera + parts before compiling
    await this.renderer.compileAsync(this.scene, this.camera);
    document.documentElement.classList.add("is-ready"); // CSS hides the loader
    this.last = 0;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Feed phone tilt (-1..1) in place of the cursor. */
  setTilt(x: number, y: number) {
    this.cursor.tx = x;
    this.cursor.ty = y;
  }

  toggleBlueprint(on = !this.blueprintOn) {
    this.blueprintOn = on;
    if (this.product) blueprint(this.product.root, on);
  }

  private onPointer = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    this.cursor.tx = (e.clientX / innerWidth) * 2 - 1;
    this.cursor.ty = (e.clientY / innerHeight) * 2 - 1;
  };

  private onResize = () => this.resize();

  resize(pr = this.governor.pixelRatio) {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h, pr);
    this.director.pinToSections();
    this.reveals.measure();
  }

  private frame(now: number, dryRun = false) {
    if (!dryRun) this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 1 / 60;
    this.last = now;
    const p = this.product!;

    const shot = this.director.update(scrollProgress(), dt, this.camera);
    this.pulse.timeScale = shot.timeScale;
    const time = this.pulse.step(dt);
    p.pose?.(time, shot);
    explode(p.parts, shot.explode);

    const k = 1 - Math.exp(-5 * dt);
    this.cursor.x += (this.cursor.tx - this.cursor.x) * k;
    this.cursor.y += (this.cursor.ty - this.cursor.y) * k;
    this.studio.aim(this.scene, this.cursor.x, this.cursor.y);

    if (this.opts.callouts) {
      const vis = Math.min(1, Math.max(0, (shot.explode - 0.6) / 0.3));
      drawCallouts(this.opts.callouts, vis > 0.01 ? layoutCallouts(p.parts, this.camera, innerWidth, innerHeight) : [], vis);
    }
    this.reveals.update();
    this.onFrame?.(time, shot);
    if (dryRun) return;
    this.post.render(dt);
    this.governor.tick(dt);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener("resize", this.onResize);
    removeEventListener("pointermove", this.onPointer);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.LineSegments).isLineSegments) {
        m.geometry.dispose();
        ([] as THREE.Material[]).concat(m.material).forEach((mat) => mat.dispose());
      }
    });
    this.studio.dispose();
    this.post.composer.dispose();
    this.renderer.dispose();
  }
}
