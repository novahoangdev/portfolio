import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
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

/** Scroll dwell (in floors) above the top floor and below the bottom one. */
const DWELL = 0.3;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

interface Building {
  readonly left: number;
  readonly width: number;
  readonly height: number;
  readonly lit: number;
  readonly band: number;
  readonly warm: boolean;
  readonly top: 'flat' | 'spire' | 'step';
  readonly twinkles: readonly { readonly x: number; readonly y: number; readonly delay: number; readonly dur: number }[];
}

interface Star {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** Stars twinkle in a few out-of-phase groups (one composited layer each, not one per star). */
const STAR_PHASES = 5;
const TWINKLE_CYCLE = 6.8;

/** Small deterministic PRNG so the skyline is the same on every visit. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function skyline(seed: number, count: number, minH: number, maxH: number, twinkle: number): Building[] {
  const r = rng(seed);
  const out: Building[] = [];
  let x = -4;
  const step = 108 / count;
  for (let i = 0; i < count; i++) {
    const width = step * (0.55 + r() * 0.75);
    const tops = ['flat', 'flat', 'spire', 'step'] as const;
    out.push({
      left: x + r() * step * 0.3,
      width,
      height: minH + r() * (maxH - minH),
      lit: 0.25 + r() * 0.65,
      band: 15 + r() * 60,
      warm: r() > 0.3,
      top: tops[Math.floor(r() * tops.length)],
      twinkles: Array.from({ length: r() < twinkle ? 1 + Math.floor(r() * 2) : 0 }, () => ({
        x: 15 + r() * 70,
        y: 10 + r() * 70,
        delay: r() * 9,
        dur: 4 + r() * 8,
      })),
    });
    x += step;
  }
  return out;
}

/**
 * Layout — Night Tower: a cross-section of a slender apartment tower. Each floor
 * is one project, its room lit by lamps and a big window playing its film. A
 * glass lift rides the shaft with scroll (spring-eased, swaying on its cable),
 * stops at each floor, opens its doors and warms the lights. Lift buttons ride
 * straight to a floor. Reduced motion gets a static stack of floor buttons.
 */
@Component({
  selector: 'app-projects-tower',
  imports: [ProjectMediaView, NgTemplateOutlet],
  templateUrl: './tower.html',
  styleUrl: './tower.css',
})
export class ProjectsTower {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly immersive = signal(false);
  /** Floor the lift is stopped at (-1 while riding). */
  protected readonly stop = signal(0);
  /** Floor the lift is passing / nearest to (LED + panel). */
  protected readonly near = signal(0);
  protected readonly dir = signal<'up' | 'down' | ''>('');
  /** Target floor while riding (lit button). */
  protected readonly target = signal(0);
  protected readonly playing = signal<ReadonlySet<number>>(new Set());

  protected readonly far = skyline(11, 22, 14, 34, 0.25);
  protected readonly mid = skyline(23, 13, 22, 52, 0.6);
  protected readonly close = skyline(37, 7, 40, 82, 0.9);
  protected readonly starGroups: readonly { readonly delay: number; readonly stars: readonly Star[] }[] = (() => {
    const r = rng(5);
    const stars = Array.from({ length: 70 }, () => {
      const star = { x: r() * 100, y: r() * 62, size: 1 + r() * 1.8 };
      r(); // (was a per-star delay; keeps the same sky)
      return star;
    });
    return Array.from({ length: STAR_PHASES }, (_, g) => ({
      delay: -(g * TWINKLE_CYCLE) / STAR_PHASES,
      stars: stars.filter((_, i) => i % STAR_PHASES === g),
    }));
  })();
  protected readonly floorNo = computed(() => {
    const n = this.projects().length;
    return (i: number) => pad(n - i);
  });

  private readonly document = inject(DOCUMENT);
  private readonly run = viewChild<ElementRef<HTMLElement>>('run');
  private readonly stack = viewChild<ElementRef<HTMLElement>>('stack');
  private rideTo: ((index: number) => void) | null = null;

  constructor() {
    const view = this.document.defaultView;
    if (view) {
      const motion = view.matchMedia('(prefers-reduced-motion: reduce)');
      const update = () => this.immersive.set(!motion.matches);
      update();
      motion.addEventListener('change', update);
      inject(DestroyRef).onDestroy(() => motion.removeEventListener('change', update));
    }

    afterRenderEffect((onCleanup) => {
      const run = this.run()?.nativeElement;
      if (!run || !view) return;
      onCleanup(untracked(() => this.setupRide(run, view)));
    });

    afterRenderEffect((onCleanup) => {
      const stack = this.stack()?.nativeElement;
      if (!stack || !view) return;
      const fit = () => {
        const fh = Math.min(stack.clientWidth - 24, 780) / 1.64;
        stack.style.setProperty('--fh', `${fh.toFixed(1)}px`);
      };
      const resize = new ResizeObserver(fit);
      resize.observe(stack);
      fit();
      onCleanup(() => resize.disconnect());
    });
  }

