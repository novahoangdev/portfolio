import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { SideProject } from '../../../data/projects';
import { ProjectMediaView } from '../project-media';
import { kindLabel, OpenCase, pad, prefersReducedMotion } from './shared';

/** Mirror segments in the mandala (even, so the reflections close up). */
const SEGMENTS = 10;
const RING_R = 428;

/** Magnification: the lens radius shows 1/ZOOM of the source's short side. */
const ZOOM = 3.1;

interface Source {
  readonly img: HTMLImageElement;
  video: HTMLVideoElement | null;
  /** Most colourful / detailed point of the poster, 0–1 (the mirrors aim there). */
  fx: number;
  fy: number;
}

/** Find where the interesting pixels are (chroma + contrast centroid) on a tiny copy of the poster. */
function focalPoint(img: HTMLImageElement, document: Document): { fx: number; fy: number } {
  const w = 48;
  const h = Math.max(8, Math.round((w * img.naturalHeight) / img.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  if (!c) return { fx: 0.5, fy: 0.5 };
  c.drawImage(img, 0, 0, w, h);
  const data = c.getImageData(0, 0, w, h).data;
  let lumSum = 0;
  for (let i = 0; i < data.length; i += 4) lumSum += data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
  const lumAvg = lumSum / (w * h);
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const lum = r * 0.3 + g * 0.59 + b * 0.11;
      const weight = Math.pow(chroma + Math.abs(lum - lumAvg) * 0.6, 2);
      sx += x * weight;
      sy += y * weight;
      sw += weight;
    }
  }
  if (!sw) return { fx: 0.5, fy: 0.5 };
  return { fx: (sx / sw + 0.5) / w, fy: (sy / sw + 0.5) / h };
}

/**
 * Layout — Kaleidoscope. A brass scope end whose lens mirrors the current
 * project's video into a turning mandala. Turn the knurled ring (drag, wheel,
 * arrows) to morph to the next project; hold the centre or press Peek to see
 * the plain video.
 */
@Component({
  selector: 'app-projects-kaleido',
  imports: [ProjectMediaView],
  templateUrl: './kaleido.html',
  styleUrl: './kaleido.css',
})
export class ProjectsKaleido {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;
  protected readonly active = signal(0);
  protected readonly peek = signal(false);
  protected readonly current = computed(() => this.projects()[this.active()]);
  /** Engraving path: a full clockwise circle starting half a detent before marker 0. */
  protected readonly ringPath = computed(() => {
    const a = -Math.PI / this.projects().length;
    const x = (500 + RING_R * Math.sin(a)).toFixed(2);
    const y = (500 - RING_R * Math.cos(a)).toFixed(2);
    const x2 = (500 + RING_R * Math.sin(a - 0.0005)).toFixed(2);
    const y2 = (500 - RING_R * Math.cos(a - 0.0005)).toFixed(2);
    return `M ${x} ${y} A ${RING_R} ${RING_R} 0 1 1 ${x2} ${y2}`;
  });

  /** Detent markers engraved on the turning ring: ticks and names. */
  protected readonly marks = computed(() => {
    const projects = this.projects();
    const n = projects.length;
    const arc = (2 * Math.PI * RING_R) / n;
    const labels = projects.map((p, i) => `${pad(i + 1)} · ${p.name.toUpperCase()}`);
    const longest = Math.max(...labels.map((l) => l.length));
    const size = Math.min(19, (arc * 0.82) / (longest * 0.74));
    return {
      size,
      labels: labels.map((label, i) => ({
        label,
        // Centred on its detent (the path starts half a detent before marker 0).
        offset: (((i + 0.5) / n) * 100).toFixed(3) + '%',
        angle: (i * 360) / n,
      })),
    };
  });

  protected readonly ticks = computed(() => {
    const n = this.projects().length;
    const out: { angle: number; major: boolean }[] = [];
    const per = 6;
    for (let i = 0; i < n * per; i++) out.push({ angle: (i * 360) / (n * per), major: i % per === 0 });
    return out;
  });

