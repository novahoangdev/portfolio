import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  inputBinding,
  outputBinding,
  signal,
  Type,
  viewChild,
  ViewContainerRef,
} from '@angular/core';
import { sideProjects } from '../../data/projects';
import { contact } from '../../data/profile';
import { Reveal } from '../../directives/reveal';
import { loadLayout } from './layouts/loaders';
import { isLayoutId, LayoutId, layoutOptions } from './layouts/registry';
import { kindLabel, OpenCase, pad, withViewTransition } from './layouts/shared';
import { ProjectMediaView } from './project-media';

const LAYOUT_KEY = 'portfolio-projects-layout';
/** Shown until a visitor picks another layout. */
const DEFAULT_LAYOUT: LayoutId = 'ide';

/**
 * Side projects with interchangeable layouts (see `layouts/registry.ts`) and one shared case-study dialog. The chosen layout is remembered
 * per browser.
 */
@Component({
  selector: 'app-projects',
  imports: [ProjectMediaView, Reveal],
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
  /** The switcher shows where it is heading right away, even while that layout loads. */
  private readonly shown = computed(() => this.pendingLayout() ?? this.layout());
  protected readonly current = computed(
    () => this.layouts.find((l) => l.id === this.shown()) ?? this.layouts[0],
  );
  protected readonly currentPosition = computed(
    () => this.layouts.findIndex((l) => l.id === this.shown()) + 1,
  );
  protected readonly technologies = [...new Set(sideProjects.flatMap((p) => p.technologies))];

  protected readonly openIndex = signal<number | null>(null);
  protected readonly openProject = computed(() => {
    const index = this.openIndex();
    return index === null ? null : this.projects[index];
  });

  /** The layout the switcher is heading to while its chunk loads. */
  protected readonly pendingLayout = signal<LayoutId | null>(null);
  protected readonly mounted = signal(false);

  private readonly changes = inject(ChangeDetectorRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('caseDialog');
  private readonly outlet = viewChild.required('outlet', { read: ViewContainerRef });
  private readonly switcher = viewChild.required<ElementRef<HTMLElement>>('switcher');
  private switchToken = 0;
  /** Layout videos paused while a case is open (resumed on close). */
  private pausedVideos: HTMLVideoElement[] = [];

  constructor() {
    afterNextRender(() => {
      const layout = this.layout();
      loadLayout(layout).then((component) => {
        if (this.layout() !== layout || this.mounted()) return;
        this.mount(component);
        this.changes.detectChanges();
        this.prefetchAround(layout);
      });
    });
    inject(DestroyRef).onDestroy(() =>
      this.document.documentElement.classList.remove('case-open'),
    );
  }

  protected cycleLayout(delta: number): void {
    const n = this.layouts.length;
    const from = this.layouts.findIndex((l) => l.id === (this.pendingLayout() ?? this.layout()));
    this.setLayout(this.layouts[(from + delta + n) % n].id);
  }

  protected chooseLayout(layout: LayoutId): void {
    this.labOpen.set(false);
    this.setLayout(layout);
  }

  /** Warm a layout's chunk (lab option hover / focus). */
  protected prefetch(layout: LayoutId): void {
    loadLayout(layout).catch(() => {
      // Loaded again (and reported) when actually chosen.
    });
  }

  protected async setLayout(layout: LayoutId): Promise<void> {
    if (layout === (this.pendingLayout() ?? this.layout())) return;
    const token = ++this.switchToken;
    this.pendingLayout.set(layout);
    let component: Type<unknown>;
    try {
      component = await loadLayout(layout);
    } catch {
      if (token === this.switchToken) this.pendingLayout.set(null);
      return;
    }
    if (token !== this.switchToken) return;

    // Keep the switcher where it is on screen while the layout below changes height.
    const anchor = this.switcher().nativeElement;
    const before = anchor.getBoundingClientRect().top;
    withViewTransition(
      this.document,
      () => {
        this.pendingLayout.set(null);
        this.layout.set(layout);
        this.mount(component);
        this.changes.detectChanges();
        const drift = anchor.getBoundingClientRect().top - before;
        if (Math.abs(drift) > 1) this.document.defaultView?.scrollBy({ top: drift, behavior: 'instant' });
      },
      'layout',
    );
    this.prefetchAround(layout);
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      // The layout still switches when storage is unavailable.
    }
  }

  protected async open({ index, media }: OpenCase): Promise<void> {
    const dialog = this.dialog()?.nativeElement;
    if (!dialog || dialog.open) return;
    // Decode the case poster first so the morph lands on a picture, not an empty frame.
    await decoded(this.projects[index].media.image, 250);
    this.pauseLayoutVideos();
    if (media) media.style.viewTransitionName = 'case-media';
    withViewTransition(
      this.document,
      () => {
        if (media) media.style.viewTransitionName = '';
        this.openIndex.set(index);
        this.changes.detectChanges();
        if (!dialog.open) dialog.showModal();
        this.document.documentElement.classList.add('case-open');
      },
      'case',
    );
  }

  protected close(): void {
    const dialog = this.dialog()?.nativeElement;
    const index = this.openIndex();
    if (!dialog || index === null) return;
    const media = this.mediaInLayout(index);
    const transition = withViewTransition(
      this.document,
      () => {
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
      },
      'case',
    );
    const done = () => {
      if (media) media.style.viewTransitionName = '';
      this.resumeLayoutVideos();
    };
    if (transition) transition.finished.finally(done);
    else done();
  }

  protected async step(delta: number): Promise<void> {
    const index = this.openIndex();
    if (index === null) return;
    const next = (index + delta + this.projects.length) % this.projects.length;
    await decoded(this.projects[next].media.image, 200);
    if (this.openIndex() !== index) return;
    withViewTransition(
      this.document,
      () => {
        this.openIndex.set(next);
        this.changes.detectChanges();
      },
      'case',
    );
  }

  protected onCancel(event: Event): void {
    event.preventDefault();
    this.close();
  }

  protected onDialogClick(event: MouseEvent): void {
    // A click on the backdrop lands on the <dialog> element itself.
    if (event.target === this.dialog()?.nativeElement) this.close();
  }

  private mount(component: Type<unknown>): void {
    const outlet = this.outlet();
    outlet.clear();
    outlet.createComponent(component, {
      bindings: [
        inputBinding('projects', () => this.projects),
        outputBinding<OpenCase>('openCase', (event) => void this.open(event)),
      ],
    });
    this.mounted.set(true);
  }

  /** Warm the neighbours so Prev / Next switch without waiting for the network. */
  private prefetchAround(layout: LayoutId): void {
    const view = this.document.defaultView;
    const n = this.layouts.length;
    const at = this.layouts.findIndex((l) => l.id === layout);
    const warm = () => {
      this.prefetch(this.layouts[(at + 1) % n].id);
      this.prefetch(this.layouts[(at - 1 + n) % n].id);
    };
    if (view && 'requestIdleCallback' in view) view.requestIdleCallback(warm, { timeout: 3000 });
    else setTimeout(warm, 1200);
  }

  /** The dimmed page behind the case stays still: cheaper backdrop blur, calmer eye. */
  private pauseLayoutVideos(): void {
    this.pausedVideos = [...this.host.querySelectorAll<HTMLVideoElement>('.layout video')].filter(
      (video) => !video.paused,
    );
    this.pausedVideos.forEach((video) => video.pause());
  }

  private resumeLayoutVideos(): void {
    for (const video of this.pausedVideos) {
      if (video.isConnected) {
        video.play().catch(() => {
          // Autoplay can be blocked; the frame stays visible.
        });
      }
    }
    this.pausedVideos = [];
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
    return DEFAULT_LAYOUT;
  }
}

/** Resolve once `src` is decoded (or after `timeout` ms, whichever comes first). */
function decoded(src: string, timeout: number): Promise<void> {
  const image = new Image();
  image.src = src;
  return Promise.race([
    image.decode().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeout)),
  ]);
}
