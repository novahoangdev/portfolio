import { DOCUMENT } from '@angular/common';
import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { SideProject } from '../../../data/projects';
import { ProjectMediaView } from '../project-media';
import { kindLabel, OpenCase, pad } from './shared';

const FONT = "'DM Serif Display', Georgia, serif";
/** Baseline-to-baseline distance, in em. */
const LEADING = 0.86;
/** Scroll dwell (in projects) before the first and after the last name. */
const DWELL = 0.3;
/** Phases inside one project-to-project step: rest · zoom in · full-bleed (wipe) · zoom out · rest. */
const A1 = 0.1;
const A2 = 0.42;
const A3 = 0.58;
const A4 = 0.9;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

interface Glyph {
  readonly ch: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

/** A name typeset into a box: glyph positions plus the point the camera dives into. */
interface Setting {
  readonly size: number;
  readonly glyphs: readonly Glyph[];
  readonly baselines: readonly number[];
  readonly cap: number;
  readonly height: number;
  /** Deepest point inside a stroke (box coords) and the radius of clear ink around it. */
  fx: number;
  fy: number;
  r: number;
}

type Mode = 'rest' | 'move' | 'bleed';

/** Split `name` into 1–3 balanced lines and size it to fill `fitW` × `fitH`. */
function typeset(ctx: CanvasRenderingContext2D, name: string, cx: number, cy: number, fitW: number, fitH: number): Setting {
  ctx.font = `100px ${FONT}`;
  const words = name.split(/\s+/).filter(Boolean);
  const width = (s: string) => ctx.measureText(s).width / 100;
  const capM = ctx.measureText('HIdk');
  const cap = capM.actualBoundingBoxAscent / 100 || 0.72;
  const desc = Math.max(0.12, ctx.measureText('gjpy').actualBoundingBoxDescent / 100 || 0.22);

  let best: { lines: string[]; size: number } = { lines: [name], size: 0 };
  const consider = (lines: string[]) => {
    const w = Math.max(...lines.map(width));
    const h = cap + (lines.length - 1) * LEADING + desc * 0.6;
    const size = Math.min(fitW / w, fitH / h);
    // Prefer fewer lines unless more lines are clearly bigger.
    if (size > best.size * 1.04) best = { lines, size };
  };
  const split = (from: number, k: number, acc: string[]) => {
    if (k === 1) {
      consider([...acc, words.slice(from).join(' ')]);
      return;
    }
    for (let i = from + 1; i <= words.length - k + 1; i++) split(i, k - 1, [...acc, words.slice(from, i).join(' ')]);
  };
  for (let k = 1; k <= Math.min(3, words.length); k++) split(0, k, []);

  const size = best.size;
  const lines = best.lines;
  const height = (cap + (lines.length - 1) * LEADING + desc * 0.6) * size;
  const top = cy - height / 2;
  ctx.font = `${size}px ${FONT}`;
  const glyphs: Glyph[] = [];
  const baselines: number[] = [];
  lines.forEach((line, li) => {
    const lw = ctx.measureText(line).width;
    const x0 = cx - lw / 2;
    const y = top + cap * size + li * LEADING * size;
    baselines.push(y);
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === ' ') continue;
      const x = x0 + ctx.measureText(line.slice(0, c)).width;
      glyphs.push({ ch, x, y, w: ctx.measureText(ch).width });
    }
  });
  return { size, glyphs, baselines, cap: cap * size, height, fx: cx, fy: cy, r: size * 0.05 };
}

