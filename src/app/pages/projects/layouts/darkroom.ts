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
import { OpenCase, pad, prefersReducedMotion } from './shared';

type PrintState = 'blank' | 'busy' | 'developed';

/** A clothesline: a verlet rope between two wall hooks. */
interface Rope {
  readonly n: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly px: Float64Array;
  readonly py: Float64Array;
  /** Extra weight hanging from a point (a pegged print), in rope-point masses. */
  readonly load: Float64Array;
  readonly seg: number;
  readonly path: SVGPathElement;
  readonly shadow: SVGPathElement;
  readonly hit: SVGPathElement;
}

/** Where a print is while it is off the line: top-centre position, rotation, scale, tilt into the tray. */
interface Pose {
  x: number;
  y: number;
  rot: number;
  scale: number;
  rx: number;
}

interface Step {
  readonly dur: number;
  readonly to: (now: number) => Pose;
  readonly ease: (t: number) => number;
  readonly arc?: number;
  /** In a tray: liquid tint over the print. */
  readonly bath?: boolean;
  /** The latent image comes up during this step. */
  readonly develop?: boolean;
  readonly start?: () => void;
  readonly end?: () => void;
}

interface Flight {
  readonly steps: Step[];
  i: number;
  t0: number;
  from: Pose;
}

interface Hang {
  readonly index: number;
  readonly el: HTMLElement;
  readonly peg: HTMLElement;
  readonly photo: HTMLElement;
  rope: Rope | null;
  node: number;
  w: number;
  h: number;
  /** In-plane swing around the peg (rad) and its velocity. */
  theta: number;
  omega: number;
  /** Out-of-plane flutter (rad). */
  phi: number;
  phiV: number;
  lastVx: number;
  lastVy: number;
  flight: Flight | null;
  pose: Pose;
  wetUntil: number;
  nextDrip: number;
}

interface Ripple {
  x: number;
  y: number;
  t0: number;
  strength: number;
}

interface Tray {
  readonly el: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D | null;
  readonly ripples: Ripple[];
  /** Agitation (rocking the tray) until this time. */
  rockUntil: number;
  w: number;
  h: number;
}

const GRAVITY = 1700;
const STEP = 1 / 120;
const glide = (t: number) => 1 - Math.pow(1 - t, 4);
const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const TRAYS = [
  { id: 'dev', name: 'Developer', short: 'DEV', liquid: [58, 44, 32] },
  { id: 'stop', name: 'Stop bath', short: 'STOP', liquid: [214, 168, 70] },
  { id: 'fix', name: 'Fixer', short: 'FIX', liquid: [196, 214, 208] },
] as const;

/**
 * Experimental layout — a darkroom under red safelight. Prints hang blank on a
 * sagging clothesline (a verlet rope you can tug); choosing one drops it through
 * developer, stop and fix, then pegs it back developed and dripping.
 */
@Component({
  selector: 'app-projects-darkroom',
  imports: [ProjectMediaView],
  templateUrl: './darkroom.html',
  styleUrl: './darkroom.css',
})
export class ProjectsDarkroom {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly trays = TRAYS;
  protected readonly lightsOn = signal(false);
  protected readonly inView = signal(false);
  protected readonly states = signal<readonly PrintState[]>([]);
  /** Most recently developed / looked-at prints, newest first (≤ 3 play). */
  protected readonly playing = signal<readonly number[]>([]);
  protected readonly announce = signal('');
  protected readonly running = signal(false);
  protected readonly developedCount = computed(
    () => this.states().filter((s) => s === 'developed').length,
  );
  protected readonly blankCount = computed(() => this.states().filter((s) => s === 'blank').length);

  private readonly document = inject(DOCUMENT);
  private readonly roomRef = viewChild.required<ElementRef<HTMLElement>>('room');
  protected readonly reduced = prefersReducedMotion(this.document.defaultView);
  private hangs: Hang[] = [];
  private suppressClick = false;
  private develop: (index: number, quick: boolean) => void = () => {};
  private kick: (index: number, dir: number) => void = () => {};

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      const room = this.roomRef().nativeElement;
      if (!view) return;
      const doc = this.document;
      const reduced = this.reduced;
      const svg = room.querySelector<SVGSVGElement>('.lines')!;
      const shadowsG = svg.querySelector<SVGGElement>('.line-shadows')!;
      const cordsG = svg.querySelector<SVGGElement>('.line-cords')!;
      const hitsG = svg.querySelector<SVGGElement>('.line-hits')!;
      const spacer = room.querySelector<HTMLElement>('.spacer')!;
      const drips = room.querySelector<HTMLElement>('.drips')!;
      const timer = room.querySelector<HTMLElement>('.timer-digits');
      const printEls = Array.from(room.querySelectorAll<HTMLElement>('.print'));
      const pegEls = Array.from(room.querySelectorAll<HTMLElement>('.peg'));
      const projects = this.projects();
      this.states.set(projects.map(() => 'blank'));

