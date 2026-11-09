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
import { canHover, kindLabel, OpenCase, pad, prefersReducedMotion } from './shared';

/* ------------------------------------------------------------------ */
/* World model                                                         */
/* ------------------------------------------------------------------ */

/** A hand-placed spot on the board: centre (world px), depth factor, tilt, width. */
interface Spot {
  readonly x: number;
  readonly y: number;
  /** Parallax depth: < 1 sits further back (moves slower), > 1 floats closer. */
  readonly f: number;
  readonly r: number;
  readonly w: number;
  /** Which corner the project's sticky note is stuck to. */
  readonly note: 'tl' | 'tr' | 'bl' | 'br';
  /** Where the kind stamp sits, relative to the card centre. */
  readonly stamp: readonly [number, number, number];
}

const SPOTS: readonly Spot[] = [
  { x: 0, y: 0, f: 1, r: -1.2, w: 580, note: 'br', stamp: [-210, -258, -5] },
  { x: -690, y: -300, f: 0.9, r: 2.4, w: 380, note: 'bl', stamp: [120, -226, 4] },
  { x: 650, y: -320, f: 1.06, r: -2.8, w: 350, note: 'tr', stamp: [-60, 214, -4] },
  { x: 1070, y: 120, f: 0.93, r: 2.2, w: 320, note: 'bl', stamp: [60, 210, 6] },
  { x: 600, y: 410, f: 1.05, r: -1.8, w: 340, note: 'br', stamp: [-150, -205, -5] },
  { x: -200, y: 480, f: 0.96, r: 2.8, w: 360, note: 'tl', stamp: [150, 214, 4] },
  { x: -870, y: 290, f: 1.03, r: -2.6, w: 320, note: 'tr', stamp: [-30, 206, -6] },
];

/** Extra projects (beyond the hand-placed seven) spiral outwards. */
function spotFor(index: number): Spot {
  const placed = SPOTS[index];
  if (placed) return placed;
  const k = index - SPOTS.length;
  const angle = k * 2.4 + 0.6;
  const radius = 1350 + k * 140;
  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius * 0.65),
    f: k % 2 ? 0.94 : 1.04,
    r: k % 2 ? 2 : -2,
    w: 320,
    note: k % 2 ? 'tl' : 'br',
    stamp: [0, 210, -4],
  };
}

const FRAME_PAD = 12;
const CAPTION_H = 74;

interface CardModel {
  readonly index: number;
  readonly project: SideProject;
  readonly spot: Spot;
  readonly wide: boolean;
  /** Full card height in world px. */
  readonly h: number;
  readonly number: string;
  readonly kinds: string;
}

interface NoteModel {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly f: number;
  readonly r: number;
  readonly text: string;
  readonly name: string;
  readonly accent: string;
}

interface StampModel {
  readonly x: number;
  readonly y: number;
  readonly f: number;
  readonly r: number;
  readonly text: string;
  readonly accent: string;
}

interface ThreadModel {
  readonly a: number;
  readonly b: number;
  readonly label: string;
}

/** Thin camera state; everything per-frame lives outside Angular change detection. */
interface Camera {
  x: number;
  y: number;
  z: number;
}

/** CSS-style cubic-bezier easing (x1, y1, x2, y2). */
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sampleX(t) - x;
      const d = slopeX(t);
      if (Math.abs(err) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    t = Math.min(1, Math.max(0, t));
    return sampleY(t);
  };
}

const glide = bezier(0.16, 1, 0.3, 1);
const flight = bezier(0.55, 0, 0.1, 1);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Layout — Infinite Canvas: a pannable, zoomable moodboard with depth, threads and a minimap. */
@Component({
  selector: 'app-projects-canvas',
  imports: [ProjectMediaView],
  templateUrl: './canvas.html',
  styleUrl: './canvas.css',
})
export class ProjectsCanvas {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly round = Math.round;

  protected readonly cards = computed<readonly CardModel[]>(() =>
    this.projects().map((project, index) => {
      const spot = spotFor(index);
      const wide = !!project.extraMedia?.length || project.media.shape === 'wide';
      const mediaW = spot.w - FRAME_PAD * 2;
      const h = Math.round(mediaW * (wide ? 10.5 / 16 : 3 / 4) + FRAME_PAD + CAPTION_H);
      return {
        index,
        project,
        spot,
        wide,
        h,
        number: pad(index + 1),
        kinds: project.kinds.map(kindLabel).join(' · '),
      };
    }),
  );