/** Find the deepest point of ink (chamfer distance transform), favouring the middle of the box. */
function findFocus(document: Document, set: Setting, w: number, h: number): void {
  const q = 0.2;
  const cw = Math.max(8, Math.round(w * q));
  const chh = Math.max(8, Math.round(h * q));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = chh;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return;
  g.scale(q, q);
  g.font = `${set.size}px ${FONT}`;
  g.fillStyle = '#fff';
  for (const gl of set.glyphs) g.fillText(gl.ch, gl.x, gl.y);
  const data = g.getImageData(0, 0, cw, chh).data;
  const d = new Float32Array(cw * chh);
  for (let i = 0; i < d.length; i++) d[i] = data[i * 4 + 3] > 127 ? 1e6 : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= cw || y >= chh ? 0 : d[y * cw + x]);
  for (let y = 0; y < chh; y++) {
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  let best = -1;
  let bx = cw / 2;
  let by = chh / 2;
  let bd = 0;
  const half = Math.hypot(cw, chh) / 2;
  for (let y = chh - 1; y >= 0; y--) {
    for (let x = cw - 1; x >= 0; x--) {
      const i = y * cw + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
      const score = d[i] * (1 - 0.45 * (Math.hypot(x - cw / 2, y - chh / 2) / half));
      if (score > best) {
        best = score;
        bx = x;
        by = y;
        bd = d[i];
      }
    }
  }
  set.fx = (bx + 0.5) / q;
  set.fy = (by + 0.5) / q;
  set.r = Math.max(4, ((bd / 3) / q) * 0.8);
}

