import { Component, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { SideProject } from '../../../data/projects';
import { ProjectMediaView } from '../project-media';
import { kindLabel, OpenCase, pad } from './shared';

/** Layout 3 — a fanned hand of cards: pick one and it springs to the centre. */
@Component({
  selector: 'app-projects-deck',
  imports: [ProjectMediaView],
  templateUrl: './deck.html',
  styleUrl: './deck.css',
})
export class ProjectsDeck {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;
  protected readonly active = signal(0);

  private readonly table = viewChild.required<ElementRef<HTMLElement>>('table');
  private swipeX: number | null = null;
  private swiped = false;

  /** Signed seat of card i around the active one, wrapped to -n/2..n/2. */
  protected seat(i: number): number {
    const n = this.projects().length;
    const half = Math.floor(n / 2);
    return ((i - this.active() + n + half) % n) - half;
  }

  protected go(delta: number): void {
    const n = this.projects().length;
    this.active.update((a) => (a + delta + n) % n);
  }

  protected onCard(index: number, card: HTMLElement): void {
    if (this.swiped) return;
    if (index === this.active()) {
      this.openCase.emit({ index, media: card.querySelector('app-project-media') });
    } else {
      this.active.set(index);
    }
  }

  protected openActive(): void {
    const index = this.active();
    const media = this.table().nativeElement.querySelector<HTMLElement>(
      `[data-project="${index}"] app-project-media`,
    );
    this.openCase.emit({ index, media });
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight') this.go(1);
    else if (event.key === 'ArrowLeft') this.go(-1);
    else return;
    event.preventDefault();
  }

  protected onPointerDown(event: PointerEvent): void {
    this.swipeX = event.clientX;
    this.swiped = false;
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.swipeX === null) return;
    const dx = event.clientX - this.swipeX;
    this.swipeX = null;
    if (Math.abs(dx) > 50) {
      this.swiped = true;
      this.go(dx < 0 ? 1 : -1);
      // Let the click that follows this pointerup be ignored, then reset.
      setTimeout(() => (this.swiped = false));
    }
  }
}
