import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { SideProject } from '../../../data/projects';
import { ProjectMediaView } from '../project-media';
import { kindLabel, OpenCase, pad, prefersReducedMotion } from './shared';

/**
 * Layout 4 — a horizontal film strip pinned while you scroll down: panels glide
 * sideways, skew with scroll speed and sharpen as they reach the centre.
 * Narrow screens get a native swipeable row instead of the pin.
 */
@Component({
  selector: 'app-projects-strip',
  imports: [ProjectMediaView],
  templateUrl: './strip.html',
  styleUrl: './strip.css',
})
export class ProjectsStrip {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;

  private readonly document = inject(DOCUMENT);
  private readonly outer = viewChild.required<ElementRef<HTMLElement>>('outer');
  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      if (!view) return;
      const outer = this.outer().nativeElement;
      const track = this.track().nativeElement;
      const pin = outer.querySelector<HTMLElement>('.pin');
      const panels = [...track.querySelectorAll<HTMLElement>('.panel')];
      const reduced = prefersReducedMotion(view);
      const wide = view.matchMedia('(min-width: 861px)');

      let distance = 0;
      let lastX = 0;
      let skew = 0;
      let frame = 0;

      const measure = () => {
        if (!wide.matches || !pin) {
          outer.style.height = '';
          track.style.transform = '';
          return;
        }
        distance = Math.max(0, track.scrollWidth - view.innerWidth);
        outer.style.height = `${pin.offsetHeight + distance}px`;
        render();
      };

      const render = () => {
        if (!wide.matches || !pin) return;
        const rect = outer.getBoundingClientRect();
        const travel = Math.max(1, rect.height - pin.offsetHeight);
        const progress = Math.min(1, Math.max(0, -rect.top / travel));
        const x = progress * distance;
        const velocity = x - lastX;
        lastX = x;
        skew += ((reduced ? 0 : Math.max(-7, Math.min(7, velocity * 0.12))) - skew) * 0.2;
        track.style.transform = `translate3d(${-x}px, 0, 0) skewX(${skew.toFixed(2)}deg)`;
        outer.style.setProperty('--progress', progress.toFixed(4));
        const centre = view.innerWidth / 2;
        for (const panel of panels) {
          const box = panel.getBoundingClientRect();
          const offset = Math.abs(box.left + box.width / 2 - centre) / view.innerWidth;
          panel.style.setProperty('--focus', Math.max(0, 1 - offset * 1.6).toFixed(3));
        }
        if (Math.abs(skew) > 0.05) frame = requestAnimationFrame(render);
      };

      const onScroll = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(render);
      };

      const resize = new ResizeObserver(measure);
      resize.observe(track);
      view.addEventListener('scroll', onScroll, { passive: true });
      view.addEventListener('resize', measure);
      wide.addEventListener('change', measure);
      measure();

      cleanup = () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        view.removeEventListener('scroll', onScroll);
        view.removeEventListener('resize', measure);
        wide.removeEventListener('change', measure);
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }

  protected open(index: number, panel: HTMLElement): void {
    this.openCase.emit({ index, media: panel.querySelector('app-project-media') });
  }
}
