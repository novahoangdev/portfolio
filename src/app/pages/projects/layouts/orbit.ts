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

/** Layout 2 — a 3D ring of projects: drag / swipe / arrows to spin, the front one plays. */
@Component({
  selector: 'app-projects-orbit',
  imports: [ProjectMediaView],
  templateUrl: './orbit.html',
  styleUrl: './orbit.css',
})
export class ProjectsOrbit {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;
  /** Ring rotation in degrees (continuous, not wrapped). */
  protected readonly angle = signal(0);
  protected readonly radius = signal(420);
  protected readonly settling = signal(true);
  protected readonly step = computed(() => 360 / this.projects().length);
  protected readonly active = computed(() => {
    const n = this.projects().length;
    return (((Math.round(-this.angle() / this.step()) % n) + n) % n);
  });

  private readonly document = inject(DOCUMENT);
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private dragged = false;

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      const stage = this.stage().nativeElement;
      if (!view) return;
      const reduced = prefersReducedMotion(view);

      // Radius so the cards sit edge to edge around the ring, with a little air.
      const measure = () => {
        const card = stage.querySelector<HTMLElement>('.card');
        if (!card) return;
        const n = this.projects().length;
        this.radius.set(Math.round((card.offsetWidth / 2 / Math.tan(Math.PI / n)) * 1.12));
      };
      measure();
      const resize = new ResizeObserver(measure);
      resize.observe(stage);

      // Drag to spin with inertia, then settle on the nearest card.
      let startX = 0;
      let startAngle = 0;
      let lastX = 0;
      let lastT = 0;
      let velocity = 0;
      let frame = 0;
      let pointerId: number | null = null;
      let pausedUntil = 0;
      const degPerPx = 0.28;

      const settle = () => {
        this.settling.set(true);
        this.angle.set(Math.round(this.angle() / this.step()) * this.step());
      };
      const glide = () => {
        velocity *= 0.93;
        this.angle.update((a) => a + velocity);
        if (Math.abs(velocity) > 0.08 && !reduced) frame = requestAnimationFrame(glide);
        else settle();
      };
      const onDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        cancelAnimationFrame(frame);
        pointerId = event.pointerId;
        startX = lastX = event.clientX;
        lastT = performance.now();
        startAngle = this.angle();
        velocity = 0;
        this.dragged = false;
        this.settling.set(false);
        pausedUntil = performance.now() + 8000;
      };
      const onMove = (event: PointerEvent) => {
        if (pointerId !== event.pointerId) return;
        const dx = event.clientX - startX;
        if (!this.dragged && Math.abs(dx) > 6) {
          this.dragged = true;
          stage.setPointerCapture(event.pointerId);
        }
        if (!this.dragged) return;
        const now = performance.now();
        velocity = ((event.clientX - lastX) * degPerPx) / Math.max(1, (now - lastT) / 16);
        lastX = event.clientX;
        lastT = now;
        this.angle.set(startAngle + dx * degPerPx);
      };
      const onUp = (event: PointerEvent) => {
        if (pointerId !== event.pointerId) return;
        pointerId = null;
        if (this.dragged) frame = requestAnimationFrame(glide);
        else this.settling.set(true);
      };
      const onWheel = (event: WheelEvent) => {
        // Only horizontal wheel/trackpad gestures spin the ring; vertical keeps scrolling the page.
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
        event.preventDefault();
        cancelAnimationFrame(frame);
        this.settling.set(false);
        velocity = -event.deltaX * 0.05;
        this.angle.update((a) => a - event.deltaX * 0.2);
        pausedUntil = performance.now() + 8000;
        frame = requestAnimationFrame(glide);
      };

      stage.addEventListener('pointerdown', onDown);
      stage.addEventListener('pointermove', onMove);
      stage.addEventListener('pointerup', onUp);
      stage.addEventListener('pointercancel', onUp);
      stage.addEventListener('wheel', onWheel, { passive: false });

      // Gentle auto-advance while idle and on screen.
      let onScreen = false;
      let hovering = false;
      const io = new IntersectionObserver(([entry]) => (onScreen = !!entry?.isIntersecting));
      io.observe(stage);
      const onEnter = () => (hovering = true);
      const onLeave = () => (hovering = false);
      stage.addEventListener('pointerenter', onEnter);
      stage.addEventListener('pointerleave', onLeave);
      const timer = reduced
        ? 0
        : view.setInterval(() => {
            if (!onScreen || hovering || pointerId !== null || performance.now() < pausedUntil) return;
            if (this.document.visibilityState !== 'visible') return;
            this.go(1);
          }, 4200);

      cleanup = () => {
        cancelAnimationFrame(frame);
        view.clearInterval(timer);
        resize.disconnect();
        io.disconnect();
        stage.removeEventListener('pointerdown', onDown);
        stage.removeEventListener('pointermove', onMove);
        stage.removeEventListener('pointerup', onUp);
        stage.removeEventListener('pointercancel', onUp);
        stage.removeEventListener('wheel', onWheel);
        stage.removeEventListener('pointerenter', onEnter);
        stage.removeEventListener('pointerleave', onLeave);
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }

  /** Steps between card i and the front card (0 = front). */
  protected distance(i: number): number {
    const n = this.projects().length;
    const d = Math.abs(i - this.active()) % n;
    return Math.min(d, n - d);
  }

  protected go(delta: number): void {
    this.settling.set(true);
    const snapped = Math.round(this.angle() / this.step()) * this.step();
    this.angle.set(snapped - delta * this.step());
  }

  protected goTo(index: number): void {
    const n = this.projects().length;
    let delta = index - this.active();
    if (delta > n / 2) delta -= n;
    if (delta < -n / 2) delta += n;
    this.go(delta);
  }

  protected onCard(index: number, card: HTMLElement): void {
    if (this.dragged) return;
    if (index === this.active()) {
      this.openCase.emit({ index, media: card.querySelector('app-project-media') });
    } else {
      this.goTo(index);
    }
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') this.go(1);
    else if (event.key === 'ArrowLeft') this.go(-1);
    else return;
    event.preventDefault();
  }

  protected openActive(): void {
    const index = this.active();
    const media = this.stage().nativeElement.querySelector<HTMLElement>(
      `[data-project="${index}"] app-project-media`,
    );
    this.openCase.emit({ index, media });
  }
}