      const trays: Tray[] = Array.from(room.querySelectorAll<HTMLElement>('.tray')).map((el) => {
        const canvas = el.querySelector('canvas')!;
        return { el, canvas, ctx: canvas.getContext('2d'), ripples: [], rockUntil: 0, w: 0, h: 0 };
      });

      this.hangs = printEls.map((el, index) => ({
        index,
        el,
        peg: pegEls[index]!,
        photo: el.querySelector<HTMLElement>('.photo')!,
        rope: null,
        node: 0,
        w: 0,
        h: 0,
        theta: 0,
        omega: 0,
        phi: 0,
        phiV: 0,
        lastVx: 0,
        lastVy: 0,
        flight: null,
        pose: { x: 0, y: 0, rot: 0, scale: 1, rx: 0 },
        wetUntil: 0,
        nextDrip: 0,
      }));
      const hangs = this.hangs;
      let ropes: Rope[] = [];
      let width = 0;
      let height = 0;
      let mobile = false;
      let zTop = 40;
      let pinned: { rope: Rope; node: number; x: number; y: number } | null = null;

      // Elements created here need the component's style scope attribute.
      const scope = Array.from(room.attributes).find((a) => a.name.startsWith('_ngcontent'))?.name;
      const svgEl = (name: string, cls: string, parent: SVGGElement) => {
        const el = doc.createElementNS('http://www.w3.org/2000/svg', name) as SVGPathElement;
        el.setAttribute('class', cls);
        if (scope) el.setAttribute(scope, '');
        parent.appendChild(el);
        return el;
      };

      // ---------- layout: rows of prints on one or more lines ----------
      const layout = () => {
        width = room.clientWidth;
        mobile = width < 700;
        const n = hangs.length;
        const margin = mobile ? 18 : clamp(width * 0.07, 40, 130);
        const span = width - margin * 2;
        let perRow = clamp(Math.floor(span / (mobile ? 160 : 245)), 1, Math.max(1, n));
        const rows = Math.max(1, Math.ceil(n / perRow));
        perRow = Math.ceil(n / rows);
        const slot = span / perRow;
        const baseW = mobile ? Math.min(150, slot * 0.84) : Math.min(180, slot * 0.66);

        shadowsG.replaceChildren();
        cordsG.replaceChildren();
        hitsG.replaceChildren();
        ropes = [];
        let top = mobile ? 124 : 116;
        for (let r = 0; r < rows; r++) {
          const members = hangs.slice(r * perRow, (r + 1) * perRow);
          let tallest = 0;
          for (const h of members) {
            const shape = projects[h.index]?.media.shape;
            const w = shape === 'portrait' ? baseW * 0.8 : baseW;
            const b = Math.round(w * 0.065);
            const photoW = w - b * 2;
            const photoH = photoW * (shape === 'portrait' ? 4 / 3 : shape === 'wide' ? 10 / 16 : 3 / 4);
            h.w = Math.round(w);
            h.h = Math.round(photoH + b + Math.max(24, b * 3.4));
            h.el.style.width = `${h.w}px`;
            h.el.style.height = `${h.h}px`;
            h.el.style.setProperty('--b', `${b}px`);
            h.el.style.setProperty('--ph', `${photoH.toFixed(1)}px`);
            tallest = Math.max(tallest, h.h);
          }
          const x0 = mobile ? 8 : margin * 0.45;
          const x1 = width - x0;
          const count = members.length * 8 + 1;
          const rope: Rope = {
            n: count,
            x: new Float64Array(count),
            y: new Float64Array(count),
            px: new Float64Array(count),
            py: new Float64Array(count),
            load: new Float64Array(count),
            seg: ((x1 - x0) * (mobile ? 1.008 : 1.0025)) / (count - 1),
            shadow: svgEl('path', 'line-shadow', shadowsG),
            path: svgEl('path', 'line-cord', cordsG),
            hit: svgEl('path', 'line-hit', hitsG),
          };
          for (let i = 0; i < count; i++) {
            const t = i / (count - 1);
            rope.x[i] = rope.px[i] = x0 + (x1 - x0) * t;
            rope.y[i] = rope.py[i] = top + Math.sin(Math.PI * t) * 30;
          }
          // Spread this row's prints across the line (centred if the row is short).
          const rowSpan = slot * members.length;
          const start = (width - rowSpan) / 2;
          members.forEach((h, k) => {
            const cx = start + slot * (k + 0.5);
            h.rope = rope;
            h.node = clamp(Math.round(((cx - x0) / (x1 - x0)) * (count - 1)), 1, count - 2);
            if (!h.flight) rope.load[h.node] = 3;
          });
          ropes.push(rope);
          top += tallest + 70;
        }
        // Let the lines settle under the prints' weight before anyone sees them.
        for (let i = 0; i < 700; i++) simulate(STEP, 0, false);
        let lowest = top;
        for (const h of hangs) if (h.rope) lowest = Math.max(lowest, h.rope.y[h.node]! + h.h);
        spacer.style.height = `${Math.round(lowest + (mobile ? 26 : 30))}px`;
        height = room.clientHeight;
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.style.height = `${height}px`;
        for (const h of hangs) {
          h.theta = h.rope ? slopeAt(h.rope, h.node) * 0.32 : 0;
          h.omega = 0;
        }
        sizeTrays();
        render(0);
      };