  protected readonly notes = computed<readonly NoteModel[]>(() =>
    this.cards().map(({ index, project, spot, h }) => {
      const sx = spot.note.endsWith('r') ? 1 : -1;
      const sy = spot.note.startsWith('b') ? 1 : -1;
      return {
        index,
        x: spot.x + sx * (spot.w / 2 + 44),
        y: spot.y + (sy > 0 ? h / 2 - 180 : -(h / 2 - 50)),
        f: spot.f + 0.06,
        r: sx * sy * 4 + (index % 2 ? -2 : 1.5),
        text: project.tagline,
        name: project.name,
        accent: project.accent,
      };
    }),
  );

  protected readonly stamps = computed<readonly StampModel[]>(() =>
    this.cards().map(({ project, spot }) => ({
      x: spot.x + spot.stamp[0],
      y: spot.y + spot.stamp[1],
      f: spot.f - 0.035,
      r: spot.stamp[2],
      text: project.status
        ? `${project.kinds.map(kindLabel).join(' / ')} — ${project.status}`
        : project.kinds.map(kindLabel).join(' / '),
      accent: project.accent,
    })),
  );

  /** Each project is tied to the two projects it shares the most technologies with. */
  protected readonly threads = computed<readonly ThreadModel[]>(() => {
    const list = this.projects();
    const usage = new Map<string, number>();
    for (const p of list) for (const t of p.technologies) usage.set(t, (usage.get(t) ?? 0) + 1);
    const shared = (a: SideProject, b: SideProject) =>
      a.technologies.filter((t) => b.technologies.includes(t));
    const keep = new Map<string, ThreadModel>();
    list.forEach((a, i) => {
      const ranked = list
        .map((b, j) => ({ j, common: j === i ? [] : shared(a, b) }))
        .filter((c) => c.common.length > 0)
        .sort((m, n) => n.common.length - m.common.length || Math.abs(m.j - i) - Math.abs(n.j - i))
        .slice(0, 2);
      for (const { j, common } of ranked) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (keep.has(key)) continue;
        const rarest = [...common].sort((m, n) => (usage.get(m) ?? 0) - (usage.get(n) ?? 0))[0];
        keep.set(key, {
          a: Math.min(i, j),
          b: Math.max(i, j),
          label: common.length > 1 ? `${rarest} +${common.length - 1}` : rarest,
        });
      }
    });
    return [...keep.values()];
  });

  protected readonly techCount = computed(
    () => new Set(this.projects().flatMap((p) => p.technologies)).size,
  );

  /** World bounds of the cards (with air) for fit + minimap. */
  protected readonly bounds = computed(() => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const { spot, h } of this.cards()) {
      x0 = Math.min(x0, spot.x - spot.w / 2);
      x1 = Math.max(x1, spot.x + spot.w / 2);
      y0 = Math.min(y0, spot.y - h / 2);
      y1 = Math.max(y1, spot.y + h / 2);
    }
    // The title card sits above the board's centre.
    y0 = Math.min(y0, TITLE.y - 140);
    const air = 60;
    return { x0: x0 - air, y0: y0 - air, x1: x1 + air, y1: y1 + air };
  });

  protected readonly minimapAspect = computed(() => {
    const b = this.bounds();
    return (b.x1 - b.x0) / (b.y1 - b.y0);
  });

  protected readonly title = TITLE;
  protected readonly scribbles = SCRIBBLES;

  /** Projects whose media should play right now (≤ 3). */
  protected readonly playing = signal<ReadonlySet<number>>(new Set());
  /** Card under the pointer / keyboard focus: its threads light up. */
  protected readonly hot = signal<number | null>(null);
  protected readonly entered = signal(false);
  protected readonly touched = signal(false);
  protected readonly dragging = signal(false);
  protected readonly touchUi = signal(false);

  private readonly document = inject(DOCUMENT);
  private readonly board = viewChild.required<ElementRef<HTMLElement>>('board');

  /* Imperative camera API, wired up after render. */
  private flyToCardImpl: (index: number) => void = () => {};
  private zoomByImpl: (factor: number) => void = () => {};
  private fitImpl: () => void = () => {};
  private centredImpl: (index: number, keyboard: boolean) => boolean = () => false;
  private nearestImpl: () => number = () => 0;
  private dragged = false;
  private flyTarget: number | null = null;

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      if (!view) return;
      const board = this.board().nativeElement;
      const reduced = prefersReducedMotion(view);
      this.touchUi.set(!canHover(view));

      const dots = board.querySelector<HTMLElement>('.cv-dots')!;
      const zoomLabel = board.querySelector<HTMLElement>('.cv-zoom-level')!;
      const mmView = board.querySelector<HTMLElement>('.cv-mm-view')!;
      const minimap = board.querySelector<HTMLElement>('.cv-minimap')!;
      const cursor = board.querySelector<HTMLElement>('.cv-cursor');
      const threadPaths = [...board.querySelectorAll<SVGPathElement>('.cv-thread')];
      const threadGlows = [...board.querySelectorAll<SVGPathElement>('.cv-thread-glow')];
      const threadLabels = [...board.querySelectorAll<HTMLElement>('.cv-thread-label')];

      interface Item {
        el: HTMLElement;
        x: number;
        y: number;
        f: number;
      }
      const items: Item[] = [...board.querySelectorAll<HTMLElement>('.cv-item')].map((el) => ({
        el,
        x: Number(el.dataset['x']),
        y: Number(el.dataset['y']),
        f: Number(el.dataset['f']),
      }));

      const cards = this.cards();
      const threads = this.threads();
      const bounds = this.bounds();
      const cam: Camera = { x: 0, y: 0, z: 0.6 };
      let W = board.clientWidth;
      let H = board.clientHeight;
      let minZ = 0.2;
      const maxZ = 2.4;

      const fitZoom = () => {
        const bw = bounds.x1 - bounds.x0;
        const bh = bounds.y1 - bounds.y0;
        return Math.min(W / bw, H / bh);
      };
      const cardZoom = (c: CardModel) => {
        const narrow = W < 640;
        const targetW = Math.min(W * (narrow ? 0.84 : 0.56), (H * 0.7 * c.spot.w) / c.h);
        return clamp(targetW / (c.spot.w * c.spot.f), minZ, maxZ);
      };
      /** Keep the content on screen: the board can drift, but never be lost. */
      const range = (lo: number, hi: number, span: number) => {
        let a = lo + span * 0.3;
        let b = hi - span * 0.3;
        if (a > b) [a, b] = [b, a];
        return [a, b] as const;
      };
      const clampCamAt = (c: Camera) => {
        c.z = clamp(c.z, minZ, maxZ);
        const [ax, bx] = range(bounds.x0, bounds.x1, W / c.z);
        const [ay, by] = range(bounds.y0, bounds.y1, H / c.z);
        c.x = clamp(c.x, ax, bx);
        c.y = clamp(c.y, ay, by);
      };
      const clampCam = () => clampCamAt(cam);

      /* ---------- Render (one rAF per dirty frame) ---------- */

      let scheduled = 0;
      let lastPlayCheck = 0;
      let onScreen = false;
      const screenOf = (x: number, y: number, f: number) => ({
        x: W / 2 + cam.z * f * (x - cam.x),
        y: H / 2 + cam.z * f * (y - cam.y),
      });
      const pinOf = (c: CardModel) => {
        const r = (c.spot.r * Math.PI) / 180;
        const oy = -c.h / 2 - 4;
        return screenOf(c.spot.x - oy * Math.sin(r), c.spot.y + oy * Math.cos(r), c.spot.f);
      };

      const updatePlaying = (force = false) => {
        const now = performance.now();
        if (!force && now - lastPlayCheck < 180) return;
        lastPlayCheck = now;
        const next = new Set<number>();
        if (onScreen && this.document.visibilityState === 'visible' && !reduced) {
          cards
            .map((c) => {
              const s = cam.z * c.spot.f;
              const p = screenOf(c.spot.x, c.spot.y, c.spot.f);
              const w = c.spot.w * s;
              const h = c.h * s;
              const ix = Math.max(0, Math.min(W, p.x + w / 2) - Math.max(0, p.x - w / 2));
              const iy = Math.max(0, Math.min(H, p.y + h / 2) - Math.max(0, p.y - h / 2));
              return { i: c.index, seen: (ix * iy) / (w * h), w, d: Math.hypot(p.x - W / 2, p.y - H / 2) };
            })
            .filter((c) => c.seen > 0.45 && c.w > 80)
            .sort((a, b) => a.d - b.d)
            .slice(0, 3)
            .forEach((c) => next.add(c.i));
        }
        const prev = this.playing();
        if (next.size !== prev.size || [...next].some((i) => !prev.has(i))) this.playing.set(next);
      };

      const render = () => {
        scheduled = 0;
        for (const it of items) {
          const s = cam.z * it.f;
          const p = screenOf(it.x, it.y, it.f);
          it.el.style.transform = `translate3d(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
        }
        // Dot grid sits deepest, so it drifts slowest.
        const gf = 0.82;
        let gap = 30 * cam.z * gf;
        while (gap < 15) gap *= 2;
        dots.style.backgroundSize = `${gap}px ${gap}px`;
        dots.style.backgroundPosition = `${W / 2 - cam.x * cam.z * gf}px ${H / 2 - cam.y * cam.z * gf}px`;

        threads.forEach((t, k) => {
          const a = pinOf(cards[t.a]);
          const b = pinOf(cards[t.b]);
          const dist = Math.hypot(b.x - a.x, b.y - a.y);
          const cx = (a.x + b.x) / 2;
          const cy = (a.y + b.y) / 2 + Math.min(180 * cam.z, dist * 0.2);
          const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
          threadPaths[k]?.setAttribute('d', d);
          threadGlows[k]?.setAttribute('d', d);
          const label = threadLabels[k];
          if (label) {
            const lx = 0.25 * a.x + 0.5 * cx + 0.25 * b.x;
            const ly = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
            label.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0) translate(-50%, -50%)`;
          }
        });

        const bw = bounds.x1 - bounds.x0;
        const bh = bounds.y1 - bounds.y0;
        const vw = W / cam.z;
        const vh = H / cam.z;
        mmView.style.left = `${((cam.x - vw / 2 - bounds.x0) / bw) * 100}%`;
        mmView.style.top = `${((cam.y - vh / 2 - bounds.y0) / bh) * 100}%`;
        mmView.style.width = `${(vw / bw) * 100}%`;
        mmView.style.height = `${(vh / bh) * 100}%`;
        zoomLabel.textContent = `${Math.round(cam.z * 100)}%`;
        updatePlaying();
      };
      const requestRender = () => {
        if (!scheduled) scheduled = requestAnimationFrame(render);
      };

      /* ---------- Camera animation ---------- */

      let anim = 0;
      const stop = () => {
        cancelAnimationFrame(anim);
        anim = 0;
        board.classList.remove('is-flying');
      };
      const settle = () => {
        board.classList.remove('is-flying');
        updatePlaying(true);
        refreshCursor();
      };

      const flyTo = (tx: number, ty: number, tz: number, mode: 'flight' | 'glide' = 'flight', ms?: number) => {
        stop();
        const target: Camera = { x: tx, y: ty, z: tz };
        clampCamAt(target);
        ({ x: tx, y: ty, z: tz } = target);
        if (reduced) {
          cam.x = tx;
          cam.y = ty;
          cam.z = tz;
          requestRender();
          queueMicrotask(settle);
          return;
        }
        const from = { ...cam };
        const travel = Math.hypot(tx - from.x, ty - from.y) * Math.min(from.z, tz);
        const duration =
          ms ?? (mode === 'flight' ? clamp(650 + travel * 0.32, 750, 1500) : clamp(420 + travel * 0.2, 420, 900));
        // Long hops lift the camera out a little mid-flight, like a map fly-to.
        const lift = mode === 'flight' ? clamp(travel / (Math.max(W, H) * 2.2), 0, 0.42) : 0;
        const ease = mode === 'flight' ? flight : glide;
        const z0 = Math.log(from.z);
        const z1 = Math.log(tz);
        const start = performance.now();
        board.classList.add('is-flying');
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const e = ease(t);
          cam.x = from.x + (tx - from.x) * e;
          cam.y = from.y + (ty - from.y) * e;
          cam.z = Math.exp(z0 + (z1 - z0) * e) * (1 - lift * Math.sin(Math.PI * e));
          render();
          if (t < 1) anim = requestAnimationFrame(step);
          else {
            anim = 0;
            settle();
          }
        };
        anim = requestAnimationFrame(step);
      };

      const zoomAround = (px: number, py: number, nextZ: number) => {
        nextZ = clamp(nextZ, minZ, maxZ);
        const wx = cam.x + (px - W / 2) / cam.z;
        const wy = cam.y + (py - H / 2) / cam.z;
        cam.z = nextZ;
        cam.x = wx - (px - W / 2) / cam.z;
        cam.y = wy - (py - H / 2) / cam.z;
        clampCam();
        requestRender();
      };

      this.flyToCardImpl = (index) => {
        const c = cards[index];
        if (!c) return;
        this.flyTarget = index;
        this.touched.set(true);
        flyTo(c.spot.x, c.spot.y, cardZoom(c));
      };
      this.zoomByImpl = (factor) => {
        this.touched.set(true);
        this.flyTarget = null;
        flyTo(cam.x, cam.y, cam.z * factor, 'glide');
      };
      const fit = (animate = true) => {
        const b = bounds;
        const z = clamp(fitZoom() * 0.98, minZ, maxZ);
        this.flyTarget = null;
        if (animate) flyTo((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, z, 'flight');
        else {
          cam.x = (b.x0 + b.x1) / 2;
          cam.y = (b.y0 + b.y1) / 2;
          cam.z = z;
        }
      };
      this.fitImpl = () => {
        this.touched.set(true);
        fit();
      };
      this.centredImpl = (index, keyboard) => {
        const c = cards[index];
        if (!c) return false;
        if (keyboard && this.flyTarget === index) return true;
        if (anim) return false;
        const p = screenOf(c.spot.x, c.spot.y, c.spot.f);
        const near = Math.hypot(p.x - W / 2, p.y - H / 2) < Math.min(W, H) * 0.16;
        const big = c.spot.w * c.spot.f * cam.z >= Math.min(W * 0.4, cardZoom(c) * c.spot.w * c.spot.f * 0.8);
        return near && big;
      };
      this.nearestImpl = () => {
        if (this.flyTarget !== null) return this.flyTarget;
        let best = 0;
        let bestD = Infinity;
        for (const c of cards) {
          const p = screenOf(c.spot.x, c.spot.y, c.spot.f);
          const d = Math.hypot(p.x - W / 2, p.y - H / 2);
          if (d < bestD) {
            bestD = d;
            best = c.index;
          }
        }
        return best;
      };

      /* ---------- Size + first frame ---------- */

      const measure = () => {
        W = board.clientWidth;
        H = board.clientHeight;
        minZ = Math.max(0.12, fitZoom() * 0.7);
        clampCam();
        requestRender();
      };
      measure();
      if (W < 640) {
        const first = cards.find((c) => c.project.featured) ?? cards[0];
        if (first) {
          cam.x = first.spot.x;
          cam.y = first.spot.y;
          cam.z = cardZoom(first);
        }
      } else {
        fit(false);
        cam.z = clamp(cam.z * 1.1, minZ, maxZ);
        cam.y -= 10;
      }
      render();
      const resize = new ResizeObserver(measure);
      resize.observe(board);

      const io = new IntersectionObserver(
        ([entry]) => {
          onScreen = !!entry?.isIntersecting;
          if (onScreen && (entry?.intersectionRatio ?? 0) > 0.2) this.entered.set(true);
          updatePlaying(true);
        },
        { threshold: [0, 0.25] },
      );
      io.observe(board);
      const onVisibility = () => updatePlaying(true);
      this.document.addEventListener('visibilitychange', onVisibility);

      /* ---------- Pointer: pan, inertia, pinch ---------- */

      const pointers = new Map<number, { x: number; y: number }>();
      let startX = 0;
      let startY = 0;
      let lastX = 0;
      let lastY = 0;
      let lastT = 0;
      let vx = 0;
      let vy = 0;
      let pinchDist = 0;
      let pinchZ = 1;
      let pinchWorld = { x: 0, y: 0 };
      const local = (e: { clientX: number; clientY: number }) => {
        const rect = board.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      };
      const beginPinch = () => {
        const [p, q] = [...pointers.values()];
        if (!p || !q) return;
        pinchDist = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        pinchZ = cam.z;
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        pinchWorld = { x: cam.x + (mx - W / 2) / cam.z, y: cam.y + (my - H / 2) / cam.z };
      };
      const beginPan = (p: { x: number; y: number }) => {
        startX = lastX = p.x;
        startY = lastY = p.y;
        lastT = performance.now();
        vx = vy = 0;
      };

      const onDown = (e: PointerEvent) => {
        if ((e.target as Element).closest('.cv-ui')) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        stop();
        const p = local(e);
        pointers.set(e.pointerId, p);
        if (pointers.size === 1) {
          this.dragged = false;
          beginPan(p);
        } else if (pointers.size === 2) {
          this.dragged = true;
          beginPinch();
        }
      };
      const onMove = (e: PointerEvent) => {
        const p = local(e);
        if (cursor && e.pointerType === 'mouse') {
          cursor.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
        }
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, p);
        if (pointers.size >= 2) {
          const [a, b] = [...pointers.values()];
          if (!a || !b) return;
          const dist = Math.hypot(b.x - a.x, b.y - a.y);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          cam.z = clamp((pinchZ * dist) / pinchDist, minZ, maxZ);
          cam.x = pinchWorld.x - (mx - W / 2) / cam.z;
          cam.y = pinchWorld.y - (my - H / 2) / cam.z;
          clampCam();
          this.flyTarget = null;
          this.touched.set(true);
          requestRender();
          return;
        }
        if (!this.dragged && Math.hypot(p.x - startX, p.y - startY) > 5) {
          this.dragged = true;
          this.flyTarget = null;
          this.dragging.set(true);
          this.touched.set(true);
          try {
            board.setPointerCapture(e.pointerId);
          } catch {
            // Capture can fail if the pointer is already gone.
          }
        }
        if (!this.dragged) return;
        const now = performance.now();
        const dt = Math.max(1, now - lastT);
        const dx = p.x - lastX;
        const dy = p.y - lastY;
        vx = vx * 0.3 + (dx / dt) * 0.7;
        vy = vy * 0.3 + (dy / dt) * 0.7;
        lastX = p.x;
        lastY = p.y;
        lastT = now;
        cam.x -= dx / cam.z;
        cam.y -= dy / cam.z;
        clampCam();
        requestRender();
      };
      const coast = () => {
        let prev = performance.now();
        board.classList.add('is-flying');
        const step = (now: number) => {
          const dt = Math.min(48, now - prev);
          prev = now;
          const decay = Math.pow(0.915, dt / 16);
          vx *= decay;
          vy *= decay;
          const bx = cam.x;
          const by = cam.y;
          cam.x -= (vx * dt) / cam.z;
          cam.y -= (vy * dt) / cam.z;
          clampCam();
          if (cam.x === bx) vx = 0;
          if (cam.y === by) vy = 0;
          render();
          if (Math.hypot(vx, vy) > 0.02) anim = requestAnimationFrame(step);
          else {
            anim = 0;
            settle();
          }
        };
        anim = requestAnimationFrame(step);
      };
      const onUp = (e: PointerEvent) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (pointers.size === 1) {
          const rest = [...pointers.values()][0];
          if (rest) beginPan(rest);
          return;
        }
        if (pointers.size > 0) return;
        this.dragging.set(false);
        if (!this.dragged) return;
        if (performance.now() - lastT > 90) vx = vy = 0;
        const speed = Math.hypot(vx, vy);
        if (speed > 2.4) {
          vx *= 2.4 / speed;
          vy *= 2.4 / speed;
        }
        if (!reduced && Math.hypot(vx, vy) > 0.05) coast();
        else settle();
      };

      /* ---------- Wheel / trackpad ---------- */

      const onWheel = (e: WheelEvent) => {
        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          stop();
          this.flyTarget = null;
          this.touched.set(true);
          const p = local(e);
          const dy = clamp(e.deltaY * scale, -60, 60);
          zoomAround(p.x, p.y, cam.z * Math.exp(-dy * 0.0065));
          scheduleSettle();
          return;
        }
        // Sideways trackpad swipes pan the board; vertical wheel keeps scrolling the page.
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2) {
          e.preventDefault();
          stop();
          this.flyTarget = null;
          this.touched.set(true);
          cam.x += (e.deltaX * scale) / cam.z;
          clampCam();
          requestRender();
          scheduleSettle();
        }
      };
      let settleTimer = 0;
      const scheduleSettle = () => {
        view.clearTimeout(settleTimer);
        settleTimer = view.setTimeout(settle, 160);
      };

      // Safari desktop pinch arrives as gesture events.
      let gestureZ = 1;
      const onGestureStart = (e: Event) => {
        e.preventDefault();
        gestureZ = cam.z;
      };
      const onGestureChange = (e: Event) => {
        e.preventDefault();
        const g = e as Event & { scale?: number; clientX?: number; clientY?: number };
        const p = local({ clientX: g.clientX ?? 0, clientY: g.clientY ?? 0 });
        this.touched.set(true);
        zoomAround(p.x, p.y, gestureZ * (g.scale ?? 1));
      };

      /* ---------- Keyboard ---------- */

      const onKey = (e: KeyboardEvent) => {
        if ((e.target as Element).closest('.cv-ui') && e.key !== 'Escape') {
          if (!e.key.startsWith('Arrow')) return;
        }
        if (e.key === 'Tab') {
          // Tab walks the cards in order; the camera follows (no browser scroll jumps).
          const active = this.document.activeElement as HTMLElement | null;
          const current = active?.closest<HTMLElement>('.cv-card');
          const from = current ? Number(current.dataset['index']) : active === board ? -1 : null;
          if (from === null) return;
          const next = from + (e.shiftKey ? -1 : 1);
          if (next < 0 || next >= cards.length) return;
          const el = board.querySelector<HTMLElement>(`.cv-card[data-index="${next}"]`);
          if (!el) return;
          e.preventDefault();
          el.focus({ preventScroll: true });
          this.hot.set(next);
          if (this.flyTarget !== next) this.flyToCardImpl(next);
          return;
        }
        const stepPx = Math.min(W, H) * 0.22;
        let handled = true;
        switch (e.key) {
          case 'ArrowLeft':
            this.flyTarget = null;
            flyTo(cam.x - stepPx / cam.z, cam.y, cam.z, 'glide', 380);
            break;
          case 'ArrowRight':
            this.flyTarget = null;
            flyTo(cam.x + stepPx / cam.z, cam.y, cam.z, 'glide', 380);
            break;
          case 'ArrowUp':
            this.flyTarget = null;
            flyTo(cam.x, cam.y - stepPx / cam.z, cam.z, 'glide', 380);
            break;
          case 'ArrowDown':
            this.flyTarget = null;
            flyTo(cam.x, cam.y + stepPx / cam.z, cam.z, 'glide', 380);
            break;
          case '+':
          case '=':
            this.zoomByImpl(1.35);
            break;
          case '-':
          case '_':
            this.zoomByImpl(1 / 1.35);
            break;
          case '0':
            this.fitImpl();
            break;
          default:
            handled = false;
        }
        if (handled) {
          this.touched.set(true);
          e.preventDefault();
        }
      };

      // Keyboard focus moving onto a card brings the camera along.
      const onFocusIn = (e: FocusEvent) => {
        const card = (e.target as Element).closest<HTMLElement>('.cv-card');
        if (!card || !card.matches(':focus-visible')) return;
        const index = Number(card.dataset['index']);
        this.hot.set(index);
        if (this.flyTarget !== index || !this.centredImpl(index, false)) this.flyToCardImpl(index);
      };
      const onFocusOut = (e: FocusEvent) => {
        if ((e.target as Element).closest('.cv-card')) this.hot.set(null);
      };

      /* ---------- Minimap ---------- */

      let mmPointer: number | null = null;
      const mmPoint = (e: PointerEvent) => {
        const rect = minimap.getBoundingClientRect();
        return {
          x: bounds.x0 + ((e.clientX - rect.left) / rect.width) * (bounds.x1 - bounds.x0),
          y: bounds.y0 + ((e.clientY - rect.top) / rect.height) * (bounds.y1 - bounds.y0),
        };
      };
      const onMmDown = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        mmPointer = e.pointerId;
        minimap.setPointerCapture(e.pointerId);
        minimap.classList.add('is-active');
        this.touched.set(true);
        this.flyTarget = null;
        const p = mmPoint(e);
        flyTo(p.x, p.y, cam.z, 'glide', 520);
      };
      const onMmMove = (e: PointerEvent) => {
        if (mmPointer !== e.pointerId) return;
        stop();
        const p = mmPoint(e);
        cam.x = p.x;
        cam.y = p.y;
        clampCam();
        requestRender();
      };
      const onMmUp = (e: PointerEvent) => {
        if (mmPointer !== e.pointerId) return;
        mmPointer = null;
        minimap.classList.remove('is-active');
        if (!anim) settle();
      };

      /* ---------- Hover cursor label ---------- */

      let hoverIndex: number | null = null;
      const refreshCursor = () => {
        if (!cursor) return;
        const label = cursor.querySelector('.cv-cursor-text');
        if (hoverIndex === null) {
          cursor.classList.remove('is-on');
          return;
        }
        if (label) label.textContent = this.centredImpl(hoverIndex, false) ? 'Open case' : 'Zoom in';
        cursor.classList.add('is-on');
      };
      const onOver = (e: PointerEvent) => {
        if (e.pointerType !== 'mouse') return;
        const card = (e.target as Element).closest<HTMLElement>('.cv-card');
        const index = card ? Number(card.dataset['index']) : null;
        if (index === hoverIndex) return;
        hoverIndex = index;
        this.hot.set(index);
        refreshCursor();
      };
      const onLeave = () => {
        hoverIndex = null;
        this.hot.set(null);
        refreshCursor();
      };

      board.addEventListener('pointerdown', onDown);
      board.addEventListener('pointermove', onMove);
      board.addEventListener('pointerup', onUp);
      board.addEventListener('pointercancel', onUp);
      board.addEventListener('pointerover', onOver);
      board.addEventListener('pointerleave', onLeave);
      board.addEventListener('wheel', onWheel, { passive: false });
      board.addEventListener('gesturestart', onGestureStart);
      board.addEventListener('gesturechange', onGestureChange);
      board.addEventListener('keydown', onKey);
      board.addEventListener('focusin', onFocusIn);
      board.addEventListener('focusout', onFocusOut);
      minimap.addEventListener('pointerdown', onMmDown);
      minimap.addEventListener('pointermove', onMmMove);
      minimap.addEventListener('pointerup', onMmUp);
      minimap.addEventListener('pointercancel', onMmUp);

      cleanup = () => {
        stop();
        cancelAnimationFrame(scheduled);
        view.clearTimeout(settleTimer);
        resize.disconnect();
        io.disconnect();
        this.document.removeEventListener('visibilitychange', onVisibility);
        board.removeEventListener('pointerdown', onDown);
        board.removeEventListener('pointermove', onMove);
        board.removeEventListener('pointerup', onUp);
        board.removeEventListener('pointercancel', onUp);
        board.removeEventListener('pointerover', onOver);
        board.removeEventListener('pointerleave', onLeave);
        board.removeEventListener('wheel', onWheel);
        board.removeEventListener('gesturestart', onGestureStart);
        board.removeEventListener('gesturechange', onGestureChange);
        board.removeEventListener('keydown', onKey);
        board.removeEventListener('focusin', onFocusIn);
        board.removeEventListener('focusout', onFocusOut);
        minimap.removeEventListener('pointerdown', onMmDown);
        minimap.removeEventListener('pointermove', onMmMove);
        minimap.removeEventListener('pointerup', onMmUp);
        minimap.removeEventListener('pointercancel', onMmUp);
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }

  /* ---------- Template API ---------- */

  protected isHotThread(t: ThreadModel): boolean {
    const hot = this.hot();
    return hot !== null && (t.a === hot || t.b === hot);
  }

  protected mmLeft(x: number, w = 0): string {
    const b = this.bounds();
    return `${((x - w / 2 - b.x0) / (b.x1 - b.x0)) * 100}%`;
  }

  protected mmTop(y: number, h = 0): string {
    const b = this.bounds();
    return `${((y - h / 2 - b.y0) / (b.y1 - b.y0)) * 100}%`;
  }

  protected mmSize(size: number, axis: 'x' | 'y'): string {
    const b = this.bounds();
    return `${(size / (axis === 'x' ? b.x1 - b.x0 : b.y1 - b.y0)) * 100}%`;
  }

  protected onCard(index: number, event: MouseEvent): void {
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    const keyboard = event.detail === 0;
    if (this.centredImpl(index, keyboard)) {
      const card = event.currentTarget as HTMLElement;
      this.openCase.emit({ index, media: card.querySelector('app-project-media') });
    } else {
      this.flyToCardImpl(index);
    }
  }

  protected onCardDouble(index: number): void {
    if (!this.centredImpl(index, false)) this.flyToCardImpl(index);
  }

  protected legend(index: number): void {
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    this.flyToCardImpl(index);
  }

  protected zoomBy(factor: number): void {
    this.zoomByImpl(factor);
  }

  protected fit(): void {
    this.fitImpl();
  }

  protected tour(delta: number): void {
    const n = this.projects().length;
    const from = this.nearestImpl();
    this.flyToCardImpl((from + delta + n) % n);
  }
}

/** The masthead card, pinned above the board's centre. */
const TITLE = { x: -40, y: -455, f: 0.97, r: -1.5 } as const;

/** Handwritten hints with arrows (UI copy only, no project claims). */
const SCRIBBLES = [
  {
    x: 420,
    y: -150,
    f: 1.02,
    r: -4,
    text: 'double-click to fly in',
    touchText: 'tap a card to fly in',
    arrow: 'M196 30 C 150 20, 92 28, 54 62 C 38 76, 28 92, 22 112',
    head: 'M8 98 L22 114 L34 96',
  },
  {
    x: -520,
    y: 40,
    f: 0.98,
    r: 3,
    text: 'threads = shared tech',
    touchText: 'threads = shared tech',
    arrow: 'M30 34 C 70 18, 130 16, 168 40 C 186 52, 196 70, 198 92',
    head: 'M184 80 L198 96 L208 78',
  },
] as const;
