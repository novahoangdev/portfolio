import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Component,
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

/**
 * Layout 5 — an editorial index: big serif names; hovering one floats its demo
 * beside the cursor (eased, leaning with pointer speed).
 */
@Component({
  selector: 'app-projects-index',
  imports: [ProjectMediaView],
  templateUrl: './index-list.html',
  styleUrl: './index-list.css',
})
export class ProjectsIndex {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;
  protected readonly hovered = signal<number | null>(null);

  private readonly document = inject(DOCUMENT);
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');
  private readonly preview = viewChild.required<ElementRef<HTMLElement>>('preview');

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      if (!view || !canHover(view)) return;
      const list = this.list().nativeElement;
      const preview = this.preview().nativeElement;
      const reduced = prefersReducedMotion(view);
      let targetX = 0;
      let targetY = 0;
      let x = 0;
      let y = 0;
      let tilt = 0;
      let frame = 0;
      let running = false;

      const loop = () => {
        const ease = reduced ? 1 : 0.14;
        const dx = (targetX - x) * ease;
        x += dx;
        y += (targetY - y) * ease;
        tilt += ((reduced ? 0 : Math.max(-12, Math.min(12, dx * 0.5))) - tilt) * 0.15;
        preview.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) rotate(${tilt.toFixed(2)}deg)`;
        frame = running ? requestAnimationFrame(loop) : 0;
      };
      const onMove = (event: PointerEvent) => {
        targetX = event.clientX;
        targetY = event.clientY;
        if (!running) {
          running = true;
          x = targetX;
          y = targetY;
          frame = requestAnimationFrame(loop);
        }
      };
      const onLeave = () => {
        running = false;
        this.hovered.set(null);
      };
      list.addEventListener('pointermove', onMove);
      list.addEventListener('pointerleave', onLeave);
      cleanup = () => {
        running = false;
        cancelAnimationFrame(frame);
        list.removeEventListener('pointermove', onMove);
        list.removeEventListener('pointerleave', onLeave);
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }

  protected open(index: number, row: HTMLElement): void {
    // Morph from the floating preview when it is showing, else from the row thumbnail.
    const fromPreview =
      this.hovered() === index
        ? this.preview().nativeElement.querySelector<HTMLElement>(
            `[data-preview="${index}"] app-project-media`,
          )
        : null;
    this.openCase.emit({ index, media: fromPreview ?? row.querySelector('app-project-media') });
  }
}