  private readonly document = inject(DOCUMENT);
  private readonly scope = viewChild.required<ElementRef<HTMLElement>>('scope');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Imperative hooks set up after render. */
  private turn: (dir: number) => void = () => {};
  private peekTimer = 0;
  private reopenWatch = false;

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      if (!view) return;
      const scope = this.scope().nativeElement;
      const canvas = this.canvas().nativeElement;
      const ctx = canvas.getContext('2d');
      const dial = scope.querySelector<HTMLElement>('.dial');
      const flash = scope.querySelector<HTMLElement>('.flash');
      if (!ctx || !dial) return;
      const reduced = prefersReducedMotion(view);
      const projects = () => this.projects();
      const n = () => projects().length;
      const step = () => 360 / n();

      // ---- Sources: poster image always, video only for the current / incoming project ----
      const sources = new Map<number, Source>();
      const source = (i: number): Source => {
        let s = sources.get(i);
        if (!s) {
          const img = new Image();
          img.decoding = 'async';
          img.src = projects()[i].media.image;
          s = { img, video: null, fx: 0.5, fy: 0.5 };
          const made = s;
          img.onload = () => {
            try {
              Object.assign(made, focalPoint(img, this.document));
            } catch {
              // Keep the centre if the poster can't be read.
            }
            requestDraw();
          };
          sources.set(i, s);
        }
        if (!s.video && !reduced && projects()[i].media.video) {
          const v = this.document.createElement('video');
          v.muted = true;
          v.defaultMuted = true;
          v.loop = true;
          v.playsInline = true;
          v.setAttribute('playsinline', '');
          v.preload = 'auto';
          v.src = projects()[i].media.video!;
          // Skip fade-in intros: start a little way into the loop.
          v.addEventListener('loadedmetadata', () => {
            if (Number.isFinite(v.duration) && v.duration > 4) v.currentTime = v.duration * 0.2;
          }, { once: true });
          s.video = v;
        }
        return s;
      };
      const drawable = (i: number): { el: CanvasImageSource; w: number; h: number; s: Source } | null => {
        const s = source(i);
        const v = s.video;
        if (v && v.readyState >= 2 && v.videoWidth) return { el: v, w: v.videoWidth, h: v.videoHeight, s };
        if (s.img.complete && s.img.naturalWidth) return { el: s.img, w: s.img.naturalWidth, h: s.img.naturalHeight, s };
        return null;
      };

      // ---- State ----
      let angle = 0; // ring rotation, degrees
      let vel = 0; // degrees per 60fps frame
      let mode: 'idle' | 'drag' | 'free' | 'spring' = 'idle';
      let target = 0;
      let spin = 0; // pattern rotation, radians
      let from = 0;
      let to = 0;
      let mix = 1;
      let morphStart = 0;
      let px = 0;
      let py = 0;
      let tx = 0;
      let ty = 0;
      let onScreen = false;
      let size = 0;
      const t0 = performance.now();

      const playing = new Set<number>();
      const syncPlayback = () => {
        const live = onScreen && this.document.visibilityState === 'visible' && !reduced;
        const want = new Set<number>(live ? (mix < 1 ? [from, to] : [to]) : []);
        sources.forEach((s, i) => {
          if (!s.video) return;
          if (want.has(i)) {
            if (!playing.has(i)) {
              playing.add(i);
              s.video.play().catch(() => playing.delete(i));
            }
          } else if (playing.has(i)) {
            playing.delete(i);
            s.video.pause();
          }
        });
      };

      const resize = () => {
        const box = canvas.getBoundingClientRect();
        const dpr = Math.min(view.devicePixelRatio || 1, 2);
        size = Math.max(1, Math.round(box.width * dpr));
        if (canvas.width !== size) {
          canvas.width = size;
          canvas.height = size;
        }
        requestDraw();
      };