/** Paint `bg` everywhere except the letterforms, so the video shows only through the type. */
function paintMask(
  ctx: CanvasRenderingContext2D,
  o: {
    readonly dpr: number;
    readonly w: number;
    readonly h: number;
    readonly bg: string;
    readonly line: string;
    readonly edge: string;
    readonly set: Setting;
    readonly s: number;
    readonly ax: number;
    readonly ay: number;
    readonly guides: number;
    readonly mx: number;
    readonly my: number;
    readonly hover: number;
  },
): void {
  const { dpr, w, h, set, s, ax, ay } = o;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w * dpr, h * dpr);
  const reach = Math.max(Math.hypot(ax, ay), Math.hypot(w - ax, ay), Math.hypot(ax, h - ay), Math.hypot(w - ax, h - ay));
  if (set.r * s >= reach) return; // The camera is inside the ink: pure video.

  ctx.fillStyle = o.bg;
  ctx.fillRect(0, 0, w * dpr, h * dpr);
  const tx = ax - set.fx * s;
  const ty = ay - set.fy * s;
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * tx, dpr * ty);

  // Type-specimen hairlines (baseline + cap height) that rush outward with the zoom.
  if (o.guides > 0.01) {
    ctx.globalAlpha = o.guides;
    ctx.strokeStyle = o.line;
    ctx.lineWidth = 1 / s;
    ctx.setLineDash([]);
    const x0 = -tx / s;
    const x1 = (w - tx) / s;
    ctx.beginPath();
    for (const y of set.baselines) {
      ctx.moveTo(x0, y + 0.5 / s);
      ctx.lineTo(x1, y + 0.5 / s);
    }
    ctx.stroke();
    ctx.setLineDash([4 / s, 5 / s]);
    ctx.beginPath();
    for (const y of set.baselines) {
      ctx.moveTo(x0, y - set.cap);
      ctx.lineTo(x1, y - set.cap);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = '#000';
  ctx.strokeStyle = o.edge;
  ctx.lineWidth = 1.1 / s;
  ctx.font = `${set.size}px ${FONT}`;
  const edged = o.guides > 0.02;
  const sigma = set.size * 0.85;
  const lift = set.size * 0.075 * o.hover;
  for (const g of set.glyphs) {
    const sx0 = tx + g.x * s;
    const sx1 = tx + (g.x + g.w) * s;
    const sy0 = ty + (g.y - set.size) * s;
    const sy1 = ty + (g.y + set.size * 0.35) * s;
    if (sx1 < 0 || sx0 > w || sy1 < 0 || sy0 > h) continue;
    ctx.save();
    if (lift > 0.01) {
      // Letters near the cursor rise toward it and lean away, like type on a sprung bed.
      const gx = g.x + g.w / 2;
      const dx = (gx - o.mx) / sigma;
      const dy = (g.y - set.cap / 2 - o.my) / (sigma * 1.4);
      const k = Math.exp(-(dx * dx + dy * dy));
      ctx.translate(gx, g.y - lift * k);
      ctx.rotate(clamp(-dx, -1, 1) * 0.05 * k * o.hover);
      ctx.translate(-g.w / 2, 0);
    } else {
      ctx.translate(g.x, g.y);
    }
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    ctx.fillText(g.ch, 0, 0);
    if (edged) {
      // A hairline keeps the letterforms crisp where the film is close to the paper colour.
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = o.guides;
      ctx.strokeText(g.ch, 0, 0);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Layout — Typemask: each project's name, set enormous in DM Serif Display, is a
 * window onto its video. Scrolling dives the camera into the deepest stroke of
 * one letter until the film fills the screen, holds, wipes to the next film,
 * then pulls back out through the next name. Narrow screens and reduced motion
 * get a calm list of masked names instead.
 */
@Component({
  selector: 'app-projects-type',
  imports: [ProjectMediaView],
  templateUrl: './type.html',
  styleUrl: './type.css',
})
export class ProjectsType {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly pinned = signal(false);
  protected readonly current = signal(0);
  protected readonly mode = signal<Mode>('rest');
  protected readonly playing = signal<ReadonlySet<number>>(new Set([0]));
  protected readonly railGradient = computed(() => {
    const list = this.projects();
    const stops = list.map((p, i) => `${p.accent} ${((i / Math.max(1, list.length - 1)) * 100).toFixed(1)}%`);
    return `linear-gradient(to bottom, ${stops.join(', ')})`;
  });

  private readonly document = inject(DOCUMENT);
  private readonly reel = viewChild<ElementRef<HTMLElement>>('reel');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private api: { dive(): void; goTo(index: number): void; focusHit(): void } | null = null;

  constructor() {
    const view = this.document.defaultView;
    if (view) {
      const wide = view.matchMedia('(min-width: 761px)');
      const motion = view.matchMedia('(prefers-reduced-motion: reduce)');
      const update = () => this.pinned.set(wide.matches && !motion.matches);
      update();
      wide.addEventListener('change', update);
      motion.addEventListener('change', update);
      inject(DestroyRef).onDestroy(() => {
        wide.removeEventListener('change', update);
        motion.removeEventListener('change', update);
      });
    }

    afterRenderEffect((onCleanup) => {
      const reel = this.reel()?.nativeElement;
      if (!reel || !view) return;
      onCleanup(untracked(() => this.setupReel(reel, view)));
    });

    afterRenderEffect((onCleanup) => {
      const list = this.list()?.nativeElement;
      if (!list || !view) return;
      onCleanup(untracked(() => this.setupList(list, view)));
    });
  }

  protected kinds(project: SideProject): string {
    return project.kinds.map(kindLabel).join(' · ');
  }

  protected dive(): void {
    this.api?.dive();
  }

  protected goTo(index: number): void {
    this.api?.goTo(index);
  }

  protected onHitFocus(): void {
    this.api?.focusHit();
  }

  protected openFromList(index: number, item: HTMLElement): void {
    this.openCase.emit({ index, media: item.querySelector('app-project-media') });
  }

  protected playFor(index: number): 'on' | 'off' {
    return this.playing().has(index) ? 'on' : 'off';
  }

  /** The pinned stage: a canvas mask over the films, driven by scroll and pointer. */
  private setupReel(reel: HTMLElement, view: Window): () => void {
    const stage = reel.querySelector<HTMLElement>('.stage')!;
    const canvas = stage.querySelector<HTMLCanvasElement>('canvas.mask')!;
    const ctx = canvas.getContext('2d')!;
    const slides = [...stage.querySelectorAll<HTMLElement>('.slide')];
    const fill = stage.querySelector<HTMLElement>('.rail-fill');
    const knob = stage.querySelector<HTMLElement>('.rail-knob');
    const wipeEdge = stage.querySelector<HTMLElement>('.wipe-edge');
    const scrim = stage.querySelector<HTMLElement>('.scrim');
    const badge = stage.querySelector<HTMLElement>('.badge');
    const root = this.document.documentElement;
    const projects = this.projects();
    const n = projects.length;
    const span = n - 1 + DWELL * 2;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let settings: Setting[] = [];
    let bg = '#eeeae2';
    let line = '#d5d1c9';
    let edge = 'rgba(23, 43, 54, 0.3)';
    let stickyTop = 72;
    let x = -1;
    let mx = 0;
    let my = 0;
    let tmx = 0;
    let tmy = 0;
    let hover = 0;
    let tHover = 0;
    let dive = 0;
    let tDive = 0;
    let emitted = false;
    let seenOpen = false;
    let frame = 0;
    let last = 0;
    let lastSlides = '';
    let alive = true;
    let onScreen = false;

    const readTheme = () => {
      const cs = view.getComputedStyle(stage);
      bg = cs.backgroundColor || bg;
      line = cs.getPropertyValue('--tm-line').trim() || line;
      edge = cs.getPropertyValue('--tm-edge').trim() || edge;
    };

    const measure = () => {
      w = stage.clientWidth;
      h = stage.clientHeight;
      if (!w || !h) return;
      dpr = Math.min(2, view.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      stickyTop = parseFloat(view.getComputedStyle(stage).top) || 0;
      readTheme();
      settings = projects.map((p) => {
        const set = typeset(ctx, p.name, w / 2, h * 0.5, w * 0.9, h * 0.6);
        findFocus(this.document, set, w, h);
        return set;
      });
      render(true);
    };

    const target = () => {
      const rect = reel.getBoundingClientRect();
      const travel = Math.max(1, reel.offsetHeight - stage.offsetHeight);
      const progress = clamp((stickyTop - rect.top) / travel, 0, 1);
      return { x: clamp(progress * span - DWELL, 0, n - 1), rect };
    };

    // Inline styles last written per element: the loop skips unchanged values, so a frame
    // where only the pointer moves does not invalidate style on the films, rail or scrim.
    const written = new WeakMap<HTMLElement, Map<string, string>>();
    const put = (el: HTMLElement | null | undefined, prop: string, value: string) => {
      if (!el) return;
      let props = written.get(el);
      if (!props) written.set(el, (props = new Map()));
      if (props.get(prop) === value) return;
      props.set(prop, value);
      el.style.setProperty(prop, value);
    };

    const phase = (pos: number) => {
      const j = Math.min(Math.floor(pos), n - 1);
      const f = pos - j;
      if (j >= n - 1 || f <= A1) return { mask: j, e: 0, base: j, over: -1, wipe: 0 };
      if (f < A2) return { mask: j, e: smooth((f - A1) / (A2 - A1)), base: j, over: -1, wipe: 0 };
      if (f < A3) return { mask: -1, e: 1, base: j, over: j + 1, wipe: smoother((f - A2) / (A3 - A2)) };
      if (f < A4) return { mask: j + 1, e: 1 - smooth((f - A3) / (A4 - A3)), base: j + 1, over: -1, wipe: 0 };
      return { mask: j + 1, e: 0, base: j + 1, over: -1, wipe: 0 };
    };

    const render = (snap = false) => {
      if (frame) view.cancelAnimationFrame(frame);
      frame = 0;
      if (!alive || !settings.length) return;
      const now = performance.now();
      const dt = Math.min(64, now - (last || now));
      last = now;
      const t = target();
      const k = snap || x < 0 ? 1 : 1 - Math.pow(1 - 0.1, dt / 16.67);
      x += (t.x - x) * k;
      if (Math.abs(t.x - x) < 0.0005) x = t.x;
      const kp = snap ? 1 : 1 - Math.pow(1 - 0.12, dt / 16.67);
      mx += (tmx - mx) * kp;
      my += (tmy - my) * kp;
      hover += (tHover - hover) * kp;
      const kd = 1 - Math.pow(1 - 0.11, dt / 16.67);
      dive += (tDive - dive) * kd;
      if (Math.abs(tDive - dive) < 0.002) dive = tDive;

      const ph = phase(x);
      const shown = ph.mask >= 0 ? ph.mask : ph.wipe < 0.5 ? ph.base : ph.over;
      const e = ph.mask >= 0 ? Math.max(ph.e, dive) : 1;
      const mode: Mode = e > 0.985 ? 'bleed' : e < 0.03 ? 'rest' : 'move';
      if (shown !== this.current()) this.current.set(shown);
      if (mode !== this.mode()) this.mode.set(mode);

      // Films: the one under the mask, plus the next one wiping up during the hold.
      const near = new Set<number>();
      if (onScreen) {
        near.add(ph.base);
        if (ph.over >= 0) near.add(ph.over);
        else if (ph.mask === ph.base && ph.e > 0.55 && ph.base + 1 < n) near.add(ph.base + 1);
      }
      const playing = this.playing();
      if (near.size !== playing.size || [...near].some((i) => !playing.has(i))) this.playing.set(near);

      const key = `${ph.base}|${ph.over}`;
      if (key !== lastSlides) {
        lastSlides = key;
        slides.forEach((el, i) => {
          const on = i === ph.base || i === ph.over;
          put(el, 'visibility', on ? 'visible' : 'hidden');
          put(el, 'z-index', i === ph.over ? '1' : '0');
          if (i !== ph.over) put(el, 'clip-path', '');
        });
      }
      if (ph.over >= 0) {
        const inset = ((1 - ph.wipe) * 100).toFixed(3);
        put(slides[ph.over], 'clip-path', `inset(${inset}% 0 0 0)`);
        put(slides[ph.base], '--slide-y', `${(-ph.wipe * 8).toFixed(2)}%`);
      } else {
        put(slides[ph.base], '--slide-y', '0%');
      }
      put(wipeEdge, 'opacity', ph.over >= 0 && ph.wipe > 0.001 && ph.wipe < 0.999 ? '1' : '0');
      put(wipeEdge, 'transform', `translateY(${((1 - ph.wipe) * h).toFixed(1)}px)`);
      if (ph.over >= 0) put(wipeEdge, '--c', projects[ph.over].accent);
      put(slides[shown], '--media-zoom', (1.16 - 0.14 * e).toFixed(4));

      const inView = t.rect.bottom > 0 && t.rect.top < view.innerHeight;
      if (inView) {
        if (ph.mask >= 0) {
          const set = settings[ph.mask];
          const reach = Math.hypot(w, h) / 2;
          const S = (reach / set.r) * 1.06;
          const s = Math.exp(Math.log(S) * e);
          const a = smooth(clamp(e * 1.35, 0, 1));
          const ax = lerp(set.fx, w / 2, a);
          const ay = lerp(set.fy, h / 2, a);
          // Pointer in the name's own coordinates.
          const pmx = (mx - ax) / s + set.fx;
          const pmy = (my - ay) / s + set.fy;
          paintMask(ctx, { dpr, w, h, bg, line, edge, set, s, ax, ay, guides: (1 - e) ** 3, mx: pmx, my: pmy, hover: hover * (1 - e) });
        } else {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }

      put(scrim, 'opacity', clamp((e - 0.6) / 0.4, 0, 1).toFixed(3));
      const prog = n > 1 ? x / (n - 1) : 1;
      put(fill, 'transform', `scaleY(${prog.toFixed(4)})`);
      put(knob, 'transform', `translateY(calc(${(prog * 100).toFixed(3)}cqh - 50%))`);
      put(badge, 'transform', `translate3d(${mx.toFixed(1)}px, ${my.toFixed(1)}px, 0) scale(${(0.4 + hover * 0.6).toFixed(3)})`);
      put(badge, 'opacity', hover.toFixed(3));

      // Click-to-open: once the dive is complete, hand the film to the case dialog.
      if (tDive === 1 && dive > 0.97 && !emitted) {
        emitted = true;
        dive = 1;
        this.openCase.emit({ index: shown, media: slides[shown]?.querySelector('app-project-media') ?? null });
      }

      const moving =
        Math.abs(t.x - x) > 0.0005 ||
        Math.abs(tmx - mx) > 0.3 ||
        Math.abs(tmy - my) > 0.3 ||
        Math.abs(tHover - hover) > 0.003 ||
        dive !== tDive;
      if (moving) frame = view.requestAnimationFrame(() => render());
      else last = 0;
    };

    const kick = () => {
      if (!frame) frame = view.requestAnimationFrame(() => render());
    };

    const release = () => {
      if (tDive === 0) return;
      tDive = 0;
      emitted = false;
      seenOpen = false;
      kick();
    };

    this.api = {
      dive: () => {
        if (tDive === 1) return;
        tDive = 1;
        emitted = false;
        seenOpen = false;
        kick();
      },
      goTo: (index: number) => {
        const travel = Math.max(1, reel.offsetHeight - stage.offsetHeight);
        const top = reel.getBoundingClientRect().top + view.scrollY - stickyTop + ((index + DWELL) / span) * travel;
        view.scrollTo({ top, behavior: 'smooth' });
      },
      focusHit: () => {
        if (emitted && !root.classList.contains('case-open')) release();
      },
    };

    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const box = stage.getBoundingClientRect();
      tmx = event.clientX - box.left;
      tmy = event.clientY - box.top;
      if (tHover === 0) {
        mx = tmx;
        my = tmy;
      }
      tHover = 1;
      kick();
    };
    const onLeave = () => {
      tHover = 0;
      kick();
    };
    const onScroll = () => {
      if (emitted && !root.classList.contains('case-open')) release();
      kick();
    };

    // Theme switches repaint the paper; the case closing pulls the camera back out.
    const watcher = new MutationObserver(() => {
      if (root.classList.contains('case-open')) seenOpen = true;
      else if (emitted && seenOpen) release();
      readTheme();
      render(true);
    });
    watcher.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });

    // Films only play while the reel is on screen.
    const io = new IntersectionObserver(([entry]) => {
      onScreen = !!entry?.isIntersecting;
      render(true);
    });
    io.observe(reel);
    const resize = new ResizeObserver(() => measure());
    resize.observe(stage);
    view.addEventListener('scroll', onScroll, { passive: true });
    stage.addEventListener('pointermove', onPointer);
    stage.addEventListener('pointerleave', onLeave);
    measure();
    this.document.fonts?.load(`100px ${FONT}`).then(() => alive && measure()).catch(() => undefined);

    return () => {
      alive = false;
      this.api = null;
      view.cancelAnimationFrame(frame);
      io.disconnect();
      resize.disconnect();
      watcher.disconnect();
      view.removeEventListener('scroll', onScroll);
      stage.removeEventListener('pointermove', onPointer);
      stage.removeEventListener('pointerleave', onLeave);
    };
  }

  /** The calm list: each name is a static stencil over its film. */
  private setupList(list: HTMLElement, view: Window): () => void {
    const items = [...list.querySelectorAll<HTMLElement>('.stencil')];
    const projects = this.projects();
    const root = this.document.documentElement;
    let alive = true;

    const draw = () => {
      if (!alive) return;
      const dpr = Math.min(2, view.devicePixelRatio || 1);
      const cs = view.getComputedStyle(list);
      const bg = cs.getPropertyValue('--tm-paper').trim() || '#eeeae2';
      const line = cs.getPropertyValue('--tm-line').trim() || '#d5d1c9';
      const edge = cs.getPropertyValue('--tm-edge').trim() || line;
      const vh = view.innerHeight;
      items.forEach((item, i) => {
        const canvas = item.querySelector('canvas');
        const ctx = canvas?.getContext('2d');
        const p = projects[i];
        if (!canvas || !ctx || !p) return;
        const w = item.clientWidth;
        if (!w) return;
        const probe = typeset(ctx, p.name, w / 2, 0, w * 0.96, vh * 0.42);
        const h = Math.ceil(probe.height + probe.size * 0.22);
        item.style.height = `${h}px`;
        const set = typeset(ctx, p.name, w / 2, h / 2, w * 0.96, vh * 0.42);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        paintMask(ctx, { dpr, w, h, bg, line, edge, set, s: 1, ax: set.fx, ay: set.fy, guides: 1, mx: 0, my: 0, hover: 0 });
      });
    };

    const resize = new ResizeObserver(() => draw());
    resize.observe(list);
    const watcher = new MutationObserver(() => draw());
    watcher.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    draw();
    this.document.fonts?.load(`100px ${FONT}`).then(draw).catch(() => undefined);

    return () => {
      alive = false;
      resize.disconnect();
      watcher.disconnect();
    };
  }
}
