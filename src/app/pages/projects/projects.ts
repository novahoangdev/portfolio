import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { sideProjects } from '../../data/projects';
import { contact } from '../../data/profile';
import { Reveal } from '../../directives/reveal';
import { ProjectsCanvas } from './layouts/canvas';
import { ProjectsCinema } from './layouts/cinema';
import { ProjectsDeck } from './layouts/deck';
import { ProjectsDesk } from './layouts/desk';
import { ProjectsFlashlight } from './layouts/flashlight';
import { ProjectsGallery } from './layouts/gallery';
import { ProjectsIde } from './layouts/ide';
import { ProjectsIndex } from './layouts/index-list';
import { ProjectsMagazine } from './layouts/magazine';
import { ProjectsOrbit } from './layouts/orbit';
import { ProjectsPit } from './layouts/pit';
import { isLayoutId, LayoutId, layoutOptions } from './layouts/registry';
import { kindLabel, OpenCase, pad, withViewTransition } from './layouts/shared';
import { ProjectsStrip } from './layouts/strip';
import { ProjectsTv } from './layouts/tv';
import { ProjectsVinyl } from './layouts/vinyl';
import { ProjectsWall } from './layouts/wall';
import { ProjectsMetro } from './layouts/metro';
import { ProjectsStars } from './layouts/stars';
import { ProjectsDarkroom } from './layouts/darkroom';
import { ProjectsRetro } from './layouts/retro';
import { ProjectsType } from './layouts/type';
import { ProjectsCards } from './layouts/cards';
import { ProjectsKaleido } from './layouts/kaleido';
import { ProjectsCalder } from './layouts/calder';
import { ProjectsGacha } from './layouts/gacha';
import { ProjectsTower } from './layouts/tower';
import { ProjectMediaView } from './project-media';

const LAYOUT_KEY = 'portfolio-projects-layout';

/**
 * Side projects with interchangeable layouts (see `layouts/registry.ts`) and one shared case-study dialog. The chosen layout is remembered
 * per browser.
 */
@Component({
  selector: 'app-projects',
  imports: [
    ProjectMediaView,
    ProjectsCanvas,
    ProjectsCinema,
    ProjectsDeck,
    ProjectsDesk,
    ProjectsFlashlight,
    ProjectsGallery,
    ProjectsIde,
    ProjectsIndex,
    ProjectsMagazine,
    ProjectsOrbit,
    ProjectsPit,
    ProjectsStrip,
    ProjectsTv,
    ProjectsVinyl,
    ProjectsWall,
    ProjectsMetro,
    ProjectsStars,
    ProjectsDarkroom,
    ProjectsRetro,
    ProjectsType,
    ProjectsCards,
    ProjectsKaleido,
    ProjectsCalder,
    ProjectsGacha,
    ProjectsTower,
    Reveal,
  ],
  templateUrl: './projects.html',
  styleUrl: './projects.css',
})
export class Projects {
  // Injected first: the initial layout reads the URL.
  private readonly document = inject(DOCUMENT);

  protected readonly projects = sideProjects;
  protected readonly githubUrl = contact.github;
  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;

  protected readonly layouts = layoutOptions;
  protected readonly layoutGroups = (
    [
      ['classic', 'Classic'],
      ['experimental', 'Experimental'],
      ['playground', 'Playground'],
    ] as const
  ).map(([id, label]) => ({ id, label, options: layoutOptions.filter((l) => l.group === id) }));
  protected readonly labOpen = signal(false);

  protected readonly layout = signal<LayoutId>(this.initialLayout());
  protected readonly current = computed(
    () => this.layouts.find((l) => l.id === this.layout()) ?? this.layouts[0],
  );
  protected readonly currentPosition = computed(
    () => this.layouts.findIndex((l) => l.id === this.layout()) + 1,
  );
  protected readonly technologies = [...new Set(sideProjects.flatMap((p) => p.technologies))];

  protected readonly openIndex = signal<number | null>(null);
  protected readonly openProject = computed(() => {
    const index = this.openIndex();
    return index === null ? null : this.projects[index];
  });

  private readonly changes = inject(ChangeDetectorRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('caseDialog');

  constructor() {
    inject(DestroyRef).onDestroy(() =>
      this.document.documentElement.classList.remove('case-open'),
    );
  }

  protected cycleLayout(delta: number): void {
    const n = this.layouts.length;
    const next = (this.currentPosition() - 1 + delta + n) % n;
    this.setLayout(this.layouts[next].id);
  }

  protected chooseLayout(layout: LayoutId): void {
    this.labOpen.set(false);
    this.setLayout(layout);
  }

  protected setLayout(layout: LayoutId): void {
    if (layout === this.layout()) return;
    withViewTransition(this.document, () => {
      this.layout.set(layout);
      this.changes.detectChanges();
    });
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      // The layout still switches when storage is unavailable.
    }
  }

  protected open({ index, media }: OpenCase): void {
    const dialog = this.dialog()?.nativeElement;
    if (!dialog) return;
    if (media) media.style.viewTransitionName = 'case-media';
    withViewTransition(this.document, () => {
      if (media) media.style.viewTransitionName = '';
      this.openIndex.set(index);
      this.changes.detectChanges();
      if (!dialog.open) dialog.showModal();
      this.document.documentElement.classList.add('case-open');
    });
  }

  protected close(): void {
    const dialog = this.dialog()?.nativeElement;
    const index = this.openIndex();
    if (!dialog || index === null) return;
    const media = this.mediaInLayout(index);
    const transition = withViewTransition(this.document, () => {
      dialog.close();
      this.document.documentElement.classList.remove('case-open');
      if (media) media.style.viewTransitionName = 'case-media';
      this.openIndex.set(null);
      this.changes.detectChanges();
      // After dialog.close(): closing restores focus to whatever was focused
      // before showModal (often a <video>), so return it to the project here.
      this.host
        .querySelector<HTMLElement>(`.layout [data-project="${index}"] button, .layout button[data-project="${index}"]`)
        ?.focus({ preventScroll: true });
    });
    const clear = () => media && (media.style.viewTransitionName = '');
    if (transition) transition.finished.finally(clear);
    else clear();
  }

  protected step(delta: number): void {
    const index = this.openIndex();
    if (index === null) return;
    const next = (index + delta + this.projects.length) % this.projects.length;
    withViewTransition(this.document, () => {
      this.openIndex.set(next);
      this.changes.detectChanges();
    });
  }

  protected onCancel(event: Event): void {
    event.preventDefault();
    this.close();
  }

  protected onDialogClick(event: MouseEvent): void {
    // A click on the backdrop lands on the <dialog> element itself.
    if (event.target === this.dialog()?.nativeElement) this.close();
  }

  /** The media element of project `index` in the current layout (to morph back into). */
  private mediaInLayout(index: number): HTMLElement | null {
    const candidates = this.host.querySelectorAll<HTMLElement>(
      `.layout [data-project="${index}"] app-project-media, .layout [data-project="${index}"] > app-project-media`,
    );
    for (const candidate of candidates) {
      const box = candidate.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return candidate;
    }
    return null;
  }

  /** `?projects=<layout>` (shareable) wins, then the saved choice, then the wall. */
  private initialLayout(): LayoutId {
    const fromUrl = this.document.defaultView
      ? new URL(this.document.defaultView.location.href).searchParams.get('projects')
      : null;
    if (isLayoutId(fromUrl)) return fromUrl;
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (isLayoutId(saved)) return saved;
    } catch {
      // Fall back to the default layout when storage is unavailable.
    }
    return 'wall';
  }
}
