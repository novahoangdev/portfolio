import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
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
import { SideProject } from '../../../data/projects';
import { ProjectMediaView } from '../project-media';
import { kindLabel, OpenCase, pad, prefersReducedMotion } from './shared';

/** Seconds each story stays on screen. */
const STORY_SECONDS = 7;
/** Venetian blinds: slice count, per-slice duration and stagger (ms). */
const SLICES = 10;
const SLICE_MS = 900;
const SLICE_STAGGER = 55;
const BLINDS_MS = SLICE_MS + SLICE_STAGGER * (SLICES - 1);

interface Blinds {
  readonly key: number;
  readonly index: number;
  readonly forward: boolean;
  readonly done: boolean;
}

/** Layout — full-bleed cinematic stories: auto-advancing, tap the sides to skip. */
@Component({
  selector: 'app-projects-cinema',
  imports: [ProjectMediaView],
  templateUrl: './cinema.html',
  styleUrl: './cinema.css',
})
export class ProjectsCinema {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  private readonly doc = inject(DOCUMENT);
  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;
  protected readonly slices = Array.from({ length: SLICES }, (_, k) => k);
  protected readonly storySeconds = STORY_SECONDS;
  protected readonly sliceMs = SLICE_MS;
  protected readonly sliceStagger = SLICE_STAGGER;

  /** Story the progress bars and ambient light point at (changes immediately). */
  protected readonly index = signal(0);
  /** Story whose title / tagline is shown (changes mid-transition). */
  protected readonly text = signal(0);
  /** Story whose media is mounted (changes when the blinds have closed). */
  protected readonly media = signal(0);
  protected readonly blinds = signal<Blinds | null>(null);
  protected readonly leaving = signal(false);
  /** Bumped on every navigation so the active progress bar restarts. */
  protected readonly epoch = signal(0);

  protected readonly hovering = signal(false);
  protected readonly holding = signal(false);
  protected readonly userPaused = signal(false);
  protected readonly onScreen = signal(false);
  protected readonly caseOpen = signal(false);
  protected readonly hidden = signal(false);
  protected readonly reduced = prefersReducedMotion(this.doc.defaultView);

  protected readonly paused = computed(
    () =>
      this.reduced ||
      this.hovering() ||
      this.holding() ||
      this.userPaused() ||
      !this.onScreen() ||
      this.caseOpen() ||
      this.hidden(),
  );
  /** Paused by the viewer (shown as a pill), not just scrolled away. */
  protected readonly heldByUser = computed(
    () => !this.reduced && (this.hovering() || this.holding() || this.userPaused()),
  );
  protected readonly videoOn = computed(() => this.onScreen() && !this.caseOpen() && !this.hidden());