  protected kinds(project: SideProject): string {
    return project.kinds.map(kindLabel).join(' · ');
  }

  protected variant(index: number): string {
    return `v${index % 3}`;
  }

  protected playFor(index: number): 'on' | 'off' {
    return this.playing().has(index) ? 'on' : 'off';
  }

  protected open(index: number, host: HTMLElement | null): void {
    const root = host ?? this.run()?.nativeElement.querySelector(`.floor[data-project="${index}"]`) ?? null;
    this.openCase.emit({ index, media: root?.querySelector('app-project-media') ?? null });
  }

  protected openCurrent(): void {
    const i = this.near();
    this.open(i, null);
  }

  protected ride(index: number): void {
    this.rideTo?.(index);
  }

  /** Tabbing to a floor's window rides the lift there (pointer clicks just open it). */
  protected onWindowFocus(index: number, el: HTMLElement): void {
    if (!el.matches(':focus-visible')) return;
    const view = this.document.defaultView;
    view?.requestAnimationFrame(() => this.rideTo?.(index));
  }

  /** The pinned ride: scroll drives a spring-damped lift; the camera follows it. */
  private setupRide(run: HTMLElement, view: Window): () => void {
    const stage = run.querySelector<HTMLElement>('.stage')!;
    const tower = stage.querySelector<HTMLElement>('.tower')!;
    const car = stage.querySelector<HTMLElement>('.car')!;
    const counter = stage.querySelector<HTMLElement>('.counterweight');
    const cable = stage.querySelector<HTMLElement>('.cable-car');
    const cableCw = stage.querySelector<HTMLElement>('.cable-cw');
    const pulley = stage.querySelector<HTMLElement>('.pulley');
    const layers = [...stage.querySelectorAll<HTMLElement>('[data-depth]')];
    const fore = stage.querySelector<HTMLElement>('.fore');
    const panel = stage.querySelector<HTMLElement>('.panel');
    const lift = stage.querySelector<HTMLElement>('.lift');
    const n = this.projects().length;
    const span = n - 1 + DWELL * 2;

    let w = 0;
    let h = 0;
    let fh = 300;
    let roof = 300;
    let anchor = 0.5;
    let stickyTop = 72;
    let pos = 0;
    let vel = 0;
    let cam = 0;
    let sway = 0;
    let swayV = 0;
    let frame = 0;
    let last = 0;
    let inView = false;
    let alive = true;

    const measure = () => {
      w = stage.clientWidth;
      h = stage.clientHeight;
      if (!w || !h) return;
      stickyTop = parseFloat(view.getComputedStyle(stage).top) || 0;
      const wide = w > 1100;
      // Wide: fit the tower between the label panel and the lift panel.
      let left = 14;
      let right = w - 14;
      if (wide && panel && lift) {
        const box = stage.getBoundingClientRect();
        left = panel.getBoundingClientRect().right - box.left + 36;
        right = lift.getBoundingClientRect().left - box.left - 36;
      }
      fh = Math.max(120, Math.min(h * (wide ? 0.54 : 0.4), (right - left) / 2.02));
      roof = fh * 1.05;
      anchor = wide ? 0.5 : 0.36;
      stage.style.setProperty('--fh', `${fh.toFixed(2)}px`);
      stage.style.setProperty('--tx', `${((left + right) / 2).toFixed(1)}px`);
      stage.style.setProperty('--sh', `${h.toFixed(1)}px`);
      render(true);
    };

    const scrollTarget = () => {
      const rect = run.getBoundingClientRect();
      const travel = Math.max(1, run.offsetHeight - stage.offsetHeight);
      const progress = clamp((stickyTop - rect.top) / travel, 0, 1);
      const x = clamp(progress * span - DWELL, 0, n - 1);
      const j = Math.min(Math.floor(x), n - 1);
      const f = x - j;
      // Dwell at each floor, then a smooth ride to the next.
      const eased = j >= n - 1 ? j : j + smoother(clamp((f - 0.25) / 0.5, 0, 1));
      return { eased, rect, ride: Math.round(x) };
    };

    const setPlaying = () => {
      const want = new Set<number>();
      if (inView) {
        const c = Math.round(pos);
        for (let i = c - 1; i <= c + 1; i++) if (i >= 0 && i < n) want.add(i);
      }
      const now = this.playing();
      if (want.size !== now.size || [...want].some((i) => !now.has(i))) this.playing.set(want);
    };

    const render = (snap = false) => {
      if (frame) view.cancelAnimationFrame(frame);
      frame = 0;
      if (!alive || !w) return;
      const now = performance.now();
      let dt = Math.min(0.064, (now - (last || now)) / 1000);
      last = now;
      const t = scrollTarget();

      if (snap) {
        pos = t.eased;
        vel = 0;
        cam = pos;
      } else {
        // Critically damped spring for the car; an under-damped one for its sway.
        const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
        const sdt = dt / steps;
        const omega = 6.5;
        for (let s = 0; s < steps; s++) {
          const acc = omega * omega * (t.eased - pos) - 2 * omega * vel;
          vel += acc * sdt;
          pos += vel * sdt;
          const swayTarget = clamp(-vel * 0.9, -2.6, 2.6);
          const swayAcc = 38 * (swayTarget - sway) - 2.2 * swayV;
          swayV += swayAcc * sdt;
          sway += swayV * sdt;
          cam += (pos - cam) * (1 - Math.exp(-sdt * 7));
        }
        dt = 0;
      }

      const camY = h * anchor - (roof + cam * fh + fh * 0.5);
      tower.style.transform = `translate3d(0, ${camY.toFixed(2)}px, 0)`;
      const carTop = roof + pos * fh + fh * 0.32;
      car.style.transform = `translate3d(0, ${carTop.toFixed(2)}px, 0) rotate(${sway.toFixed(3)}deg)`;
      if (cable) cable.style.transform = `scaleY(${(carTop - roof * 0.42).toFixed(1)})`;
      const cwTop = roof + (n - 1 - pos) * fh + fh * 0.3;
      if (counter) counter.style.transform = `translate3d(0, ${cwTop.toFixed(2)}px, 0)`;
      if (cableCw) cableCw.style.transform = `scaleY(${(cwTop - roof * 0.42).toFixed(1)})`;
      if (pulley) pulley.style.transform = `rotate(${(pos * 220).toFixed(2)}deg)`;

      // Parallax: the city rises as the lift descends; the far sky barely moves.
      const ground = camY + roof + n * fh;
      const horizon = h * 0.8;
      for (const layer of layers) {
        const depth = Number(layer.dataset['depth']);
        const y = depth >= 1 ? 0 : ground * depth + horizon * (1 - depth) - h;
        const lift = depth >= 1 ? camY * (depth - 1) : y;
        layer.style.transform = `translate3d(0, ${lift.toFixed(2)}px, 0)`;
      }
      if (fore) fore.style.transform = `translate3d(0, ${((camY * 1.35) % (fh * 2.4)).toFixed(2)}px, 0)`;

      const nearest = clamp(Math.round(pos), 0, n - 1);
      const stopped = Math.abs(pos - nearest) < 0.015 && Math.abs(vel) < 0.08 && Math.abs(t.eased - nearest) < 0.002;
      const stopAt = stopped ? nearest : -1;
      if (stopAt !== this.stop()) this.stop.set(stopAt);
      if (nearest !== this.near()) this.near.set(nearest);
      const d = Math.abs(vel) < 0.05 ? '' : vel > 0 ? 'down' : 'up';
      if (d !== this.dir()) this.dir.set(d);
      const goal = clamp(Math.round(t.eased + Math.sign(t.eased - pos) * 0.49), 0, n - 1);
      const tgt = stopped ? nearest : goal;
      if (tgt !== this.target()) this.target.set(tgt);
      setPlaying();

      const moving =
        Math.abs(t.eased - pos) > 0.0005 || Math.abs(vel) > 0.002 || Math.abs(sway) > 0.01 || Math.abs(swayV) > 0.01 || Math.abs(pos - cam) > 0.0005;
      if (moving) frame = view.requestAnimationFrame(() => render());
      else last = 0;
    };

    const kick = () => {
      if (!frame) frame = view.requestAnimationFrame(() => render());
    };

    this.rideTo = (index: number) => {
      const travel = Math.max(1, run.offsetHeight - stage.offsetHeight);
      const top = run.getBoundingClientRect().top + view.scrollY - stickyTop + ((index + DWELL) / span) * travel;
      view.scrollTo({ top, behavior: 'smooth' });
    };

    const io = new IntersectionObserver(([entry]) => {
      inView = !!entry?.isIntersecting;
      // Off screen: pause the sky's ambient loops (stars, clouds, plane, beacons).
      stage.classList.toggle('is-off', !inView);
      setPlaying();
    });
    io.observe(run);
    const resize = new ResizeObserver(() => measure());
    resize.observe(stage);
    view.addEventListener('scroll', kick, { passive: true });
    measure();

    return () => {
      alive = false;
      this.rideTo = null;
      view.cancelAnimationFrame(frame);
      io.disconnect();
      resize.disconnect();
      view.removeEventListener('scroll', kick);
    };
  }
}
