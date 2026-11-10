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
  viewChildren,
} from '@angular/core';
import { ProjectKind, projectKinds, SideProject } from '../../../data/projects';
import { ProjectMediaView } from '../project-media';
import { kindLabel, OpenCase, pad, prefersReducedMotion } from './shared';

interface Vec {
  x: number;
  y: number;
}

interface Camera {
  x: number;
  y: number;
  s: number;
  fx: number;
  fy: number;
}

interface Constellation {
  readonly kind: ProjectKind;
  readonly label: string;
  readonly stars: readonly number[];
}

interface FieldStar {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly a: number;
  readonly phase: number;
  readonly speed: number;
  readonly tint: string;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
}

interface Lens {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly side: boolean;
}

/** Small deterministic PRNG so the sky is the same on every visit. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.replace(/./g, (c) => c + c) : m;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** [width in canvas px, alpha factor] of the strokes that stand in for the figure glow's 10px shadow blur. */
const GLOW_HALO: readonly (readonly [number, number])[] = [
  [26, 0.0069],
  [20, 0.0185],
  [14, 0.026],
  [9, 0.0277],
  [5, 0.0231],
];
const TINTS = ['255,255,255', '200,215,255', '255,236,210', '215,225,255', '255,220,200'];

/**
 * Layout — Constellations: a deep night sky. Every project is a named star;
 * stars of the same kind form a constellation. Hover traces it, selecting
 * glides the sky to the star and opens a telescope eyepiece around it with
 * the project's demo playing inside the lens.
 */
@Component({
  selector: 'app-projects-stars',
  imports: [ProjectMediaView],
  templateUrl: './stars.html',
  styleUrl: './stars.css',
})
export class ProjectsStars {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;
  protected readonly hovered = signal(-1);
  protected readonly selected = signal(-1);
  protected readonly lensOpen = signal(false);
  protected readonly visible = signal(false);
  protected readonly side = signal(true);
  protected readonly flip = signal<readonly boolean[]>([]);

  protected readonly constellations = computed<readonly Constellation[]>(() => {
    const projects = this.projects();
    return projectKinds
      .map((k) => ({
        kind: k.id,
        label: k.label,
        stars: projects.map((p, i) => (p.kinds.includes(k.id) ? i : -1)).filter((i) => i >= 0),
      }))
      .filter((c) => c.stars.length > 0);
  });

  /** Kinds lit by the hovered or selected star. */
  protected readonly lit = computed(() => {
    const index = this.hovered() >= 0 ? this.hovered() : this.selected();
    return new Set(this.projects()[index]?.kinds ?? []);
  });

  /** Decorative chart coordinates derived from the star's place in the sky. */
  protected readonly coords = signal<readonly string[]>([]);

  private readonly document = inject(DOCUMENT);
  private readonly sky = viewChild.required<ElementRef<HTMLElement>>('sky');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  /** Static sky (Milky Way, dust, faint figures): repainted only when the view moves. */
  private readonly backCanvas = viewChild.required<ElementRef<HTMLCanvasElement>>('back');
  private readonly starButtons = viewChildren<ElementRef<HTMLElement>>('star');
  private readonly names = viewChildren<ElementRef<HTMLElement>>('conName');
  private readonly reduced = prefersReducedMotion(this.document.defaultView);

  private w = 0;
  private h = 0;
  private pos: Vec[] = [];
  private edges: (readonly [number, number])[][] = [];
  private lens: Lens = { x: 0, y: 0, r: 0, side: true };
  private cam: Camera = { x: 0, y: 0, s: 1, fx: 0, fy: 0 };
  private tween: { from: Camera; to: Camera; start: number; duration: number; done?: () => void } | null = null;
  private request = () => {};

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      if (!view) return;
      const sky = this.sky().nativeElement;
      const canvas = this.canvas().nativeElement;
      const backCanvas = this.backCanvas().nativeElement;
      const ctx = canvas.getContext('2d');
      const bctx = backCanvas.getContext('2d', { alpha: false });
      if (!ctx || !bctx) return;
      const reduced = this.reduced;
      const projects = this.projects();
      const rand = rng(hash(projects.map((p) => p.name).join('|')));