  protected readonly titleWords = computed(() => {
    const name = this.projects()[this.text()]?.name ?? '';
    let n = 0;
    return name.split(' ').map((word) => [...word].map((ch) => ({ ch, i: n++ })));
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private timers: number[] = [];
  private blindKey = 0;
  private suppressClick = false;

  constructor() {
    const doc = this.doc;
    const view = doc.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      if (!view) return;
      const stage = this.stage().nativeElement;

      const io = new IntersectionObserver(([entry]) => this.onScreen.set(!!entry?.isIntersecting), {
        threshold: 0.35,
      });
      io.observe(stage);

      const html = doc.documentElement;
      const mo = new MutationObserver(() => this.caseOpen.set(html.classList.contains('case-open')));
      mo.observe(html, { attributes: true, attributeFilter: ['class'] });

      const onVisibility = () => this.hidden.set(doc.visibilityState !== 'visible');
      doc.addEventListener('visibilitychange', onVisibility);

      // Hover pauses (mouse only); press-and-hold pauses (any pointer).
      let downAt = 0;
      let downId: number | null = null;
      const onEnter = (event: PointerEvent) => event.pointerType === 'mouse' && this.hovering.set(true);
      const onLeave = (event: PointerEvent) => {
        if (event.pointerType === 'mouse') this.hovering.set(false);
        release(event);
      };
      const onDown = (event: PointerEvent) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('.chrome-btn, .open')) return;
        downId = event.pointerId;
        downAt = performance.now();
        this.suppressClick = false;
        this.holding.set(true);
      };
      const release = (event: PointerEvent) => {
        if (downId !== event.pointerId) return;
        downId = null;
        this.holding.set(false);
        // A long press was a pause, not a tap.
        if (performance.now() - downAt > 280) this.suppressClick = true;
      };
      const onMenu = (event: Event) => {
        if (downId !== null) event.preventDefault();
      };
      stage.addEventListener('pointerenter', onEnter);
      stage.addEventListener('pointerleave', onLeave);
      stage.addEventListener('pointerdown', onDown);
      stage.addEventListener('pointerup', release);
      stage.addEventListener('pointercancel', release);
      stage.addEventListener('contextmenu', onMenu);

      cleanup = () => {
        io.disconnect();
        mo.disconnect();
        doc.removeEventListener('visibilitychange', onVisibility);
        stage.removeEventListener('pointerenter', onEnter);
        stage.removeEventListener('pointerleave', onLeave);
        stage.removeEventListener('pointerdown', onDown);
        stage.removeEventListener('pointerup', release);
        stage.removeEventListener('pointercancel', release);
        stage.removeEventListener('contextmenu', onMenu);
      };
    });

    inject(DestroyRef).onDestroy(() => {
      cleanup();
      this.clearTimers();
    });
  }

  protected go(delta: number): void {
    const n = this.projects().length;
    this.goTo((this.index() + delta + n) % n, delta >= 0);
  }

  protected goTo(next: number, forward = next > this.index()): void {
    if (next === this.index()) return;
    this.clearTimers();
    this.index.set(next);
    this.epoch.update((e) => e + 1);

    if (this.reduced) {
      // Simple crossfade: everything swaps, the story layer fades in.
      this.blinds.set(null);
      this.leaving.set(false);
      this.text.set(next);
      this.media.set(next);
      return;
    }

    this.leaving.set(true);
    this.blinds.set({ key: ++this.blindKey, index: next, forward, done: false });
    this.later(() => {
      this.text.set(next);
      this.leaving.set(false);
    }, 420);
    this.later(() => {
      this.media.set(next);
      this.blinds.update((b) => (b && b.index === next ? { ...b, done: true } : b));
    }, BLINDS_MS);
    this.later(() => this.blinds.update((b) => (b && b.index === next ? null : b)), BLINDS_MS + 800);
  }

  /** The active progress bar finished filling. */
  protected onFilled(): void {
    if (!this.paused()) this.go(1);
  }

  protected onZone(delta: number): void {
    if (this.consumeHold()) return;
    this.go(delta);
  }

  protected onStory(): void {
    if (this.consumeHold()) return;
    this.openActive();
  }

  protected togglePause(): void {
    this.userPaused.update((p) => !p);
  }

  protected openActive(): void {
    const index = this.index();
    const media = this.host.querySelector<HTMLElement>(`.story[data-project="${index}"] app-project-media`);
    this.openCase.emit({ index, media });
  }

  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const onOwnButton = target !== event.currentTarget && target.closest('button') && !target.closest('.story');
    switch (event.key) {
      case 'ArrowRight':
        this.go(1);
        break;
      case 'ArrowLeft':
        this.go(-1);
        break;
      case ' ':
        if (onOwnButton) return;
        this.go(1);
        break;
      case 'Enter':
        if (onOwnButton || target.closest('.story')) return;
        this.openActive();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  protected sliceDelay(k: number, forward: boolean): number {
    return (forward ? k : SLICES - 1 - k) * SLICE_STAGGER;
  }

  private consumeHold(): boolean {
    const held = this.suppressClick;
    this.suppressClick = false;
    return held;
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private clearTimers(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }
}
