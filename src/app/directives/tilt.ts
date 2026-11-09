import { DOCUMENT } from '@angular/common';
import { afterNextRender, DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/**
 * Pointer-driven 3D tilt with a cursor spotlight. Writes `--rx`, `--ry`
 * (degrees) and `--mx`, `--my` (percent) on the host for CSS to use.
 * Native listeners only (no change detection per move); enabled only for
 * hover-capable fine pointers and when reduced motion is off.
 */
@Directive({ selector: '[appTilt]' })
export class Tilt {
  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const view = inject(DOCUMENT).defaultView;
    const max = 7;
    let frame = 0;
    let cleanup = () => {};

    afterNextRender(() => {
      if (!view) return;
      const canHover = view.matchMedia('(hover: hover) and (pointer: fine)').matches;
      const reduced = view.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!canHover || reduced) return;

      const onMove = (event: PointerEvent) => {
        const rect = host.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          host.style.setProperty('--ry', `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
          host.style.setProperty('--rx', `${((0.5 - y) * 2 * max).toFixed(2)}deg`);
          host.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
          host.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
        });
      };
      const onLeave = () => {
        cancelAnimationFrame(frame);
        host.style.setProperty('--rx', '0deg');
        host.style.setProperty('--ry', '0deg');
      };

      host.addEventListener('pointermove', onMove);
      host.addEventListener('pointerleave', onLeave);
      cleanup = () => {
        cancelAnimationFrame(frame);
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerleave', onLeave);
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }
}
