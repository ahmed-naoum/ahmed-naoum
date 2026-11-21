// Give it a pulse: one clock drives every moving part, sound is synthesized, and one gesture
// unlocks audio + tilt.

/** One clock. Every animated thing reads `time` — nothing keyframed, nothing drifts. */
export class Pulse {
  time = 0;
  timeScale = 1;
  private lastBeat = -1;
  /** bpm: how often onBeat fires at timeScale 1. */
  constructor(public bpm = 120, public onBeat?: (beat: number) => void) {}
  step(dt: number) {
    this.time += Math.min(dt, 1 / 20) * this.timeScale; // clamp: no jump after a background tab
    const beat = Math.floor((this.time * this.bpm) / 60);
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      this.onBeat?.(beat);
    }
    return this.time;
  }
}

/** Zero audio files: clicks and taps are filtered noise bursts. */
export class Synth {
  ctx?: AudioContext;
  private noise?: AudioBuffer;
  master?: GainNode;

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const len = Math.floor(this.ctx.sampleRate * 0.2);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const ch = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state !== "running") void this.ctx.resume();
  }

  get ready() {
    return this.ctx?.state === "running";
  }

  /** freq: 4000 = tick, 1800 = tap, 400 = thunk. decay in seconds. */
  burst(freq = 3800, decay = 0.03, gain = 0.35, q = 4) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.1);
    src.stop(t + decay + 0.02);
  }

  tick() { this.burst(4200, 0.025, 0.3); }
  tap() { this.burst(1800, 0.05, 0.4, 2); }
  thunk() { this.burst(380, 0.12, 0.7, 1.2); }
}

/** Phone tilt in -1..1. iOS needs requestPermission() inside a gesture; others just work. */
export async function enableTilt(onTilt: (x: number, y: number) => void): Promise<boolean> {
  const D = (globalThis as any).DeviceOrientationEvent;
  if (!D) return false;
  try {
    if (typeof D.requestPermission === "function" && (await D.requestPermission()) !== "granted") return false;
  } catch {
    return false;
  }
  const c = (v: number) => Math.max(-1, Math.min(1, v));
  addEventListener("deviceorientation", (e) => onTilt(c((e.gamma ?? 0) / 30), c(((e.beta ?? 45) - 45) / 30)));
  return true;
}

export interface HoldOptions {
  /** ms of holding to complete. */
  ms?: number;
  onProgress?: (p: number) => void;
  onComplete?: () => void;
  /** Runs inside the first real gesture: unlock audio, request tilt. */
  onUnlock?: () => void;
}

/**
 * Hold-to-<verb> with a progress value for a ring. The first press also unlocks audio and tilt.
 * Browsers only grant "user activation" on pointerdown for MOUSE; on touch it's pointerup/touchend.
 * So unlock is attempted on both — the first tap on a phone unlocks on release.
 */
export function holdTo(el: HTMLElement, o: HoldOptions = {}) {
  const ms = o.ms ?? 1100;
  let p = 0, holding = false, last = 0, raf = 0, unlocked = false;
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    o.onUnlock?.();
  };
  const loop = (now: number) => {
    const dt = last ? now - last : 16;
    last = now;
    p = Math.max(0, Math.min(1, p + (holding ? dt / ms : (-2 * dt) / ms)));
    o.onProgress?.(p);
    if (p >= 1) {
      holding = false;
      p = 0;
      o.onComplete?.();
    }
    raf = p > 0 || holding ? requestAnimationFrame(loop) : 0;
    if (!raf) last = 0;
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse") unlock();
    holding = true;
    el.setPointerCapture?.(e.pointerId);
    if (!raf) raf = requestAnimationFrame(loop);
  };
  const up = (e: PointerEvent) => {
    if (e.type === "pointerup") unlock();
    holding = false;
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("contextmenu", (e) => e.preventDefault()); // long-press menu on mobile
  return () => {
    cancelAnimationFrame(raf);
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
  };
}
