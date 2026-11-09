import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectorRef,
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
import { ProjectKind, projectKinds, SideProject } from '../../../data/projects';
import { Reveal } from '../../../directives/reveal';
import { Tilt } from '../../../directives/tilt';
import { ProjectMediaView } from '../project-media';
import { canHover, kindLabel, OpenCase, pad, withViewTransition } from './shared';

type Filter = ProjectKind | 'all';

/** Layout 1 — a living mosaic: every project at once, filterable, tilt on hover. */
@Component({
  selector: 'app-projects-wall',
  imports: [ProjectMediaView, Reveal, Tilt],
  templateUrl: './wall.html',
  styleUrl: './wall.css',
})
export class ProjectsWall {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly kinds = projectKinds;
  protected readonly filter = signal<Filter>('all');
  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;

  protected readonly visible = computed(() => {
    const filter = this.filter();
    return this.projects()
      .map((project, index) => ({ project, index }))
      .filter(({ project }) => filter === 'all' || project.kinds.includes(filter));
  });

  private readonly document = inject(DOCUMENT);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly wall = viewChild<ElementRef<HTMLElement>>('wall');
  private readonly cursor = viewChild<ElementRef<HTMLElement>>('cursor');

  constructor() {
    let cleanup = () => {};
    afterNextRender(() => {
      const wall = this.wall()?.nativeElement;
      const cursor = this.cursor()?.nativeElement;
      if (!wall || !cursor || !canHover(this.document.defaultView)) return;
      let frame = 0;
      const onMove = (event: PointerEvent) => {
        const overTile = (event.target as HTMLElement | null)?.closest('.tile');
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          cursor.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
          cursor.classList.toggle('is-visible', !!overTile);
        });
      };
      const onLeave = () => cursor.classList.remove('is-visible');
      wall.addEventListener('pointermove', onMove);
      wall.addEventListener('pointerleave', onLeave);
      cleanup = () => {
        cancelAnimationFrame(frame);
        wall.removeEventListener('pointermove', onMove);
        wall.removeEventListener('pointerleave', onLeave);
      };
    });
    inject(DestroyRef).onDestroy(() => cleanup());
  }

  protected countFor(filter: Filter): number {
    return filter === 'all'
      ? this.projects().length
      : this.projects().filter((p) => p.kinds.includes(filter)).length;
  }

  /** Mosaic spans for the n-th visible tile (desktop 12-column grid). */
  protected spanFor(position: number, count: number): { c: number; r: number } {
    if (position === 0) return count === 1 ? { c: 12, r: 2 } : { c: 8, r: 2 };
    if (count === 2) return { c: 4, r: 2 };
    // Beside the hero: one tall tile (even counts) or two stacked tiles (odd).
    const tall = count % 2 === 0;
    if (position === 1 && tall) return { c: 4, r: 2 };
    if (!tall && position <= 2) return { c: 4, r: 1 };
    const rest = count - (tall ? 2 : 3);
    const c = rest % 4 === 0 ? 3 : rest % 3 === 0 ? 4 : rest <= 4 ? 12 / rest : 3;
    return { c, r: 1 };
  }

  protected setFilter(filter: Filter): void {
    if (filter === this.filter()) return;
    withViewTransition(this.document, () => {
      this.filter.set(filter);
      this.changes.detectChanges();
    });
  }

  protected open(index: number, tile: HTMLElement): void {
    this.cursor()?.nativeElement.classList.remove('is-visible');
    this.openCase.emit({ index, media: tile.querySelector('app-project-media') });
  }
}