      // ---- The mandala ----
      const pattern = (i: number, alpha: number, t: number) => {
        const d = drawable(i);
        if (!d || alpha <= 0) return;
        const R = size / 2;
        const w = (Math.PI * 2) / SEGMENTS;
        const scale = (R * ZOOM) / Math.min(d.w, d.h);
        const dw = d.w * scale;
        const dh = d.h * scale;
        // Aim the wedge's middle at the poster's focal point, kept far enough from the edges.
        const margin = (R * 0.95) / scale;
        const fx = Math.min(Math.max(d.s.fx * d.w, margin), d.w - margin) / d.w;
        const fy = Math.min(Math.max(d.s.fy * d.h, margin), d.h - margin) / d.h;
        const ox = R * (0.55 * Math.cos(w / 2) + 0.1 * Math.sin(t * 0.21) + 0.22 * px);
        const oy = R * (0.55 * Math.sin(w / 2) + 0.1 * Math.cos(t * 0.17) + 0.22 * py);
        const rot = t * 0.05 + px * 0.5 - py * 0.3;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(R, R);
        ctx.rotate(spin + px * 0.35);
        for (let k = 0; k < SEGMENTS; k++) {
          ctx.save();
          ctx.rotate(k * w);
          if (k % 2) {
            ctx.scale(1, -1);
            ctx.rotate(-w);
          }
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, R * 1.05, -0.004, w + 0.004);
          ctx.closePath();
          ctx.clip();
          ctx.translate(ox, oy);
          ctx.rotate(rot);
          ctx.drawImage(d.el, -fx * dw, -fy * dh, dw, dh);
          ctx.restore();
        }
        ctx.restore();
      };

      const render = (now: number) => {
        if (!size) return;
        const t = reduced ? 0 : (now - t0) / 1000;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#06080c';
        ctx.fillRect(0, 0, size, size);
        const e = mix < 1 ? mix * mix * (3 - 2 * mix) : 1;
        if (e < 1) pattern(from, 1, t);
        pattern(to, drawable(from) && e < 1 ? e : 1, t);
      };

      // ---- Morph to the project under the notch ----
      const morphTo = (i: number) => {
        if (i === to) return;
        from = mix < 0.5 ? from : to;
        to = i;
        source(i);
        mix = reduced ? 1 : 0;
        morphStart = performance.now();
        this.active.set(i);
        if (flash && !reduced) {
          flash.classList.remove('is-on');
          void flash.offsetWidth;
          flash.classList.add('is-on');
        }
        syncPlayback();
        requestDraw();
      };
      const detent = () => {
        const count = n();
        return (((Math.round(-angle / step()) % count) + count) % count);
      };
      const applyDial = () => {
        dial.style.transform = `rotate(${angle.toFixed(3)}deg)`;
        const i = detent();
        if (i !== to) morphTo(i);
      };

      // ---- Loop (≤ 60fps, only while on screen and the tab is visible) ----
      let frame = 0;
      let last = 0;
      let drawQueued = false;
      const running = () => onScreen && this.document.visibilityState === 'visible';
      const tick = (now: number) => {
        frame = 0;
        if (!running()) return;
        if (now - last < 15.5) {
          frame = requestAnimationFrame(tick);
          return;
        }
        const dt = Math.min(3, last ? (now - last) / (1000 / 60) : 1);
        last = now;

        if (mode === 'free') {
          angle += vel * dt;
          vel *= Math.pow(0.95, dt);
          if (Math.abs(vel) < 0.15) {
            mode = 'spring';
            target = Math.round(angle / step()) * step();
          }
        } else if (mode === 'spring') {
          const a = (target - angle) * 0.11 - vel * 0.45;
          vel += a * dt;
          angle += vel * dt;
          if (Math.abs(target - angle) < 0.02 && Math.abs(vel) < 0.02) {
            angle = target;
            vel = 0;
            mode = 'idle';
          }
        }
        if (mode !== 'drag') applyDial();

        // The pattern drifts and twists with the ring's momentum.
        spin += 0.0016 * dt + ((vel * Math.PI) / 180) * 1.7 * dt;
        px += (tx - px) * 0.06 * dt;
        py += (ty - py) * 0.06 * dt;
        if (mix < 1) {
          mix = Math.min(1, (now - morphStart) / 1000);
          if (mix >= 1) syncPlayback();
        }
        render(now);
        frame = requestAnimationFrame(tick);
      };
      const start = () => {
        if (reduced) {
          requestDraw();
          return;
        }
        if (!frame && running()) {
          last = 0;
          frame = requestAnimationFrame(tick);
        }
      };
      const requestDraw = () => {
        if (!reduced) return; // the loop redraws every frame
        if (drawQueued) return;
        drawQueued = true;
        requestAnimationFrame((now) => {
          drawQueued = false;
          render(now);
        });
      };

      // ---- Turning: drag around the scope, wheel on the ring, buttons / keys ----
      const centre = () => {
        const box = scope.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2, r: box.width / 2 };
      };
      let dragId: number | null = null;
      let lastA = 0;
      let lastT = 0;
      let downX = 0;
      let downY = 0;
      let moved = false;
      const angleAt = (x: number, y: number) => {
        const c = centre();
        return (Math.atan2(y - c.y, x - c.x) * 180) / Math.PI;
      };
      const onDown = (event: PointerEvent) => {
        if (event.button !== 0 || (event.target as Element | null)?.closest('.hub')) return;
        dragId = event.pointerId;
        lastA = angleAt(event.clientX, event.clientY);
        lastT = performance.now();
        downX = event.clientX;
        downY = event.clientY;
        moved = false;
      };
      const onMove = (event: PointerEvent) => {
        if (event.pointerType === 'mouse' && dragId === null) {
          const c = centre();
          tx = Math.max(-1, Math.min(1, (event.clientX - c.x) / c.r));
          ty = Math.max(-1, Math.min(1, (event.clientY - c.y) / c.r));
        }
        if (dragId !== event.pointerId) return;
        if (!moved) {
          if (Math.hypot(event.clientX - downX, event.clientY - downY) < 5) return;
          moved = true;
          mode = 'drag';
          scope.setPointerCapture(event.pointerId);
          scope.classList.add('is-turning');
        }
        const a = angleAt(event.clientX, event.clientY);
        let d = a - lastA;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        lastA = a;
        const now = performance.now();
        const frames = Math.max(0.5, (now - lastT) / (1000 / 60));
        lastT = now;
        vel = vel * 0.5 + (d / frames) * 0.5;
        angle += d;
        applyDial();
        if (reduced) requestDraw();
      };
      const onUp = (event: PointerEvent) => {
        if (dragId !== event.pointerId) return;
        dragId = null;
        scope.classList.remove('is-turning');
        if (!moved) return;
        if (performance.now() - lastT > 80) vel = 0;
        if (reduced) {
          angle = Math.round(angle / step()) * step();
          vel = 0;
          mode = 'idle';
          applyDial();
          requestDraw();
        } else {
          mode = 'free';
          start();
        }
      };
      const onClickCapture = (event: MouseEvent) => {
        if (moved) {
          event.stopPropagation();
          event.preventDefault();
          moved = false;
        }
      };
      let wheelTimer = 0;
      const onWheel = (event: WheelEvent) => {
        const c = centre();
        const lensR = c.r * 0.78;
        const onRing = Math.hypot(event.clientX - c.x, event.clientY - c.y) > lensR;
        const sideways = Math.abs(event.deltaX) > Math.abs(event.deltaY);
        if (!onRing && !sideways) return;
        event.preventDefault();
        const delta = sideways ? event.deltaX : event.deltaY;
        const d = Math.max(-12, Math.min(12, -delta * 0.12));
        if (reduced) {
          view.clearTimeout(wheelTimer);
          angle += d;
          applyDial();
          wheelTimer = view.setTimeout(() => {
            angle = Math.round(angle / step()) * step();
            applyDial();
            requestDraw();
          }, 140);
          return;
        }
        angle += d;
        vel = vel * 0.6 + d * 0.25;
        mode = 'free';
        applyDial();
        start();
      };
      this.turn = (dir: number) => {
        const base = mode === 'spring' ? target : Math.round(angle / step()) * step();
        target = base - dir * step();
        if (reduced) {
          angle = target;
          vel = 0;
          mode = 'idle';
          applyDial();
          requestDraw();
          return;
        }
        vel -= dir * 1.2;
        mode = 'spring';
        start();
      };

      scope.addEventListener('pointerdown', onDown);
      scope.addEventListener('pointermove', onMove);
      scope.addEventListener('pointerup', onUp);
      scope.addEventListener('pointercancel', onUp);
      scope.addEventListener('click', onClickCapture, true);
      scope.addEventListener('wheel', onWheel, { passive: false });
      const onLeave = () => {
        tx = 0;
        ty = 0;
      };
      scope.addEventListener('pointerleave', onLeave);

      const io = new IntersectionObserver(([entry]) => {
        onScreen = !!entry?.isIntersecting;
        syncPlayback();
        if (onScreen) start();
      });
      io.observe(scope);
      const onVisibility = () => {
        syncPlayback();
        start();
      };
      this.document.addEventListener('visibilitychange', onVisibility);
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);

      // Start on the first project; prepare its neighbours' posters.
      source(0);
      if (n() > 1) source(1);
      resize();
      applyDial();
      requestDraw();

      // When the case closes, focus returns to our Open button: let the mirrors back in.
      const onFocusIn = (event: FocusEvent) => {
        if (!this.reopenWatch) return;
        if ((event.target as Element | null)?.closest('.open')) {
          this.reopenWatch = false;
          this.peekTimer = view.setTimeout(() => this.peek.set(false), 1100);
        }
      };
      this.host.addEventListener('focusin', onFocusIn);

      cleanup = () => {
        cancelAnimationFrame(frame);
        view.clearTimeout(wheelTimer);
        io.disconnect();
        ro.disconnect();
        this.document.removeEventListener('visibilitychange', onVisibility);
        this.host.removeEventListener('focusin', onFocusIn);
        scope.removeEventListener('pointerdown', onDown);
        scope.removeEventListener('pointermove', onMove);
        scope.removeEventListener('pointerup', onUp);
        scope.removeEventListener('pointercancel', onUp);
        scope.removeEventListener('click', onClickCapture, true);
        scope.removeEventListener('wheel', onWheel);
        scope.removeEventListener('pointerleave', onLeave);
        sources.forEach((s) => {
          if (!s.video) return;
          s.video.pause();
          s.video.removeAttribute('src');
          s.video.load();
        });
      };
    });

    inject(DestroyRef).onDestroy(() => {
      cleanup();
      clearTimeout(this.peekTimer);
    });
  }

  protected go(dir: number): void {
    this.turn(dir);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') this.go(1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') this.go(-1);
    else if (event.key === 'Enter') this.openActive();
    else if (event.key === ' ') this.togglePeek();
    else return;
    event.preventDefault();
  }

  protected togglePeek(): void {
    clearTimeout(this.peekTimer);
    this.peek.update((p) => !p);
  }

  // Press and hold the centre to peek; a quick tap toggles.
  private holdStart = 0;
  private wasPeek = false;
  protected hubDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.holdStart = performance.now();
    this.wasPeek = this.peek();
    clearTimeout(this.peekTimer);
    this.peek.set(true);
  }

  protected hubUp(): void {
    if (!this.holdStart) return;
    const held = performance.now() - this.holdStart > 320;
    this.holdStart = 0;
    if (held || this.wasPeek) this.peek.set(false);
  }

  protected hubClick(event: MouseEvent): void {
    // Pointer taps are handled on down/up; keyboard activation toggles.
    if (event.detail === 0) this.togglePeek();
  }

  protected openActive(): void {
    const index = this.active();
    const media = this.scope().nativeElement.querySelector<HTMLElement>('.peek app-project-media');
    const emit = () => {
      this.reopenWatch = true;
      this.openCase.emit({ index, media });
    };
    clearTimeout(this.peekTimer);
    if (this.peek() || prefersReducedMotion(this.document.defaultView)) {
      this.peek.set(true);
      emit();
      return;
    }
    // Dissolve the mirrors first so the real video morphs into the case.
    this.peek.set(true);
    this.peekTimer = setTimeout(emit, 380) as unknown as number;
  }
}
