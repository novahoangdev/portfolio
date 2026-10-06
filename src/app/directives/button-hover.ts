import { DestroyRef, Directive, ElementRef, NgZone, inject } from '@angular/core';

@Directive({
  selector: '[appButtonHover], [appTabHover]',
  host: { '[class.button-hover]': 'isButton' },
})
export class ButtonHover {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly isButton = this.element.hasAttribute('appButtonHover');

  constructor() {
    const element = this.element;
    const destroyRef = inject(DestroyRef);
    const zone = inject(NgZone);
    const update = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // Convert pointer coordinates back to the button's unscaled local space.
      const x = (event.clientX - rect.left) * element.offsetWidth / rect.width;
      const y = (event.clientY - rect.top) * element.offsetHeight / rect.height;
      element.style.setProperty('--button-x', `${x}px`);
      element.style.setProperty('--button-y', `${y}px`);
    };
    zone.runOutsideAngular(() => {
      element.addEventListener('pointerenter', update);
      element.addEventListener('pointermove', update);
    });
    destroyRef.onDestroy(() => {
      element.removeEventListener('pointerenter', update);
      element.removeEventListener('pointermove', update);
    });
  }
}
