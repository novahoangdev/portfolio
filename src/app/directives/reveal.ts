import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  input,
  numberAttribute,
} from '@angular/core';

/** Reveal each block once, without changing layout or existing hover transforms. */
@Directive({
  selector: '[appReveal]',
  host: { '(focusin)': 'reveal(false)' },
})
export class Reveal {
  readonly appReveal = input(0, {
    transform: (value: string | number) => numberAttribute(value, 0),
  });

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private observer?: IntersectionObserver;
  private revealed = false;

  constructor() {
    const view = inject(DOCUMENT).defaultView;
    const destroyRef = inject(DestroyRef);
    const reducedMotion = view?.matchMedia('(prefers-reduced-motion: reduce)');
    if (!view || !reducedMotion || reducedMotion.matches) return;

    this.element.classList.add('reveal-pending');
    const onMotionChange = () => {
      if (reducedMotion.matches) this.reveal(false);
    };
    const onAnimationEnd = (event: AnimationEvent) => {
      if (event.target === this.element && event.animationName === 'contentReveal') {
        this.element.classList.remove('reveal-enter');
      }
    };
    reducedMotion.addEventListener('change', onMotionChange);
    this.element.addEventListener('animationend', onAnimationEnd);

    afterNextRender(() => {
      if (this.revealed) return;
      if (reducedMotion.matches || typeof IntersectionObserver === 'undefined') {
        this.reveal(false);
        return;
      }
      this.element.style.setProperty('--reveal-delay', `${this.appReveal()}ms`);
      this.observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) this.reveal();
        },
        { threshold: 0, rootMargin: '0px 0px -24px 0px' },
      );
      this.observer.observe(this.element);
    });

    destroyRef.onDestroy(() => {
      this.observer?.disconnect();
      reducedMotion.removeEventListener('change', onMotionChange);
      this.element.removeEventListener('animationend', onAnimationEnd);
    });
  }

  protected reveal(animate = true): void {
    if (!animate) this.element.classList.remove('reveal-enter');
    if (this.revealed) return;
    this.revealed = true;
    this.observer?.disconnect();
    this.element.classList.remove('reveal-pending');
    if (animate) this.element.classList.add('reveal-enter');
  }
}
