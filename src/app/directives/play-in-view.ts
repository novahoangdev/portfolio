import { DOCUMENT } from '@angular/common';
import { afterNextRender, DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/**
 * Plays a muted preview video only while it is on screen, and never when the
 * viewer prefers reduced motion (the poster frame stays visible instead).
 */
@Directive({ selector: 'video[appPlayInView]' })
export class PlayInView {
  constructor() {
    const video = inject<ElementRef<HTMLVideoElement>>(ElementRef).nativeElement;
    const view = inject(DOCUMENT).defaultView;
    let observer: IntersectionObserver | undefined;

    afterNextRender(() => {
      const reducedMotion = view?.matchMedia('(prefers-reduced-motion: reduce)');
      if (!view || reducedMotion?.matches || typeof IntersectionObserver === 'undefined') return;

      video.muted = true;
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) {
            video.play().catch(() => {
              // Autoplay can be blocked (e.g. Low Power Mode); the poster stays visible.
            });
          } else {
            video.pause();
          }
        },
        { threshold: 0.35 },
      );
      observer.observe(video);
    });

    inject(DestroyRef).onDestroy(() => observer?.disconnect());
  }
}
