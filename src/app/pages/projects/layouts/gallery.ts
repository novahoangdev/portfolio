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

/** A camera pose in hall units (px): position on the floor plan and heading. */
interface Pose {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smootherstep with a dwell at both ends, so the walk pauses in front of each piece. */
const walkEase = (t: number) => {
  const x = clamp((t - 0.16) / 0.68, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/**
 * Layout — Gallery Hall: a dark museum corridor built in CSS 3D. Scrolling walks
 * the camera down the hall; it turns to face each framed piece, lit by its own
 * spotlight, then turns back and walks on. Narrow screens and reduced motion get
 * a calm vertical sequence of lit pieces instead.
 */
@Component({
  selector: 'app-projects-gallery',
  imports: [ProjectMediaView, NgTemplateOutlet],
  templateUrl: './gallery.html',
  styleUrl: './gallery.css',
})
export class ProjectsGallery {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly githubUrl = 'https://github.com/novahoangdev';
  /** The 3D walk (wide screens with motion) or the calm vertical sequence. */
  protected readonly immersive = signal(false);
  /** Index of the piece the camera is facing (-1 at the entrance / the end). */
  protected readonly active = signal(-1);
  /** -1 entrance, 0..n-1 pieces, n end wall (for the HUD). */
  protected readonly station = signal(-1);
  /** Pieces in the vertical sequence whose light has switched on. */
  protected readonly lit = signal<ReadonlySet<number>>(new Set());
  protected readonly bays = computed(() => Array.from({ length: this.projects().length + 3 }, (_, i) => i));

  private readonly document = inject(DOCUMENT);
  private readonly hall = viewChild<ElementRef<HTMLElement>>('hall');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    const view = this.document.defaultView;
    if (view) {
      const wide = view.matchMedia('(min-width: 861px)');
      const motion = view.matchMedia('(prefers-reduced-motion: reduce)');
      const update = () => this.immersive.set(wide.matches && !motion.matches);
      update();
      wide.addEventListener('change', update);
      motion.addEventListener('change', update);
      inject(DestroyRef).onDestroy(() => {
        wide.removeEventListener('change', update);
        motion.removeEventListener('change', update);
      });
    }

    afterRenderEffect((onCleanup) => {
      const hall = this.hall()?.nativeElement;
      if (!hall || !view) return;
      onCleanup(untracked(() => this.setupHall(hall, view)));
    });

    afterRenderEffect((onCleanup) => {
      const list = this.list()?.nativeElement;
      if (!list || !view) return;
      onCleanup(untracked(() => this.setupList(list)));
    });
  }

  protected kinds(project: SideProject): string {
    return project.kinds.map(kindLabel).join(' · ');
  }

  protected open(index: number, frame: HTMLElement): void {
    this.openCase.emit({ index, media: frame.querySelector('app-project-media') });
  }

  /** Keyboard focus on a frame walks the camera to it. */
  protected onFocus(index: number): void {
    const hall = this.hall()?.nativeElement;
    const view = this.document.defaultView;
    if (!hall || !view) return;
    const stage = hall.querySelector<HTMLElement>('.stage');
    if (!stage) return;
    const n = this.projects().length;
    const travel = hall.offsetHeight - stage.offsetHeight;
    const hallTop = hall.getBoundingClientRect().top + view.scrollY;
    const top = hallTop + (travel * (index + 1)) / (n + 1);
    // Let the browser finish its own focus scroll first.
    view.requestAnimationFrame(() => view.scrollTo({ top, behavior: 'smooth' }));
  }

  /** The 3D hall: measure, place every plane, then drive the camera from scroll. */
  private setupHall(hall: HTMLElement, view: Window): () => void {
    const stage = hall.querySelector<HTMLElement>('.stage')!;
    const viewport = hall.querySelector<HTMLElement>('.viewport')!;
    const world = hall.querySelector<HTMLElement>('.world')!;
    // Shell, artworks and light shafts are separate 3D contexts sharing one camera.
    const worlds = [...hall.querySelectorAll<HTMLElement>('.world')];
    const light = hall.querySelector<HTMLElement>('.world.light');
    const fill = hall.querySelector<HTMLElement>('.hud-fill');
    const hint = hall.querySelector<HTMLElement>('.hud-hint');
    const n = this.projects().length;

    let stations: Pose[] = [];
    let persp = 800;
    let unit = 800;
    let current = -1;
    let lookX = 0;
    let lookY = 0;
    let targetLookX = 0;
    let targetLookY = 0;
    let frame = 0;
    let last = 0;
    let stickyTop = 72;

    const place = (el: Element | null, w: number, h: number, x: number, y: number, z: number, rot = '') => {
      if (!(el instanceof HTMLElement)) return;
      el.style.width = `${w.toFixed(1)}px`;
      el.style.height = `${h.toFixed(1)}px`;
      el.style.transform = `translate3d(${(x - w / 2).toFixed(1)}px, ${(y - h / 2).toFixed(1)}px, ${z.toFixed(1)}px) ${rot}`;
    };

    const measure = () => {
      const w = stage.clientWidth;
      const u = (unit = stage.clientHeight);
      stickyTop = parseFloat(view.getComputedStyle(stage).top) || 0;
      persp = u * 0.8;
      viewport.style.perspective = `${persp.toFixed(0)}px`;
      stage.style.setProperty('--u', `${u}px`);

      const X = clamp(w * 0.44, u * 0.8, u * 1.05);
      const F = u * 0.4;
      const C = -u * 0.68;
      const S = u * 1.02;
      const Z0 = u * 1.25;
      const D = u * 0.56;
      const step = u * 0.15;
      const yc = -u * 0.07;
      const zStart = u * 1.1;
      const zEnd = -(Z0 + (n - 1) * S + u * 1.25);
      const length = zStart - zEnd;
      const bays = n + 3;
      const bay = length / bays;

      // Hall shell, built from bays so no single plane gets enormous.
      world.querySelectorAll('.bay').forEach((el, j) => {
        const zc = zStart - bay * (j + 0.5);
        place(el.querySelector('.floor'), X * 2, bay + 1, 0, F, zc, 'rotateX(90deg)');
        place(el.querySelector('.ceiling'), X * 2, bay + 1, 0, C, zc, 'rotateX(-90deg)');
        place(el.querySelector('.wall-l'), bay + 1, F - C, -X, (F + C) / 2, zc, 'rotateY(90deg)');
        place(el.querySelector('.wall-r'), bay + 1, F - C, X, (F + C) / 2, zc, 'rotateY(-90deg)');
      });
      place(world.querySelector('.end-wall'), X * 2, F - C, 0, (F + C) / 2, zEnd);
      place(world.querySelector('.intro'), u * 0.8, u * 0.5, X - 2, -u * 0.1, -u * 1.0, 'rotateY(-90deg)');
      place(world.querySelector('.runner'), u * 0.5, length - u * 0.6, 0, F - 1, (zStart + zEnd) / 2 - u * 0.3, 'rotateX(90deg)');

      stations = [{ x: 0, z: u * 0.45, yaw: 0 }];
      hall.querySelectorAll<HTMLElement>('.exhibit').forEach((el, k) => {
        const side = k % 2 === 0 ? -1 : 1;
        const z = -(Z0 + k * S);
        const turn = side < 0 ? 'rotateY(90deg)' : 'rotateY(-90deg)';
        el.style.transform = `translate3d(${(side * (X - 6)).toFixed(1)}px, ${yc.toFixed(1)}px, ${z.toFixed(1)}px) ${turn}`;
        const reflection = world.querySelector(`.reflection[data-k="${k}"]`);
        if (reflection instanceof HTMLElement) {
          reflection.style.transform = `translate3d(${(side * (X - 2)).toFixed(1)}px, ${(2 * F - yc).toFixed(1)}px, ${z.toFixed(1)}px) ${turn} scaleY(-1)`;
        }
        place(world.querySelector(`.pool[data-k="${k}"]`), u * 0.75, u * 1.05, side * (X - u * 0.22), F - 1, z, 'rotateX(90deg)');
        place(world.querySelector(`.lamp[data-k="${k}"]`), u * 0.1, u * 0.1, side * (X - u * 0.32), C + 1, z, 'rotateX(-90deg)');
        place(light?.querySelector(`.shaft[data-k="${k}"]`) ?? null, u * 0.62, F - C, side * (X - u * 0.31), (F + C) / 2, z, side > 0 ? '' : 'scaleX(-1)');

        const x = -side * step;
        const yaw = (Math.atan2(side * X - x, D) * 180) / Math.PI;
        stations.push({ x, z: z + D, yaw: yaw * 0.94 });
      });
      stations.push({ x: 0, z: zEnd + u * 1.05, yaw: 0 });
      render(true);
    };

    const pose = (s: number): Pose & { bob: number } => {
      const j = clamp(s + 1, 0, n + 1);
      const i = Math.min(Math.floor(j), n);
      const a = stations[i];
      const b = stations[Math.min(i + 1, n + 1)];
      const e = walkEase(j - i);
      const z = lerp(a.z, b.z, e);
      // A whisper of head-bob, tied to distance walked.
      return { x: lerp(a.x, b.x, e), z, yaw: lerp(a.yaw, b.yaw, e), bob: Math.sin((z / unit) * Math.PI * 3.2) * unit * 0.0025 };
    };

    const targetStation = () => {
      const rect = hall.getBoundingClientRect();
      const travel = Math.max(1, hall.offsetHeight - stage.offsetHeight);
      const progress = clamp((stickyTop - rect.top) / travel, 0, 1);
      return { s: progress * (n + 1) - 1, progress, rect };
    };

    const render = (snap = false) => {
      if (!stations.length) return;
      const now = performance.now();
      const dt = Math.min(64, now - (last || now));
      last = now;
      const { s, progress, rect } = targetStation();
      const k = snap ? 1 : 1 - Math.pow(1 - 0.085, dt / 16.67);
      current += (s - current) * k;
      lookX += (targetLookX - lookX) * k;
      lookY += (targetLookY - lookY) * k;

      const p = pose(current);
      const camera =
        `translate3d(0, 0, ${persp.toFixed(1)}px) rotateX(${lookY.toFixed(3)}deg) ` +
        `rotateY(${(p.yaw + lookX).toFixed(3)}deg) translate3d(${(-p.x).toFixed(2)}px, ${(-p.bob).toFixed(2)}px, ${(-p.z).toFixed(2)}px)`;
      for (const w of worlds) w.style.transform = camera;
      if (fill) fill.style.transform = `scaleX(${clamp((current + 1) / (n + 1), 0, 1).toFixed(4)})`;
      if (hint) hint.style.opacity = String(clamp(1 - progress * 8, 0, 1));

      // The doorway: the hall opens up from a rounded portal as it slides in.
      const vh = view.innerHeight;
      const enter = clamp((rect.top - stickyTop) / (vh * 0.9), 0, 1);
      const leave = clamp((vh - rect.bottom) / (vh * 0.9), 0, 1);
      const door = Math.max(enter, leave);
      stage.style.setProperty('--door', door.toFixed(4));

      const nearest = Math.round(current);
      const station = clamp(nearest, -1, n);
      if (station !== this.station()) this.station.set(station);
      const facing = Math.abs(current - nearest) < 0.42 && nearest >= 0 && nearest < n ? nearest : -1;
      if (facing !== this.active()) this.active.set(facing);

      const moving = Math.abs(s - current) > 0.0004 || Math.abs(targetLookX - lookX) > 0.01 || Math.abs(targetLookY - lookY) > 0.01;
      frame = moving ? requestAnimationFrame(() => render()) : 0;
      if (!moving) last = 0;
    };

    const kick = () => {
      if (!frame) frame = requestAnimationFrame(() => render());
    };

    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const box = stage.getBoundingClientRect();
      targetLookX = ((event.clientX - box.left) / box.width - 0.5) * 5;
      targetLookY = -((event.clientY - box.top) / box.height - 0.5) * 3;
      kick();
    };
    const onLeave = () => {
      targetLookX = 0;
      targetLookY = 0;
      kick();
    };

    const resize = new ResizeObserver(() => measure());
    resize.observe(stage);
    view.addEventListener('scroll', kick, { passive: true });
    stage.addEventListener('pointermove', onPointer);
    stage.addEventListener('pointerleave', onLeave);
    current = targetStation().s;
    measure();

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      view.removeEventListener('scroll', kick);
      stage.removeEventListener('pointermove', onPointer);
      stage.removeEventListener('pointerleave', onLeave);
    };
  }

  /** The vertical sequence: each piece's light switches on as it scrolls in. */
  private setupList(list: HTMLElement): () => void {
    const io = new IntersectionObserver(
      (entries) => {
        const next = new Set(this.lit());
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset['project']);
          if (entry.isIntersecting) next.add(index);
        }
        this.lit.set(next);
      },
      { threshold: 0.35 },
    );
    list.querySelectorAll('.piece').forEach((piece) => io.observe(piece));
    return () => io.disconnect();
  }

  /** Whether an exhibit's poster-only reflection / media should play (≤ 1 video at a time). */
  protected playFor(index: number): 'on' | 'off' {
    return this.active() === index ? 'on' : 'off';
  }
}
