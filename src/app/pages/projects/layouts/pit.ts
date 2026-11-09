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

/** A bubble in the pit: a circle with position, velocity, an easing radius and a jelly wobble. */
interface Body {
  readonly el: HTMLElement;
  readonly shell: HTMLElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Resting radius, current radius and the radius it eases towards. */
  base: number;
  r: number;
  goal: number;
  /** Rendered element radius (the largest it can grow to) — the transform only scales down. */
  box: number;
  /** Squash amount and its velocity, along `wobAngle`. */
  wob: number;
  wobV: number;
  wobAngle: number;
  held: boolean;
  /** Still falling in from above the pit (no ceiling yet). */
  entering: boolean;
}

/** Relative bubble sizes; the featured project is always the largest. */
const SIZES = [1, 0.9, 1.06, 0.94, 0.86, 1.02, 0.92, 0.98];
const GROW = 1.3;
const FEATURED = 1.42;

/**
 * Experimental layout — a ball pit of glossy project bubbles with simple 2D
 * physics: gravity, circle collisions, walls, damping and sleeping. Hover or
 * focus grows a bubble (it shoves its neighbours), drag to fling, shake to toss.
 */
@Component({
  selector: 'app-projects-pit',
  imports: [ProjectMediaView],
  templateUrl: './pit.html',
  styleUrl: './pit.css',
})
export class ProjectsPit {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;
  protected readonly inView = signal(false);
  protected readonly hovered = signal<number | null>(null);
  protected readonly focused = signal<number | null>(null);
  protected readonly held = signal<number | null>(null);
  protected readonly shaking = signal(false);
  protected readonly reduced = signal(false);

  protected readonly scale = computed(() =>
    this.projects().map((project, i) => (project.featured ? FEATURED : SIZES[i % SIZES.length]!)),
  );
  /** The largest bubble always plays. */
  protected readonly largest = computed(() => {
    const scale = this.scale();
    return scale.indexOf(Math.max(...scale));
  });
  protected readonly active = computed(() => this.held() ?? this.hovered() ?? this.focused());
  /** Shown under the pit: the bubble in hand, else the largest one. */
  protected readonly shown = computed(() => this.active() ?? this.largest());

  private readonly document = inject(DOCUMENT);
  private readonly pitRef = viewChild.required<ElementRef<HTMLElement>>('pit');
  private dragged = false;
  private wake: () => void = () => {};
  private toss: () => void = () => {};

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      const pit = this.pitRef().nativeElement;
      if (!view) return;
      const reduced = prefersReducedMotion(view);
      this.reduced.set(reduced);
      let width = pit.clientWidth;
      let height = pit.clientHeight;
      const scale = this.scale();

      const bodies: Body[] = Array.from(pit.querySelectorAll<HTMLElement>('.bubble')).map((el, i) => ({
        el,
        shell: el.querySelector<HTMLElement>('.shell')!,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        base: 0,
        r: 0,
        goal: 0,
        box: 0,
        wob: 0,
        wobV: 0,
        wobAngle: 0,
        held: false,
        entering: false,
      }));

      /** Size bubbles so they fill a share of the pit, never wider than it. */
      const size = () => {
        const fill = width < 640 ? 0.4 : 0.42;
        const sum = scale.reduce((acc, s) => acc + s * s, 0);
        let unit = Math.sqrt((fill * width * height) / (Math.PI * sum));
        unit = Math.min(unit, (Math.min(width, height) * 0.44) / (Math.max(...scale) * GROW));
        bodies.forEach((b, i) => {
          b.base = unit * scale[i]!;
          b.r = b.goal = b.base;
          b.box = b.base * (reduced ? 1 : GROW);
          b.el.style.width = b.el.style.height = `${(b.box * 2).toFixed(1)}px`;
          b.el.style.setProperty('--box', `${(b.box * 2).toFixed(1)}px`);
        });
      };
      size();