      const sizeTrays = () => {
        const dpr = Math.min(2, view.devicePixelRatio || 1);
        for (const tray of trays) {
          const w = tray.canvas.clientWidth;
          const h = tray.canvas.clientHeight;
          if (!w || !h) continue;
          tray.w = w;
          tray.h = h;
          tray.canvas.width = Math.round(w * dpr);
          tray.canvas.height = Math.round(h * dpr);
          tray.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
      };

      const slopeAt = (rope: Rope, i: number) =>
        Math.atan2(rope.y[i + 1]! - rope.y[i - 1]!, rope.x[i + 1]! - rope.x[i - 1]!);

      // ---------- physics ----------
      const simulate = (dt: number, t: number, breeze: boolean) => {
        const dt2 = dt * dt;
        for (const rope of ropes) {
          const { x, y, px, py, load, n } = rope;
          for (let i = 1; i < n - 1; i++) {
            if (pinned && pinned.rope === rope && pinned.node === i) {
              px[i] = x[i]!;
              py[i] = y[i]!;
              x[i] = x[i]! + (pinned.x - x[i]!) * 0.5;
              y[i] = y[i]! + (pinned.y - y[i]!) * 0.5;
              continue;
            }
            const vx = (x[i]! - px[i]!) * 0.993;
            const vy = (y[i]! - py[i]!) * 0.993;
            px[i] = x[i]!;
            py[i] = y[i]!;
            const wind = breeze
              ? (Math.sin(t * 0.83 + x[i]! * 0.005) * 0.6 + Math.sin(t * 1.9 + x[i]! * 0.011) * 0.4) * 46
              : 0;
            x[i] = x[i]! + vx + wind * dt2;
            y[i] = y[i]! + vy + GRAVITY * (1 + load[i]!) * dt2;
          }
          for (let k = 0; k < 48; k++) {
            for (let i = 0; i < n - 1; i++) {
              const dx = x[i + 1]! - x[i]!;
              const dy = y[i + 1]! - y[i]!;
              const d = Math.hypot(dx, dy);
              if (d <= rope.seg) continue;
              const wa = i === 0 || (pinned?.rope === rope && pinned.node === i) ? 0 : 1 / (1 + load[i]!);
              const wb =
                i + 1 === n - 1 || (pinned?.rope === rope && pinned.node === i + 1) ? 0 : 1 / (1 + load[i + 1]!);
              const sum = wa + wb;
              if (!sum) continue;
              const diff = (d - rope.seg) / d / sum;
              x[i] = x[i]! + dx * diff * wa;
              y[i] = y[i]! + dy * diff * wa;
              x[i + 1] = x[i + 1]! - dx * diff * wb;
              y[i + 1] = y[i + 1]! - dy * diff * wb;
            }
          }
        }
        for (const h of hangs) {
          const rope = h.rope;
          if (!rope || h.flight) continue;
          const i = h.node;
          const vx = (rope.x[i]! - rope.px[i]!) / dt;
          const vy = (rope.y[i]! - rope.py[i]!) / dt;
          const ax = clamp((vx - h.lastVx) / dt, -9000, 9000);
          const ay = clamp((vy - h.lastVy) / dt, -9000, 9000);
          h.lastVx = vx;
          h.lastVy = vy;
          const slope = slopeAt(rope, i);
          const gust = breeze ? Math.sin(t * 1.3 + h.index * 1.7) * 0.35 : 0;
          const alpha = -34 * (h.theta - slope * 0.32) - 1.5 * h.omega - ax * 0.0021 + gust;
          h.omega += alpha * dt;
          h.theta += h.omega * dt;
          const beta = -48 * h.phi - 2.6 * h.phiV + ay * 0.0007 + (breeze ? Math.sin(t * 2.1 + h.index) * 0.5 : 0);
          h.phiV += beta * dt;
          h.phi = clamp(h.phi + h.phiV * dt, -0.6, 0.6);
        }
      };

      // ---------- rendering ----------
      const ropePath = (rope: Rope) => {
        const { x, y, n } = rope;
        let d = `M${x[0]!.toFixed(1)} ${y[0]!.toFixed(1)}`;
        for (let i = 1; i < n - 1; i++) {
          const mx = (x[i]! + x[i + 1]!) / 2;
          const my = (y[i]! + y[i + 1]!) / 2;
          d += `Q${x[i]!.toFixed(1)} ${y[i]!.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
        }
        return d + `L${x[n - 1]!.toFixed(1)} ${y[n - 1]!.toFixed(1)}`;
      };

      const place = (h: Hang, p: Pose) => {
        h.el.style.transform = `translate3d(${(p.x - h.w / 2).toFixed(2)}px, ${(p.y + 2).toFixed(2)}px, 0) perspective(900px) rotate(${p.rot.toFixed(2)}deg) rotateX(${p.rx.toFixed(2)}deg) scale(${p.scale.toFixed(3)})`;
      };

      const pegPose = (h: Hang): Pose => {
        const rope = h.rope!;
        return { x: rope.x[h.node]!, y: rope.y[h.node]!, rot: (h.theta * 180) / Math.PI, scale: 1, rx: (h.phi * 180) / Math.PI };
      };

      const render = (now: number) => {
        for (const rope of ropes) {
          const d = ropePath(rope);
          rope.path.setAttribute('d', d);
          rope.shadow.setAttribute('d', d);
          rope.hit.setAttribute('d', d);
        }
        for (const h of hangs) {
          const rope = h.rope;
          if (!rope) continue;
          const nx = rope.x[h.node]!;
          const ny = rope.y[h.node]!;
          const pegRot = h.flight ? slopeAt(rope, h.node) : h.theta;
          h.peg.style.transform = `translate3d(${nx.toFixed(2)}px, ${ny.toFixed(2)}px, 0) rotate(${pegRot.toFixed(4)}rad)`;
          if (h.flight) {
            place(h, h.pose);
          } else {
            h.pose = pegPose(h);
            place(h, h.pose);
          }
          // Drips from fresh prints.
          if (!reduced && h.wetUntil > now && now > h.nextDrip) {
            const wet = (h.wetUntil - now) / 7000;
            h.nextDrip = now + 260 + Math.random() * 700 + (1 - wet) * 900;
            const p = h.pose;
            const a = (p.rot * Math.PI) / 180;
            const off = (Math.random() - 0.5) * h.w * 0.7 * p.scale;
            const down = h.h * p.scale * Math.cos((p.rx * Math.PI) / 180);
            const dx = p.x + off * Math.cos(a) - down * Math.sin(a);
            const dy = p.y + off * Math.sin(a) + down * Math.cos(a);
            const drip = doc.createElement('i');
            drip.className = 'drip';
            if (scope) drip.setAttribute(scope, '');
            drip.style.left = `${dx.toFixed(1)}px`;
            drip.style.top = `${dy.toFixed(1)}px`;
            drip.style.setProperty('--fall', `${Math.round(90 + Math.random() * 120)}px`);
            drip.addEventListener('animationend', () => drip.remove(), { once: true });
            drips.appendChild(drip);
          }
        }
      };

      // ---------- trays: liquid with ripples ----------
      const drawTrays = (now: number) => {
        TRAYS.forEach((def, k) => {
          const tray = trays[k];
          const ctx = tray?.ctx;
          if (!tray || !ctx || !tray.w) return;
          const { w, h } = tray;
          const rock = tray.rockUntil > now ? Math.sin(now * 0.0062) * Math.min(1, (tray.rockUntil - now) / 600) : 0;
          ctx.clearRect(0, 0, w, h);
          const [r, g, b] = def.liquid;
          const base = ctx.createLinearGradient(0, 0, 0, h);
          base.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.82)`);
          base.addColorStop(1, `rgba(${r * 0.55}, ${g * 0.55}, ${b * 0.55}, 0.9)`);
          ctx.fillStyle = base;
          ctx.fillRect(0, 0, w, h);
          // Reflection of the lamp sliding as the liquid sloshes.
          const hx = w * (0.32 + rock * 0.12 + Math.sin(now * 0.0004 + k) * 0.03);
          const glow = ctx.createRadialGradient(hx, h * 0.3, 0, hx, h * 0.3, w * 0.38);
          glow.addColorStop(0, 'rgba(255, 245, 235, 0.42)');
          glow.addColorStop(1, 'rgba(255, 245, 235, 0)');
          ctx.fillStyle = glow;
          ctx.save();
          ctx.translate(0, 0);
          ctx.scale(1, 0.42);
          ctx.fillRect(0, 0, w, h / 0.42);
          ctx.restore();
          // A slosh line when the tray is rocked.
          if (rock) {
            ctx.strokeStyle = `rgba(255, 240, 230, ${0.22 * Math.abs(rock)})`;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            const sx = rock > 0 ? w * (0.9 - Math.abs(rock) * 0.2) : w * (0.1 + Math.abs(rock) * 0.2);
            ctx.moveTo(sx, 2);
            ctx.quadraticCurveTo(sx + rock * 10, h / 2, sx, h - 2);
            ctx.stroke();
          }
          for (let i = tray.ripples.length - 1; i >= 0; i--) {
            const rp = tray.ripples[i]!;
            const age = (now - rp.t0) / 1000;
            if (age > 2.2) {
              tray.ripples.splice(i, 1);
              continue;
            }
            for (let ring = 0; ring < 3; ring++) {
              const ra = age - ring * 0.16;
              if (ra <= 0) continue;
              const rad = ra * w * 0.32 * rp.strength + 2;
              const alpha = Math.max(0, 0.55 * rp.strength * (1 - ra / 2)) * (1 - ring * 0.28);
              ctx.strokeStyle = `rgba(255, 246, 238, ${alpha.toFixed(3)})`;
              ctx.lineWidth = 1.6 - ring * 0.35;
              ctx.beginPath();
              ctx.ellipse(rp.x * w, rp.y * h, rad, rad * 0.4, 0, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
        });
      };

      const ripple = (k: number, x = 0.5, y = 0.5, strength = 1) => {
        const tray = trays[k];
        if (!tray || reduced) return;
        tray.ripples.push({ x, y, t0: view.performance.now(), strength });
        if (tray.ripples.length > 14) tray.ripples.shift();
      };

      // ---------- the develop sequence ----------
      const liquidRect = (k: number) => {
        const rr = room.getBoundingClientRect();
        const r = trays[k]!.canvas.getBoundingClientRect();
        return { x: r.left - rr.left, y: r.top - rr.top, w: r.width, h: r.height };
      };

      const setPhoto = (h: Hang, d: number) => {
        const opacity = smooth(0.04, 0.7, d);
        const sepia = 1 - smooth(0.5, 1, d);
        const contrast = 0.32 + 0.7 * smooth(0.15, 1, d);
        const bright = 1.75 - 0.75 * smooth(0, 1, d);
        const blur = (1 - smooth(0.2, 0.9, d)) * 1.4;
        h.photo.style.opacity = opacity.toFixed(3);
        h.photo.style.filter = `sepia(${sepia.toFixed(3)}) contrast(${contrast.toFixed(3)}) brightness(${bright.toFixed(3)}) blur(${blur.toFixed(2)}px)`;
      };

      const setState = (index: number, state: PrintState) =>
        this.states.update((all) => all.map((s, i) => (i === index ? state : s)));

      const bump = (index: number) =>
        this.playing.update((list) => [index, ...list.filter((i) => i !== index)].slice(0, 3));

      let activeDevelops = 0;
      let devStart = 0;

      this.develop = (index: number, quick: boolean) => {
        const h = hangs[index];
        const rope = h?.rope;
        if (!h || !rope || this.states()[index] !== 'blank') return;
        const name = projects[index]?.name ?? '';
        setState(index, 'busy');
        this.announce.set(`Developing ${name}…`);
        if (reduced) {
          setState(index, 'developed');
          bump(index);
          this.announce.set(`${name} developed.`);
          return;
        }
        const k = quick ? 0.5 : 1;
        const slot = activeDevelops++ % 3;
        const offset = (slot - 1) * 0.2 + (Math.random() - 0.5) * 0.06;
        const trayRot = (Math.random() - 0.5) * 10;
        const trayPose = (t: number, bob = 0) => (): Pose => {
          const r = liquidRect(t);
          const rx = 58;
          const s = Math.min((r.w * 0.56) / h.w, (r.h * 0.86) / (h.h * Math.cos((rx * Math.PI) / 180)));
          return {
            x: r.x + r.w * (0.5 + offset),
            y: r.y + r.h / 2 - (h.h * s * Math.cos((rx * Math.PI) / 180)) / 2 + Math.sin(view.performance.now() * 0.006) * bob,
            rot: trayRot,
            scale: s,
            rx,
          };
        };
        const lift = (): Pose => {
          const p = pegPose(h);
          return { x: p.x, y: p.y - 26, rot: 0, scale: 1.03, rx: -6 };
        };
        h.el.style.zIndex = String(++zTop);
        h.el.classList.add('is-flying');
        const steps: Step[] = [
          {
            dur: 300 * k,
            to: lift,
            ease: glide,
            start: () => {
              rope.load[h.node] = 0;
              h.peg.classList.add('is-open');
            },
          },
          { dur: 700 * k, to: trayPose(0), ease: inOut, arc: 60, end: () => ripple(0, 0.5 + offset, 0.5, 1.2) },
          {
            dur: quick ? 800 : 2000,
            to: trayPose(0, 1.5),
            ease: (t) => t,
            bath: true,
            develop: true,
            start: () => {
              trays[0]!.rockUntil = view.performance.now() + (quick ? 800 : 2000);
              devStart = view.performance.now();
            },
          },
          { dur: 380 * k, to: trayPose(1), ease: inOut, arc: 46, end: () => ripple(1, 0.5 + offset, 0.5, 0.9) },
          { dur: 240 * k, to: trayPose(1, 1), ease: (t) => t, bath: true },
          { dur: 380 * k, to: trayPose(2), ease: inOut, arc: 46, end: () => ripple(2, 0.5 + offset, 0.5, 0.9) },
          { dur: 280 * k, to: trayPose(2, 1), ease: (t) => t, bath: true },
          {
            dur: 900 * k,
            to: () => pegPose(h),
            ease: glide,
            arc: 70,
            start: () => {
              h.wetUntil = view.performance.now() + 7000;
              h.el.classList.add('is-wet');
              ripple(2, 0.5 + offset, 0.5, 0.7);
            },
          },
        ];
        h.flight = { steps, i: 0, t0: view.performance.now(), from: { ...h.pose } };
        steps[0]!.start?.();
        wake();
      };

      const land = (h: Hang) => {
        const rope = h.rope!;
        h.flight = null;
        h.el.style.zIndex = '';
        h.el.classList.remove('is-flying', 'is-bath');
        h.peg.classList.remove('is-open');
        rope.load[h.node] = 3;
        rope.py[h.node] = rope.y[h.node]! - 5;
        h.theta = slopeAt(rope, h.node) * 0.32;
        h.omega = (Math.random() < 0.5 ? -1 : 1) * 1.6;
        h.phiV = 1.2;
        h.lastVx = h.lastVy = 0;
        activeDevelops = Math.max(0, activeDevelops - 1);
        setPhoto(h, 1);
        setState(h.index, 'developed');
        bump(h.index);
        this.announce.set(`${projects[h.index]?.name ?? ''} developed. Press again to open it.`);
        view.setTimeout(() => h.el.classList.remove('is-wet'), 7000);
      };

      const fly = (h: Hang, now: number) => {
        const f = h.flight!;
        const step = f.steps[f.i]!;
        const p = clamp((now - f.t0) / step.dur, 0, 1);
        const e = step.ease(p);
        const to = step.to(now);
        h.pose = {
          x: f.from.x + (to.x - f.from.x) * e,
          y: f.from.y + (to.y - f.from.y) * e - (step.arc ?? 0) * Math.sin(Math.PI * p),
          rot: f.from.rot + (to.rot - f.from.rot) * e,
          scale: f.from.scale + (to.scale - f.from.scale) * e,
          rx: f.from.rx + (to.rx - f.from.rx) * e,
        };
        h.el.classList.toggle('is-bath', !!step.bath);
        if (step.develop) {
          setPhoto(h, p);
          if (timer) timer.textContent = ((now - devStart) / 1000).toFixed(1).padStart(4, '0');
          if (Math.random() < 0.03) ripple(0, 0.15 + Math.random() * 0.7, 0.2 + Math.random() * 0.6, 0.35);
        }
        if (p >= 1) {
          step.end?.();
          f.i++;
          f.from = { ...h.pose };
          f.t0 = now;
          if (f.i >= f.steps.length) land(h);
          else f.steps[f.i]!.start?.();
        }
      };

      this.kick = (index: number, dir: number) => {
        const h = hangs[index];
        if (!h?.rope || h.flight || reduced) return;
        h.rope.px[h.node] = h.rope.x[h.node]! - dir * 7;
        wake();
      };

      // ---------- loop ----------
      let frame = 0;
      let last = 0;
      let acc = 0;
      let running = false;
      const loop = (now: number) => {
        frame = 0;
        if (!running) return;
        const dt = Math.min(0.05, (now - last) / 1000 || STEP);
        last = now;
        acc += dt;
        const t = now / 1000;
        while (acc >= STEP) {
          simulate(STEP, t, true);
          acc -= STEP;
        }
        for (const h of hangs) if (h.flight) fly(h, now);
        render(now);
        drawTrays(now);
        frame = view.requestAnimationFrame(loop);
      };
      const wake = () => {
        if (reduced || !this.inView() || frame) return;
        running = true;
        last = view.performance.now();
        frame = view.requestAnimationFrame(loop);
      };
      const sleep = () => {
        running = false;
        view.cancelAnimationFrame(frame);
        frame = 0;
      };

      // ---------- pointer: tug the line or a print ----------
      let press: { id: number; x: number; y: number; index: number | null; dragging: boolean } | null = null;
      const local = (e: PointerEvent) => {
        const r = room.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      const nearestNode = (x: number, y: number) => {
        let best: { rope: Rope; node: number; d: number } | null = null;
        for (const rope of ropes) {
          for (let i = 1; i < rope.n - 1; i++) {
            const d = Math.hypot(rope.x[i]! - x, rope.y[i]! - y);
            if (!best || d < best.d) best = { rope, node: i, d };
          }
        }
        return best;
      };
      const onDown = (e: PointerEvent) => {
        if (reduced || e.button > 0) return;
        const target = e.target as Element;
        const paper = target.closest<HTMLElement>('.paper');
        const onLine = target.classList.contains('line-hit');
        if (!paper && !onLine) return;
        const index = paper ? printEls.indexOf(paper.closest('.print') as HTMLElement) : null;
        press = { id: e.pointerId, ...local(e), index, dragging: false };
        if (onLine) {
          const near = nearestNode(press.x, press.y);
          if (near) {
            pinned = { rope: near.rope, node: near.node, x: near.rope.x[near.node]!, y: near.rope.y[near.node]! };
            press.dragging = true;
            room.classList.add('is-tugging');
            wake();
          }
        }
      };
      const onMove = (e: PointerEvent) => {
        if (!press || e.pointerId !== press.id) return;
        const p = local(e);
        if (!press.dragging && Math.hypot(p.x - press.x, p.y - press.y) > 6 && press.index !== null) {
          const h = hangs[press.index];
          if (!h?.rope || h.flight) return;
          pinned = { rope: h.rope, node: h.node, x: h.rope.x[h.node]!, y: h.rope.y[h.node]! };
          press.dragging = true;
          this.suppressClick = true;
          room.classList.add('is-tugging');
        }
        if (press.dragging && pinned) {
          // Pull the grabbed point of the line with the pointer (with some give).
          const gx = pinned.rope.x[pinned.node]!;
          const gy = pinned.rope.y[pinned.node]!;
          const dx = p.x - press.x;
          const dy = p.y - press.y;
          press.x = p.x;
          press.y = p.y;
          let tx = clamp((pinned.x || gx) + dx, 10, width - 10);
          let ty = clamp((pinned.y || gy) + dy, 40, height - 60);
          // The line can't stretch: keep the grab point inside the ellipse its length allows.
          const r = pinned.rope;
          const ax = r.x[0]!, ay = r.y[0]!, bx = r.x[r.n - 1]!, by = r.y[r.n - 1]!;
          const total = r.seg * (r.n - 1);
          const fits = (x: number, y: number) => Math.hypot(x - ax, y - ay) + Math.hypot(x - bx, y - by) <= total;
          if (!fits(tx, ty)) {
            const cx = (ax + bx) / 2, cy = (ay + by) / 2;
            let lo = 0, hi = 1;
            for (let k = 0; k < 14; k++) {
              const mid = (lo + hi) / 2;
              if (fits(tx + (cx - tx) * mid, ty + (cy - ty) * mid)) hi = mid;
              else lo = mid;
            }
            tx += (cx - tx) * hi;
            ty += (cy - ty) * hi;
          }
          pinned.x = tx;
          pinned.y = ty;
        }
      };
      const onUp = (e: PointerEvent) => {
        if (!press || e.pointerId !== press.id) return;
        if (press.dragging) view.setTimeout(() => (this.suppressClick = false), 0);
        press = null;
        pinned = null;
        room.classList.remove('is-tugging');
      };
      room.addEventListener('pointerdown', onDown);
      view.addEventListener('pointermove', onMove, { passive: true });
      view.addEventListener('pointerup', onUp);
      view.addEventListener('pointercancel', onUp);

      // ---------- visibility & resize ----------
      const io = new IntersectionObserver(
        ([entry]) => {
          const visible = !!entry?.isIntersecting;
          this.inView.set(visible);
          if (visible) wake();
          else sleep();
        },
        { threshold: 0.05 },
      );
      io.observe(room);
      let lastWidth = 0;
      const ro = new ResizeObserver(() => {
        if (room.clientWidth === lastWidth) return;
        lastWidth = room.clientWidth;
        layout();
        drawTrays(view.performance.now());
      });
      ro.observe(room);
      layout();
      drawTrays(view.performance.now());

      cleanup = () => {
        sleep();
        io.disconnect();
        ro.disconnect();
        room.removeEventListener('pointerdown', onDown);
        view.removeEventListener('pointermove', onMove);
        view.removeEventListener('pointerup', onUp);
        view.removeEventListener('pointercancel', onUp);
      };
    });
    inject(DestroyRef).onDestroy(() => cleanup());
  }

