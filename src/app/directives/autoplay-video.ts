import { DOCUMENT } from '@angular/common';
import { afterNextRender, DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/**
 * Plays a muted, looping demo clip only while it is on screen.
 * Nothing is downloaded until the card is near the viewport; with reduced motion the poster stays.
 */
@Directive({ selector: 'video[appAutoplayVideo]' })
export class AutoplayVideo {
  private readonly video = inject<ElementRef<HTMLVideoElement>>(ElementRef).nativeElement;

  constructor() {
    const view = inject(DOCUMENT).defaultView;
    const destroyRef = inject(DestroyRef);
    // Autoplay requires the muted *property*, not just the attribute.
    this.video.muted = true;
    this.video.playsInline = true;

    afterNextRender(() => {
      const reducedMotion = view?.matchMedia('(prefers-reduced-motion: reduce)');
      if (!view || reducedMotion?.matches || typeof IntersectionObserver === 'undefined') return;

      let visible = false;
      const sync = () => {
        if (visible && !view.document.hidden) {
          if (this.video.preload !== 'auto') this.video.preload = 'auto';
          this.video.play().catch(() => {});
        } else {
          this.video.pause();
        }
      };
      const observer = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting;
          sync();
        },
        { threshold: 0.35 },
      );
      observer.observe(this.video);
      view.document.addEventListener('visibilitychange', sync);

      destroyRef.onDestroy(() => {
        observer.disconnect();
        view.document.removeEventListener('visibilitychange', sync);
      });
    });
  }
}