      const render = (b: Body) => {
        const s = b.r / b.box;
        b.el.style.transform = `translate3d(${(b.x - b.box).toFixed(2)}px, ${(b.y - b.box).toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
        if (Math.abs(b.wob) > 0.001) {
          const a = b.wobAngle.toFixed(1);
          b.shell.style.transform = `rotate(${a}deg) scale(${(1 + b.wob).toFixed(4)}, ${(1 - b.wob * 0.8).toFixed(4)}) rotate(${-a}deg)`;
        } else if (b.shell.style.transform) b.shell.style.transform = '';
      };

      // ---- Physics ----
      const SUB = 3;
      let hover: number | null = null;
      const gravity = () => 2600 * Math.min(1.2, Math.max(0.7, height / 700));
      const integrate = (dt: number) => {
        const g = gravity();
        const air = Math.exp(-0.35 * dt);
        for (const b of bodies) {
          if (b.held) continue;
          b.vy += g * dt;
          // Rolling resistance: slow bubbles lose speed quickly so piles come to rest.
          const slow = Math.hypot(b.vx, b.vy) < 60 ? Math.exp(-9 * dt) : 1;
          b.vx *= air * slow;
          b.vy *= air;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
        }
        // Circle–circle: separate by inverse mass, then a soft bounce along the normal.
        for (let i = 0; i < bodies.length; i++) {
          const a = bodies[i]!;
          for (let j = i + 1; j < bodies.length; j++) {
            const b = bodies[j]!;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const reach = a.r + b.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= reach * reach) continue;
            const d = Math.sqrt(d2) || 0.01;
            const nx = dx / d;
            const ny = dy / d;
            const ia = a.held ? 0 : 1 / (a.r * a.r);
            const ib = b.held ? 0 : 1 / (b.r * b.r);
            const total = ia + ib;
            if (!total) continue;
            const overlap = reach - d;
            a.x -= nx * overlap * (ia / total);
            a.y -= ny * overlap * (ia / total);
            b.x += nx * overlap * (ib / total);
            b.y += ny * overlap * (ib / total);
            const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (vn < 0) {
              const impulse = (-(1 + 0.3) * vn) / total;
              a.vx -= impulse * ia * nx;
              a.vy -= impulse * ia * ny;
              b.vx += impulse * ib * nx;
              b.vy += impulse * ib * ny;
              // Tangential friction so piles come to rest instead of sliding forever.
              const tx = -ny;
              const ty = nx;
              const vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
              const f = (vt * 0.06) / total;
              a.vx += f * ia * tx;
              a.vy += f * ia * ty;
              b.vx -= f * ib * tx;
              b.vy -= f * ib * ty;
              if (-vn > 140) {
                const angle = (Math.atan2(ny, nx) * 180) / Math.PI;
                kick(a, -vn, angle);
                kick(b, -vn, angle);
              }
            }
          }
        }
        // Walls: floor, sides and (once inside) the ceiling.
        for (const b of bodies) {
          if (b.entering && b.y - b.r > 0) b.entering = false;
          if (b.x < b.r) {
            if (b.vx < -140) kick(b, -b.vx, 0);
            b.x = b.r;
            b.vx = Math.abs(b.vx) * 0.4;
          } else if (b.x > width - b.r) {
            if (b.vx > 140) kick(b, b.vx, 0);
            b.x = width - b.r;
            b.vx = -Math.abs(b.vx) * 0.4;
          }
          if (b.y > height - b.r) {
            if (b.vy > 140) kick(b, b.vy, 90);
            b.y = height - b.r;
            b.vy = b.vy < 60 ? 0 : -Math.abs(b.vy) * 0.32;
            b.vx *= Math.exp(-6 * dt);
          } else if (!b.entering && b.y < b.r) {
            b.y = b.r;
            b.vy = Math.abs(b.vy) * 0.4;
          }
        }
      };
      /** Squash on impact: compress along the hit normal, spring back like jelly. */
      const kick = (b: Body, speed: number, angle: number) => {
        if (reduced) return;
        b.wobAngle = angle;
        b.wobV -= Math.min(2.2, speed * 0.0016);
      };

      const settleNow = () => {
        // Calm packed arrangement (reduced motion): run the simulation silently, render once.
        bodies.forEach((b, i) => {
          b.x = ((i + 0.5) / bodies.length) * width;
          b.y = height - b.r - ((i * 37) % 3) * b.r;
          b.vx = b.vy = 0;
          b.entering = false;
        });
        for (let n = 0; n < 1600; n++) integrate(1 / 240);
        bodies.forEach((b) => {
          b.vx = b.vy = 0;
          render(b);
        });
      };

      // ---- Loop ----
      let frame = 0;
      let last = 0;
      let running = false;
      let calmFrames = 0;
      let started = false;
      const step = (now: number) => {
        const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
        last = now;
        const ease = 1 - Math.exp(-11 * dt);
        let moving = false;
        bodies.forEach((b, i) => {
          const active = i === this.active() && !reduced;
          b.goal = active ? Math.min(b.box, b.base * (scale[i]! >= FEATURED ? 1.18 : GROW)) : b.base;
          if (Math.abs(b.goal - b.r) > 0.05) {
            b.r += (b.goal - b.r) * ease;
            moving = true;
          } else b.r = b.goal;
          // Wobble spring.
          b.wobV += (-420 * b.wob - 11 * b.wobV) * dt;
          b.wob = Math.max(-0.18, Math.min(0.18, b.wob + b.wobV * dt));
          if (Math.abs(b.wob) > 0.002 || Math.abs(b.wobV) > 0.02) moving = true;
          else b.wob = b.wobV = 0;
        });
        const before = bodies.map((b) => [b.x, b.y] as const);
        for (let s = 0; s < SUB; s++) integrate(dt / SUB);
        // Sleep once nothing travels more than a fraction of a pixel per frame.
        let travel = 0;
        bodies.forEach((b, i) => {
          const [x, y] = before[i]!;
          travel = Math.max(travel, Math.hypot(b.x - x, b.y - y));
          render(b);
        });
        const busy = moving || travel > 0.25 || bodies.some((b) => b.held || b.entering);
        calmFrames = busy ? 0 : calmFrames + 1;
        if (calmFrames > 45 || !this.inView()) {
          running = false;
          return;
        }
        frame = requestAnimationFrame(step);
      };
      this.wake = () => {
        if (reduced || running || !started || !this.inView()) return;
        running = true;
        calmFrames = 0;
        last = performance.now();
        frame = requestAnimationFrame(step);
      };

      /** Drop the bubbles in from above, one after another. */
      const dropIn = () => {
        started = true;
        const order = bodies.map((_, i) => i).sort((a, b) => scale[b]! - scale[a]!);
        order.forEach((index, n) => {
          const b = bodies[index]!;
          const lane = ((n * 0.618034) % 1) * 0.8 + 0.1;
          b.x = Math.min(width - b.r, Math.max(b.r, lane * width));
          b.y = -b.r - n * b.base * 1.15 - 20;
          b.vx = (lane - 0.5) * -120;
          b.vy = 200;
          b.entering = true;
          render(b);
        });
        this.wake();
      };

      // Park them above the pit until it scrolls into view.
      bodies.forEach((b, i) => {
        b.x = ((i + 0.5) / bodies.length) * width;
        b.y = -b.box * 2;
        render(b);
      });
      if (reduced) {
        started = true;
        settleNow();
      }

      this.toss = () => {
        if (reduced) return;
        const lift = Math.sqrt(2 * gravity() * height * 0.75);
        for (const b of bodies) {
          b.vy = -lift * (0.55 + Math.random() * 0.5);
          b.vx = (Math.random() - 0.5) * 1400;
          b.wobAngle = 90;
          b.wobV = 1.4;
        }
        this.wake();
      };

      // ---- Pointer: hover hit-testing, grab and fling ----
      const local = (event: PointerEvent) => {
        const rect = pit.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
      };
      const hit = (x: number, y: number): number | null => {
        let best: number | null = null;
        let bestD = Infinity;
        bodies.forEach((b, i) => {
          const d = Math.hypot(x - b.x, y - b.y);
          if (d < b.r && d / b.r < bestD) {
            bestD = d / b.r;
            best = i;
          }
        });
        return best;
      };
      const setHover = (index: number | null) => {
        if (hover === index) return;
        hover = index;
        this.hovered.set(index);
        pit.classList.toggle('is-over', index !== null);
        this.wake();
      };

      let pointerId: number | null = null;
      let grabbed: Body | null = null;
      let offset = { x: 0, y: 0 };
      let start = { x: 0, y: 0 };
      let samples: { x: number; y: number; t: number }[] = [];

      const onDown = (event: PointerEvent) => {
        if (event.button !== 0 || pointerId !== null) return;
        const at = local(event);
        const index = hit(at.x, at.y);
        if (index === null) return;
        this.dragged = false;
        pointerId = event.pointerId;
        grabbed = bodies[index]!;
        offset = { x: at.x - grabbed.x, y: at.y - grabbed.y };
        start = at;
        samples = [{ ...at, t: event.timeStamp }];
      };
      const onMove = (event: PointerEvent) => {
        const at = local(event);
        if (event.pointerType === 'mouse' && pointerId === null) {
          setHover(hit(at.x, at.y));
          return;
        }
        if (event.pointerId !== pointerId || !grabbed) return;
        if (!this.dragged) {
          if (Math.hypot(at.x - start.x, at.y - start.y) < 6 || reduced) return;
          this.dragged = true;
          grabbed.held = true;
          this.held.set(bodies.indexOf(grabbed));
          pit.classList.add('is-grabbing');
          try {
            pit.setPointerCapture(event.pointerId);
          } catch {
            // The pointer may already be gone.
          }
          this.wake();
        }
        event.preventDefault();
        samples.push({ ...at, t: event.timeStamp });
        while (samples.length > 2 && event.timeStamp - samples[0]!.t > 80) samples.shift();
        const prev = samples[samples.length - 2] ?? samples[0]!;
        const dtMove = Math.max(1, event.timeStamp - prev.t) / 1000;
        const b = grabbed;
        b.x = Math.min(width - b.r, Math.max(b.r, at.x - offset.x));
        b.y = Math.min(height - b.r, Math.max(b.r, at.y - offset.y));
        b.vx = (at.x - prev.x) / dtMove;
        b.vy = (at.y - prev.y) / dtMove;
      };
      const onUp = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        pointerId = null;
        const b = grabbed;
        grabbed = null;
        pit.classList.remove('is-grabbing');
        if (!b || !b.held) return;
        b.held = false;
        this.held.set(null);
        const first = samples[0]!;
        const lastSample = samples[samples.length - 1]!;
        const span = Math.max(16, lastSample.t - first.t) / 1000;
        const stale = event.timeStamp - lastSample.t > 70;
        let vx = stale ? 0 : (lastSample.x - first.x) / span;
        let vy = stale ? 0 : (lastSample.y - first.y) / span;
        const speed = Math.hypot(vx, vy);
        if (speed > 3400) {
          vx *= 3400 / speed;
          vy *= 3400 / speed;
        }
        b.vx = vx;
        b.vy = vy;
        if (event.pointerType !== 'mouse') setHover(null);
        this.wake();
      };
      const onLeave = (event: PointerEvent) => {
        if (pointerId === null && event.pointerType === 'mouse') setHover(null);
      };

      pit.addEventListener('pointerdown', onDown);
      pit.addEventListener('pointermove', onMove, { passive: false });
      pit.addEventListener('pointerup', onUp);
      pit.addEventListener('pointercancel', onUp);
      pit.addEventListener('pointerleave', onLeave);

      // Focus and other state changes that should move bubbles.
      this.nudge = () => this.wake();

      const resize = new ResizeObserver(() => {
        const w = pit.clientWidth;
        const h = pit.clientHeight;
        if (w === width && h === height) return;
        const sx = w / width;
        const sy = h / height;
        width = w;
        height = h;
        size();
        if (reduced) {
          settleNow();
          return;
        }
        for (const b of bodies) {
          b.x *= sx;
          b.y *= sy;
          render(b);
        }
        this.wake();
      });
      resize.observe(pit);

      const io = new IntersectionObserver(
        ([entry]) => {
          const visible = !!entry?.isIntersecting;
          this.inView.set(visible);
          pit.classList.toggle('is-offscreen', !visible);
          if (!visible) return;
          if (!started) dropIn();
          else this.wake();
        },
        { threshold: 0.25 },
      );
      io.observe(pit);

      cleanup = () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        io.disconnect();
        pit.removeEventListener('pointerdown', onDown);
        pit.removeEventListener('pointermove', onMove);
        pit.removeEventListener('pointerup', onUp);
        pit.removeEventListener('pointercancel', onUp);
        pit.removeEventListener('pointerleave', onLeave);
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }

  private nudge: () => void = () => {};

  protected playing(index: number): boolean {
    return this.inView() && (index === this.active() || index === this.largest());
  }

  protected onFocus(index: number): void {
    this.focused.set(index);
    this.nudge();
  }

  protected onBlur(): void {
    this.focused.set(null);
    this.nudge();
  }

  protected onClick(index: number, bubble: HTMLElement): void {
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    this.openCase.emit({ index, media: bubble.querySelector<HTMLElement>('app-project-media') });
  }

  protected shake(): void {
    this.shaking.set(false);
    // Restart the CSS shake on the next frame.
    requestAnimationFrame(() => this.shaking.set(true));
    this.toss();
  }

  protected openShown(): void {
    const index = this.shown();
    const media = this.pitRef().nativeElement.querySelector<HTMLElement>(
      `[data-project="${index}"] app-project-media`,
    );
    this.openCase.emit({ index, media });
  }
}