      let dpr = 1;
      let far: HTMLCanvasElement | null = null;
      const FAR_M = 140;
      let mid: FieldStar[] = [];
      let twinkle: FieldStar[] = [];
      let sprites: HTMLCanvasElement[] = [];
      const meteors: Meteor[] = [];
      let nextMeteor = performance.now() + 3500;
      const glow = new Map<ProjectKind, number>();
      const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
      /** Whether the next frame must run at full rate (camera, parallax, glow or a meteor in motion). */
      let busy = true;
      /** The static sky layer must be repainted (size changed). */
      let viewDirty = true;

      const makeSprite = (hex: string) => {
        const size = 128;
        const c = this.document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d')!;
        const [r, gg, b] = hexToRgb(hex);
        const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.08, `rgba(255,255,255,0.9)`);
        grad.addColorStop(0.18, `rgba(${r},${gg},${b},0.55)`);
        grad.addColorStop(0.45, `rgba(${r},${gg},${b},0.12)`);
        grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
        return c;
      };
      sprites = projects.map((p) => makeSprite(p.accent));

      /** Diffraction spikes (normal and focused), drawn once and scaled by the twinkle when blitted. */
      const SPIKE_RES = 2;
      const makeSpikes = (hex: string, spike: number) => {
        const half = Math.ceil(spike + 2);
        const c = this.document.createElement('canvas');
        c.width = c.height = half * 2 * SPIKE_RES;
        const g = c.getContext('2d')!;
        g.scale(SPIKE_RES, SPIKE_RES);
        g.translate(half, half);
        g.globalCompositeOperation = 'lighter';
        const [r, gg, b] = hexToRgb(hex);
        const drawSpike = (dx: number, dy: number, len: number, alpha: number) => {
          const grad = g.createLinearGradient(0, 0, dx * len, dy * len);
          grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
          grad.addColorStop(0.25, `rgba(${r},${gg},${b},${alpha * 0.6})`);
          grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
          g.strokeStyle = grad;
          g.beginPath();
          g.moveTo(0, 0);
          g.lineTo(dx * len, dy * len);
          g.stroke();
        };
        g.lineWidth = 1.1;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const)
          drawSpike(dx, dy, spike, 0.85);
        g.lineWidth = 0.8;
        const d = Math.SQRT1_2;
        for (const [dx, dy] of [
          [d, d],
          [-d, d],
          [d, -d],
          [-d, -d],
        ] as const)
          drawSpike(dx, dy, spike * 0.38, 0.45);
        return { canvas: c, half };
      };
      const spikes = projects.map((p) => [makeSpikes(p.accent, 30), makeSpikes(p.accent, 46)] as const);

      /** Milky Way band + faint dust of stars, rendered once per size. */
      const paintFar = () => {
        const W = this.w + FAR_M * 2;
        const H = this.h + FAR_M * 2;
        far = this.document.createElement('canvas');
        far.width = Math.round(W * dpr);
        far.height = Math.round(H * dpr);
        const g = far.getContext('2d')!;
        g.scale(dpr, dpr);
        const bg = g.createLinearGradient(0, 0, W * 0.3, H);
        bg.addColorStop(0, '#03050d');
        bg.addColorStop(0.55, '#070b1c');
        bg.addColorStop(1, '#0c1030');
        g.fillStyle = bg;
        g.fillRect(0, 0, W, H);
        const r = rng(7);
        // Band axis: from lower-left to upper-right.
        const ax = { x: -W * 0.05, y: H * 0.95 };
        const bx = { x: W * 1.05, y: H * 0.1 };
        const len = Math.hypot(bx.x - ax.x, bx.y - ax.y);
        const ux = (bx.x - ax.x) / len;
        const uy = (bx.y - ax.y) / len;
        const along = (t: number, off: number) => ({ x: ax.x + ux * t * len - uy * off, y: ax.y + uy * t * len + ux * off });
        const band = Math.min(W, H) * 0.16;
        g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 46; i++) {
          const t = r();
          const p = along(t, (r() - 0.5) * band * 1.2);
          const rad = band * (0.6 + r() * 1.1);
          const tint = r() < 0.5 ? '120,140,255' : r() < 0.6 ? '255,190,170' : '170,120,230';
          const cg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
          cg.addColorStop(0, `rgba(${tint},${0.05 + r() * 0.05})`);
          cg.addColorStop(1, `rgba(${tint},0)`);
          g.fillStyle = cg;
          g.fillRect(p.x - rad, p.y - rad, rad * 2, rad * 2);
        }
        // Dust lane.
        g.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 26; i++) {
          const t = r();
          const p = along(t, (r() - 0.35) * band * 0.4);
          const rad = band * (0.35 + r() * 0.5);
          const cg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
          cg.addColorStop(0, 'rgba(3,4,12,0.2)');
          cg.addColorStop(1, 'rgba(3,4,12,0)');
          g.fillStyle = cg;
          g.fillRect(p.x - rad, p.y - rad, rad * 2, rad * 2);
        }
        // Dust of faint stars, denser along the band.
        g.globalCompositeOperation = 'lighter';
        const total = Math.round((W * H) / 650);
        for (let i = 0; i < total; i++) {
          let p: Vec;
          if (i % 2) {
            const gauss = (r() + r() + r() - 1.5) * band * 0.9;
            p = along(r(), gauss);
          } else p = { x: r() * W, y: r() * H };
          const a = 0.15 + r() * 0.45;
          g.fillStyle = `rgba(${TINTS[Math.floor(r() * TINTS.length)]},${a})`;
          const s = r() < 0.9 ? 0.7 : 1.2;
          g.fillRect(p.x, p.y, s, s);
        }
        g.globalCompositeOperation = 'source-over';
      };

      const byTint = (stars: FieldStar[]) => stars.sort((a, b) => (a.tint < b.tint ? -1 : a.tint > b.tint ? 1 : 0));

      const makeField = (count: number, minR: number, maxR: number, seed: number): FieldStar[] => {
        const r = rng(seed);
        return Array.from({ length: count }, () => ({
          x: r(),
          y: r(),
          r: minR + Math.pow(r(), 3) * (maxR - minR),
          a: 0.35 + r() * 0.6,
          phase: r() * Math.PI * 2,
          speed: 0.6 + r() * 2.2,
          tint: TINTS[Math.floor(r() * TINTS.length)]!,
        }));
      };

      /** Place the named stars: each kind gets a region; stars sit near their kinds' regions. */
      const place = () => {
        const w = this.w;
        const h = this.h;
        const portrait = w < h * 0.9;
        const kinds = this.constellations();
        const centre = new Map<ProjectKind, Vec>();
        // Each constellation gets a share of the sky proportional to its size.
        const total = kinds.reduce((s, c) => s + c.stars.length, 0) || 1;
        let before = 0;
        kinds.forEach((c, k) => {
          const t = (before + c.stars.length / 2) / total;
          before += c.stars.length;
          const wave = Math.sin(k * 2.3 + 0.8);
          centre.set(
            c.kind,
            portrait ? { x: 0.5 + 0.22 * wave, y: 0.2 + 0.64 * t } : { x: 0.1 + 0.8 * t, y: 0.5 + 0.2 * wave },
          );
        });
        const anchor: Vec[] = projects.map((p) => {
          const cs = p.kinds.map((k) => centre.get(k)!).filter(Boolean);
          const r = rng(hash(p.name));
          const jitter = portrait ? 0.14 : 0.11;
          return {
            x: (cs.reduce((s, c) => s + c.x, 0) / cs.length + (r() - 0.5) * jitter * 1.6) * w,
            y: (cs.reduce((s, c) => s + c.y, 0) / cs.length + (r() - 0.5) * jitter * 2.2) * h,
          };
        });
        const pts = anchor.map((a) => ({ ...a }));
        const minD = Math.min(w, h) * (portrait ? 0.22 : 0.21);
        const top = Math.max(96, h * 0.16);
        for (let it = 0; it < 120; it++) {
          for (let i = 0; i < pts.length; i++) {
            for (let j = i + 1; j < pts.length; j++) {
              const a = pts[i]!;
              const b = pts[j]!;
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const d = Math.hypot(dx, dy) || 0.01;
              if (d < minD) {
                const push = ((minD - d) / d) * 0.25;
                a.x -= dx * push;
                a.y -= dy * push;
                b.x += dx * push;
                b.y += dy * push;
              }
            }
          }
          pts.forEach((p, i) => {
            p.x += (anchor[i]!.x - p.x) * 0.02;
            p.y += (anchor[i]!.y - p.y) * 0.02;
            p.x = clamp(p.x, w * 0.08, w * 0.9);
            p.y = clamp(p.y, top, h * 0.86);
          });
        }
        this.pos = pts;
        this.flip.set(pts.map((p) => p.x > w * 0.72));
        this.coords.set(
          pts.map((p) => {
            const ra = (p.x / w) * 24;
            const dec = Math.round(60 - (p.y / h) * 120);
            return `RA ${pad(Math.floor(ra))}h ${pad(Math.floor((ra % 1) * 60))}m · Dec ${dec >= 0 ? '+' : '−'}${pad(Math.abs(dec))}°`;
          }),
        );
        // Constellation figures: a minimum spanning tree per kind.
        this.edges = kinds.map((c) => {
          const inTree = new Set<number>([c.stars[0]!]);
          const out: [number, number][] = [];
          while (inTree.size < c.stars.length) {
            let best: [number, number] | null = null;
            let bestD = Infinity;
            for (const a of inTree) {
              for (const b of c.stars) {
                if (inTree.has(b)) continue;
                const d = Math.hypot(pts[a]!.x - pts[b]!.x, pts[a]!.y - pts[b]!.y);
                if (d < bestD) {
                  bestD = d;
                  best = [a, b];
                }
              }
            }
            if (!best) break;
            inTree.add(best[1]);
            out.push(best);
          }
          return out;
        });
      };

      const lensFor = (w: number, h: number): Lens => {
        if (w >= 900) {
          const r = Math.min(h * 0.34, w * 0.2, 280);
          return { x: w * 0.37, y: h * 0.5, r, side: true };
        }
        const r = Math.min(w * 0.42, h * 0.27);
        return { x: w / 2, y: r + Math.max(30, h * 0.05), r, side: false };
      };

      const overview = (): Camera => ({ x: this.w / 2, y: this.h / 2, s: 1, fx: this.w / 2, fy: this.h / 2 });
      const focusOn = (i: number): Camera => {
        const p = this.pos[i] ?? { x: this.w / 2, y: this.h / 2 };
        return { x: p.x, y: p.y, s: this.lens.side ? 1.45 : 1.3, fx: this.lens.x, fy: this.lens.y };
      };

      const resize = () => {
        const box = sky.getBoundingClientRect();
        if (!box.width || !box.height) return;
        this.w = box.width;
        this.h = box.height;
        dpr = Math.min(view.devicePixelRatio || 1, 1.75);
        canvas.width = backCanvas.width = Math.round(this.w * dpr);
        canvas.height = backCanvas.height = Math.round(this.h * dpr);
        const area = this.w * this.h;
        mid = byTint(makeField(Math.round(area / 5200), 0.5, 1.5, 11));
        twinkle = byTint(makeField(Math.round(area / 15000), 0.8, 1.9, 23));
        paintFar();
        place();
        this.lens = lensFor(this.w, this.h);
        this.side.set(this.lens.side);
        sky.style.setProperty('--lx', `${this.lens.x}px`);
        sky.style.setProperty('--ly', `${this.lens.y}px`);
        sky.style.setProperty('--lr', `${this.lens.r}px`);
        // Jump to where a running glide was heading, and let it finish (e.g. open the lens).
        const pending = this.tween;
        this.tween = null;
        pending?.done?.();
        this.cam = this.selected() >= 0 ? focusOn(this.selected()) : overview();
        viewDirty = true;
        busy = true;
        this.request();
      };

      /** Screen position of a sky point on a layer `depth` (1 = the named stars' plane). */
      const project = (p: Vec, depth: number, out: Vec) => {
        const c = this.cam;
        const s = 1 + (c.s - 1) * depth;
        const cx = this.w / 2 + (c.x - this.w / 2) * depth;
        const cy = this.h / 2 + (c.y - this.h / 2) * depth;
        const fx = this.w / 2 + (c.fx - this.w / 2) * depth;
        const fy = this.h / 2 + (c.fy - this.h / 2) * depth;
        out.x = (p.x - cx) * s + fx + pointer.x * 26 * depth;
        out.y = (p.y - cy) * s + fy + pointer.y * 18 * depth;
        return out;
      };

      const tmp: Vec = { x: 0, y: 0 };
      const tmp2: Vec = { x: 0, y: 0 };
      const src: Vec = { x: 0, y: 0 };

      const drawField = (g: CanvasRenderingContext2D, stars: FieldStar[], depth: number, t: number, twinkling: boolean) => {
        const W = this.w + 40;
        const H = this.h + 40;
        // Fields are sorted by tint: set the colour once per run and vary only the alpha.
        let tint = '';
        for (const star of stars) {
          src.x = star.x * W - 20;
          src.y = star.y * H - 20;
          project(src, depth, tmp);
          const x = ((((tmp.x + 20) % W) + W) % W) - 20;
          const y = ((((tmp.y + 20) % H) + H) % H) - 20;
          let a = star.a;
          if (twinkling && !reduced) a *= 0.55 + 0.45 * Math.sin(t * 0.001 * star.speed + star.phase);
          if (star.tint !== tint) {
            tint = star.tint;
            g.fillStyle = `rgb(${tint})`;
          }
          g.globalAlpha = a;
          if (star.r > 1.2) {
            g.beginPath();
            g.arc(x, y, star.r, 0, Math.PI * 2);
            g.fill();
            if (twinkling) {
              g.globalAlpha = a * 0.12;
              g.beginPath();
              g.arc(x, y, star.r * 3.2, 0, Math.PI * 2);
              g.fill();
            }
          } else g.fillRect(x - star.r / 2, y - star.r / 2, star.r, star.r);
        }
        g.globalAlpha = 1;
      };

      /** Ends of a figure segment, kept clear of the two stars it joins. */
      const segment = (a: number, b: number) => {
        const pa = project(this.pos[a]!, 1, tmp);
        const ax = pa.x;
        const ay = pa.y;
        const pb = project(this.pos[b]!, 1, tmp2);
        const dx = pb.x - ax;
        const dy = pb.y - ay;
        const len = Math.hypot(dx, dy) || 1;
        const gap = 14;
        return { sx: ax + (dx / len) * gap, sy: ay + (dy / len) * gap, ex: pb.x - (dx / len) * gap, ey: pb.y - (dy / len) * gap };
      };

      /** The faint, always-visible constellation figures (static sky layer). */
      const drawFigures = (g: CanvasRenderingContext2D) => {
        g.lineWidth = 1;
        g.strokeStyle = 'rgba(180,200,255,0.13)';
        for (const edges of this.edges) {
          for (const [a, b] of edges) {
            const { sx, sy, ex, ey } = segment(a, b);
            g.beginPath();
            g.moveTo(sx, sy);
            g.lineTo(ex, ey);
            g.stroke();
          }
        }
      };

      /** Traces the lit figures outward from the star being looked at. Returns whether a glow is still fading. */
      const drawGlow = (dt: number): boolean => {
        const lit = this.lit();
        const root = this.hovered() >= 0 ? this.hovered() : this.selected();
        let fading = false;
        this.constellations().forEach((c, k) => {
          const target = lit.has(c.kind) ? 1 : 0;
          let g = glow.get(c.kind) ?? 0;
          g = reduced ? target : g + (target - g) * Math.min(1, dt / (target ? 520 : 260));
          if (Math.abs(target - g) < 0.002) g = target;
          else fading = true;
          glow.set(c.kind, g);
          const edges = this.edges[k] ?? [];
          if (!edges.length || g <= 0) return;
          // Order the figure outward from the star being looked at.
          const start = c.stars.includes(root) ? root : c.stars[0]!;
          const depthOf = new Map<number, number>([[start, 0]]);
          const queue = [start];
          const ordered: { a: number; b: number; level: number }[] = [];
          while (queue.length) {
            const a = queue.shift()!;
            for (const [x, y] of edges) {
              const b = x === a ? y : y === a ? x : -1;
              if (b < 0 || depthOf.has(b)) continue;
              depthOf.set(b, depthOf.get(a)! + 1);
              ordered.push({ a, b, level: depthOf.get(a)! });
              queue.push(b);
            }
          }
          const levels = Math.max(1, ...ordered.map((o) => o.level + 1));
          for (const { a, b, level } of ordered) {
            const f = clamp(g * levels - level, 0, 1);
            if (f <= 0) continue;
            const { sx, sy, ex, ey } = segment(a, b);
            const alpha = 0.85 * Math.min(1, g * 1.5);
            const tx = sx + (ex - sx) * f;
            const ty = sy + (ey - sy) * f;
            // The glow was a 10px canvas shadow blur, re-blurred every frame (the costliest draw here).
            // Stacked translucent strokes trace the same falloff (within ~3/255) at a fraction of the cost.
            ctx.lineCap = 'round';
            for (const [width, k] of GLOW_HALO) {
              ctx.lineWidth = width / dpr;
              ctx.strokeStyle = `rgba(150,185,255,${(alpha * k * dpr).toFixed(4)})`;
              ctx.beginPath();
              ctx.moveTo(sx, sy);
              ctx.lineTo(tx, ty);
              ctx.stroke();
            }
            ctx.lineCap = 'butt';
            ctx.lineWidth = 1.4;
            ctx.strokeStyle = `rgba(215,228,255,${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(tx, ty);
            ctx.stroke();
          }
        });
        return fading;
      };

      const drawNamed = (t: number) => {
        const hovered = this.hovered();
        const selected = this.selected();
        projects.forEach((p, i) => {
          const pt = project(this.pos[i]!, 1, tmp);
          const focus = i === hovered || i === selected;
          const tw = reduced ? 1 : 0.88 + 0.12 * Math.sin(t * 0.0017 + i * 1.7);
          const size = (focus ? 92 : 64) * tw * (0.9 + 0.1 * this.cam.s);
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(sprites[i]!, pt.x - size / 2, pt.y - size / 2, size, size);
          const spike = spikes[i]![focus ? 1 : 0]!;
          const reach = spike.half * tw;
          ctx.drawImage(spike.canvas, pt.x - reach, pt.y - reach, reach * 2, reach * 2);
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, focus ? 2.6 : 2, 0, Math.PI * 2);
          ctx.fill();
        });
      };

      const drawMeteors = (now: number, dt: number) => {
        if (reduced) return;
        if (now > nextMeteor && this.selected() < 0) {
          nextMeteor = now + 5000 + rand() * 9000;
          const angle = (Math.PI / 180) * (18 + rand() * 22) * (rand() < 0.5 ? 1 : -1);
          const speed = 0.9 + rand() * 0.6;
          const dir = angle > 0 ? 1 : -1;
          meteors.push({
            x: dir > 0 ? rand() * this.w * 0.5 : this.w * (0.5 + rand() * 0.5),
            y: rand() * this.h * 0.35,
            vx: Math.cos(Math.abs(angle)) * speed * dir,
            vy: Math.sin(Math.abs(angle)) * speed,
            life: 700 + rand() * 500,
            age: 0,
          });
        }
        for (let i = meteors.length - 1; i >= 0; i--) {
          const m = meteors[i]!;
          m.age += dt;
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          const k = m.age / m.life;
          if (k >= 1) {
            meteors.splice(i, 1);
            continue;
          }
          const alpha = Math.sin(k * Math.PI);
          const tail = 170;
          const len = Math.hypot(m.vx, m.vy);
          const grad = ctx.createLinearGradient(m.x, m.y, m.x - (m.vx / len) * tail, m.y - (m.vy / len) * tail);
          grad.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
          grad.addColorStop(1, 'rgba(160,190,255,0)');
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(m.x, m.y);
          ctx.lineTo(m.x - (m.vx / len) * tail, m.y - (m.vy / len) * tail);
          ctx.stroke();
        }
      };

      /** Move the HTML star buttons and constellation names over the canvas. */
      const placeOverlays = () => {
        const buttons = this.starButtons();
        buttons.forEach((b, i) => {
          const p = this.pos[i];
          if (!p) return;
          project(p, 1, tmp);
          b.nativeElement.style.transform = `translate3d(${tmp.x.toFixed(1)}px, ${tmp.y.toFixed(1)}px, 0)`;
        });
        const names = this.names();
        this.constellations().forEach((c, k) => {
          const el = names[k]?.nativeElement;
          if (!el) return;
          let x = 0;
          let maxY = -Infinity;
          for (const s of c.stars) {
            project(this.pos[s]!, 1, tmp);
            x += tmp.x;
            maxY = Math.max(maxY, tmp.y);
          }
          x /= c.stars.length;
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${(maxY + 44).toFixed(1)}px, 0) translateX(-50%)`;
        });
      };

      /**
       * The named stars glow additively ('lighter') over the sky. Copy the static sky under each of them
       * (pixel-exact, device space) so the glow adds onto the real background, exactly as when everything
       * was one canvas; elsewhere the front layer stays transparent.
       */
      const underlayNamed = () => {
        const R = Math.ceil(52 * dpr);
        const cw = canvas.width;
        const ch = canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        for (let i = 0; i < projects.length; i++) {
          project(this.pos[i]!, 1, tmp);
          const x0 = Math.max(0, Math.floor(tmp.x * dpr) - R);
          const y0 = Math.max(0, Math.floor(tmp.y * dpr) - R);
          const x1 = Math.min(cw, Math.floor(tmp.x * dpr) + R);
          const y1 = Math.min(ch, Math.floor(tmp.y * dpr) + R);
          if (x1 > x0 && y1 > y0) ctx.drawImage(backCanvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };

      /** The static sky: background, Milky Way, mid-depth stars and the faint figures. */
      const drawBack = (g: CanvasRenderingContext2D) => {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = '#03050d';
        g.fillRect(0, 0, this.w, this.h);
        if (far) {
          project({ x: -FAR_M, y: -FAR_M }, 0.1, tmp);
          const s = 1 + (this.cam.s - 1) * 0.1;
          g.drawImage(far, tmp.x, tmp.y, (this.w + FAR_M * 2) * s, (this.h + FAR_M * 2) * s);
        }
        drawField(g, mid, 0.35, 0, false);
        drawFigures(g);
      };
      /** Whether the static layer holds the current view (and is shown). */
      let backFresh = false;

      let frame = 0;
      let last = performance.now();
      let lastPaint = 0;
      let onScreen = false;
      /** View the static layer and the overlays were last drawn for. */
      const drawnView = { x: NaN, y: NaN, s: NaN, fx: NaN, fy: NaN, px: NaN, py: NaN };

      const render = (now: number) => {
        const dt = Math.min(64, now - last);
        last = now;
        // Camera glide.
        const tween = this.tween;
        if (tween) {
          const k = reduced ? 1 : clamp((now - tween.start) / tween.duration, 0, 1);
          const e = easeInOut(k);
          const lerp = (a: number, b: number) => a + (b - a) * e;
          this.cam = {
            x: lerp(tween.from.x, tween.to.x),
            y: lerp(tween.from.y, tween.to.y),
            s: lerp(tween.from.s, tween.to.s),
            fx: lerp(tween.from.fx, tween.to.fx),
            fy: lerp(tween.from.fy, tween.to.fy),
          };
          if (k >= 1) {
            this.tween = null;
            tween.done?.();
          }
        }
        const lerpP = reduced ? 1 : Math.min(1, dt / 500);
        pointer.x += (pointer.tx - pointer.x) * lerpP;
        pointer.y += (pointer.ty - pointer.y) * lerpP;
        // Snap the last sub-pixel of parallax so the static layer can come to rest.
        if (Math.abs(pointer.tx - pointer.x) < 0.004) pointer.x = pointer.tx;
        if (Math.abs(pointer.ty - pointer.y) < 0.004) pointer.y = pointer.ty;

        const c = this.cam;
        const d = drawnView;
        const moved =
          viewDirty ||
          c.x !== d.x ||
          c.y !== d.y ||
          c.s !== d.s ||
          c.fx !== d.fx ||
          c.fy !== d.fy ||
          pointer.x !== d.px ||
          pointer.y !== d.py;
        if (moved) {
          viewDirty = false;
          Object.assign(d, { x: c.x, y: c.y, s: c.s, fx: c.fx, fy: c.fy, px: pointer.x, py: pointer.y });
          placeOverlays();
          // In motion: paint the whole sky into the one canvas, as before; the static layer waits until it settles.
          if (backFresh) {
            backFresh = false;
            backCanvas.style.visibility = 'hidden';
          }
          drawBack(ctx);
        } else {
          // At rest: the static sky lives on its own canvas, this one only carries what changes.
          if (!backFresh) {
            drawBack(bctx);
            backFresh = true;
            backCanvas.style.visibility = '';
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, this.w, this.h);
          underlayNamed();
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawField(ctx, twinkle, 0.6, now, true);
        drawMeteors(now, dt);
        const fading = drawGlow(dt);
        drawNamed(now);
        busy = moved || fading || !!this.tween || meteors.length > 0 || pointer.x !== pointer.tx || pointer.y !== pointer.ty;
      };

      const loop = (now: number) => {
        frame = 0;
        // At rest only the slow twinkle changes: 30 fps is plenty for it.
        if (busy || now - lastPaint > 30) {
          lastPaint = now;
          render(now);
        }
        if (onScreen && !reduced && this.document.visibilityState === 'visible') frame = requestAnimationFrame(loop);
      };
      // Reduced motion: no loop; repaint on demand (tween resolves instantly).
      this.request = () => {
        busy = true;
        if (frame) return;
        if (reduced) {
          frame = requestAnimationFrame((now) => {
            frame = 0;
            render(now);
          });
        } else if (onScreen) {
          last = performance.now();
          frame = requestAnimationFrame(loop);
        }
      };

      this.glideTo = (target: 'overview' | number, done?: () => void) => {
        const to = target === 'overview' ? overview() : focusOn(target);
        this.tween = { from: { ...this.cam }, to, start: performance.now(), duration: reduced ? 0 : 1300, done };
        this.request();
      };

      const onPointer = (event: PointerEvent) => {
        if (event.pointerType !== 'mouse') return;
        const box = sky.getBoundingClientRect();
        pointer.tx = ((event.clientX - box.left) / box.width) * 2 - 1;
        pointer.ty = ((event.clientY - box.top) / box.height) * 2 - 1;
        busy = true;
        if (reduced) {
          pointer.tx = pointer.ty = 0;
        }
      };
      const onLeave = () => {
        pointer.tx = pointer.ty = 0;
        busy = true;
      };
      sky.addEventListener('pointermove', onPointer);
      sky.addEventListener('pointerleave', onLeave);

      const io = new IntersectionObserver(([entry]) => {
        onScreen = !!entry?.isIntersecting;
        this.visible.set(onScreen);
        if (onScreen) this.request();
      });
      io.observe(sky);
      const onVisibility = () => this.request();
      this.document.addEventListener('visibilitychange', onVisibility);
      const ro = new ResizeObserver(() => resize());
      ro.observe(sky);
      resize();

      cleanup = () => {
        cancelAnimationFrame(frame);
        io.disconnect();
        ro.disconnect();
        sky.removeEventListener('pointermove', onPointer);
        sky.removeEventListener('pointerleave', onLeave);
        this.document.removeEventListener('visibilitychange', onVisibility);
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }

  private glideTo: (target: 'overview' | number, done?: () => void) => void = () => {};
  private lensTimer = 0;

  protected hover(index: number): void {
    this.hovered.set(index);
    this.request();
  }

  protected onStar(index: number): void {
    if (index === this.selected() && this.lensOpen()) {
      this.open();
      return;
    }
    this.observe(index);
  }

  protected observe(index: number): void {
    const view = this.document.defaultView;
    view?.clearTimeout(this.lensTimer);
    const switching = this.lensOpen();
    this.lensOpen.set(false);
    const go = () => {
      this.selected.set(index);
      this.glideTo(index, () => this.lensOpen.set(true));
    };
    if (switching && !this.reduced && view) this.lensTimer = view.setTimeout(go, 360);
    else go();
  }

  protected close(): void {
    const index = this.selected();
    if (index < 0) return;
    const view = this.document.defaultView;
    view?.clearTimeout(this.lensTimer);
    this.lensOpen.set(false);
    const back = () =>
      this.glideTo('overview', () => {
        if (!this.lensOpen()) this.selected.set(-1);
      });
    if (this.reduced || !view) back();
    else this.lensTimer = view.setTimeout(back, 320);
    this.sky()
      .nativeElement.querySelector<HTMLElement>(`button.star[data-project="${index}"]`)
      ?.focus({ preventScroll: true });
  }

  protected open(): void {
    const index = this.selected();
    if (index < 0) return;
    const media = this.sky().nativeElement.querySelector<HTMLElement>('.lens app-project-media');
    this.openCase.emit({ index, media });
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.selected() >= 0) {
        event.preventDefault();
        this.close();
      }
      return;
    }
    const dirs: Record<string, Vec> = {
      ArrowRight: { x: 1, y: 0 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowDown: { x: 0, y: 1 },
      ArrowUp: { x: 0, y: -1 },
    };
    const dir = dirs[event.key];
    if (!dir) return;
    const target = event.target as HTMLElement | null;
    const from = Number(target?.closest('button.star')?.getAttribute('data-project') ?? -1);
    if (from < 0) return;
    event.preventDefault();
    const origin = this.pos[from];
    if (!origin) return;
    let best = -1;
    let bestScore = Infinity;
    this.pos.forEach((p, i) => {
      if (i === from) return;
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      const d = Math.hypot(dx, dy) || 1;
      const cos = (dx * dir.x + dy * dir.y) / d;
      if (cos <= 0.2) return;
      const score = d * (1 + 2.2 * (1 - cos));
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) {
      // Nothing that way: wrap around in index order.
      const n = this.projects().length;
      best = (from + (dir.x + dir.y > 0 ? 1 : -1) + n) % n;
    }
    this.sky()
      .nativeElement.querySelector<HTMLElement>(`button.star[data-project="${best}"]`)
      ?.focus({ preventScroll: true });
    if (this.selected() >= 0) this.observe(best);
  }

  protected onSkyClick(event: MouseEvent): void {
    if (event.target === this.canvas().nativeElement && this.selected() >= 0) this.close();
  }

  protected flipped(index: number): boolean {
    return this.flip()[index] ?? false;
  }
}