  protected playFor(index: number): 'on' | 'off' {
    return this.inView() && this.states()[index] === 'developed' && this.playing().includes(index)
      ? 'on'
      : 'off';
  }

  protected label(project: SideProject, index: number): string {
    const state = this.states()[index] ?? 'blank';
    if (state === 'developed') return `${project.name}: ${project.tagline} Open case study.`;
    if (state === 'busy') return `${project.name}: developing…`;
    return `${project.name}: undeveloped print. Develop it.`;
  }

  protected activate(index: number, button: HTMLElement): void {
    if (this.suppressClick) return;
    const state = this.states()[index];
    if (state === 'blank') this.develop(index, false);
    else if (state === 'developed') {
      const print = button.closest('.print');
      this.openCase.emit({ index, media: print?.querySelector<HTMLElement>('app-project-media') ?? null });
    }
  }

  protected look(index: number): void {
    if (this.states()[index] !== 'developed') return;
    this.playing.update((list) => [index, ...list.filter((i) => i !== index)].slice(0, 3));
  }

  protected onKey(event: KeyboardEvent, index: number): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.kick(index, event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  protected developAll(): void {
    const blanks = this.states()
      .map((s, i) => (s === 'blank' ? i : -1))
      .filter((i) => i >= 0);
    if (!blanks.length) return;
    this.running.set(true);
    const view = this.document.defaultView;
    blanks.forEach((index, k) => {
      view?.setTimeout(() => this.develop(index, true), this.reduced ? 0 : k * 380);
    });
    view?.setTimeout(() => this.running.set(false), this.reduced ? 0 : blanks.length * 380 + 3600);
  }

  protected toggleLights(cord: HTMLElement): void {
    this.lightsOn.update((on) => !on);
    if (this.reduced) return;
    cord.classList.remove('is-pulled');
    void cord.offsetWidth;
    cord.classList.add('is-pulled');
  }
}
