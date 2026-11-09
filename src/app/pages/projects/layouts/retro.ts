import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { SideProject } from '../../../data/projects';
import { ProjectMediaView } from '../project-media';
import { kindLabel, OpenCase, pad, prefersReducedMotion } from './shared';

/** off = never powered yet, booting = BIOS + logo, ready = desktop, shutdown = switched off by the viewer. */
type OsState = 'off' | 'booting' | 'ready' | 'shutdown';

interface Win {
  readonly id: number;
  /** Project index, or -1 for README.txt. */
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly max: boolean;
  readonly min: boolean;
  /** Waiting for the zoom rectangles to land. */
  readonly hidden: boolean;
  /** Paused by the viewer. */
  readonly paused: boolean;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_PLAYING = 3;
const MIN_W = 300;
const MIN_H = 220;
const INFO_W = 208;
/** Title bar + transport + status bar + frame, in px. */
const CHROME_H = 100;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Playground layout — "NovaOS 98": a late-90s-flavoured desktop where every project is a file you open. */
@Component({
  selector: 'app-projects-retro',
  imports: [ProjectMediaView, NgTemplateOutlet],
  templateUrl: './retro.html',
  styleUrl: './retro.css',
})
export class ProjectsRetro {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;

  protected readonly state = signal<OsState>('off');
  protected readonly wins = signal<readonly Win[]>([]);
  /** Window ids, bottom → top. */
  protected readonly order = signal<readonly number[]>([]);
  /** Selected desktop icon (projects, then README). */
  protected readonly selected = signal(-1);
  protected readonly startOpen = signal(false);
  protected readonly balloon = signal(false);
  protected readonly compact = signal(false);
  protected readonly inView = signal(false);
  protected readonly clock = signal('');
  protected readonly touch = signal(false);

  /** The top visible window. */
  protected readonly active = computed(() => {
    const wins = this.wins();
    const order = this.order();
    for (let i = order.length - 1; i >= 0; i--) {
      const win = wins.find((w) => w.id === order[i]);
      if (win && !win.min && !win.hidden) return win.id;
    }
    return -1;
  });

  /** The top ≤ 3 visible, unpaused video windows play; the rest wait. */
  protected readonly playing = computed(() => {
    const playing = new Set<number>();
    if (!this.inView() || this.state() !== 'ready') return playing;
    const wins = this.wins();
    const list = this.projects();
    const order = this.order();
    for (let i = order.length - 1; i >= 0 && playing.size < MAX_PLAYING; i--) {
      const win = wins.find((w) => w.id === order[i]);
      if (!win || win.index < 0 || win.min || win.hidden || win.paused) continue;
      if (list[win.index]?.media.video) playing.add(win.id);
    }
    return playing;
  });

  private readonly document = inject(DOCUMENT);
  private readonly view = this.document.defaultView;
  private readonly injector = inject(Injector);
  private readonly reduced = prefersReducedMotion(this.view);
  private readonly rigEl = viewChild.required<ElementRef<HTMLElement>>('rig');
  private readonly deskEl = viewChild.required<ElementRef<HTMLElement>>('desk');
  private readonly iconsEl = viewChild.required<ElementRef<HTMLElement>>('icons');
  private readonly zoomEl = viewChild.required<ElementRef<HTMLElement>>('zoom');

  private nextId = 1;
  private deskW = 960;
  private deskH = 600;
  private lastPointer = 'mouse';
  private seekingId = -1;
  private frame = 0;
  private timers: number[] = [];
  private balloonTimer = 0;

  constructor() {
    let cleanup = () => {};

    afterNextRender(() => {
      const view = this.view;
      if (!view) return;
      const desk = this.deskEl().nativeElement;
      this.touch.set(!view.matchMedia('(hover: hover) and (pointer: fine)').matches);

      const measure = () => {
        this.deskW = desk.clientWidth;
        this.deskH = desk.clientHeight;
        this.compact.set(this.deskW < 600);
        this.clampAll();
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(desk);

      const io = new IntersectionObserver(
        ([entry]) => {
          const visible = !!entry?.isIntersecting;
          this.inView.set(visible);
          if (visible && this.state() === 'off') this.boot();
          if (visible) this.startLoop();
        },
        { threshold: 0.3 },
      );
      io.observe(this.rigEl().nativeElement);

      const tick = () => {
        this.clock.set(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
      };
      tick();
      const clockTimer = view.setInterval(tick, 15000);

      // Clicking anywhere else closes the start menu.
      const onDocDown = (event: PointerEvent) => {
        if (!this.startOpen()) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest('.start-menu, .start')) return;
        this.startOpen.set(false);
      };
      this.document.addEventListener('pointerdown', onDocDown, true);

      cleanup = () => {
        ro.disconnect();
        io.disconnect();
        view.clearInterval(clockTimer);
        view.clearTimeout(this.balloonTimer);
        view.cancelAnimationFrame(this.frame);
        this.timers.forEach((id) => view.clearTimeout(id));
        this.document.removeEventListener('pointerdown', onDocDown, true);
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }

  // ── Labels ──────────────────────────────────────────────────────────

  protected fileName(project: SideProject | null): string {
    if (!project) return 'README.txt';
    const slug = project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `${slug}.${project.media.video ? 'mov' : 'bmp'}`;
  }

  /** Desktop label: lets "name.mov" wrap before the extension. */
  protected iconLabel(project: SideProject | null): string {
    return this.fileName(project).replace('.', '\u200b.');
  }

  protected winTitle(win: Win): string {
    const project = win.index >= 0 ? this.projects()[win.index] : null;
    return `${this.fileName(project)} — ${project ? 'NovaPlayer' : 'Notepad'}`;
  }

  protected zOf(id: number): number {
    return 10 + this.order().indexOf(id);
  }

  // ── Boot / power ────────────────────────────────────────────────────

  protected boot(): void {
    this.clearTimers();
    this.startOpen.set(false);
    if (this.reduced) {
      this.state.set('ready');
      this.showBalloon();
      return;
    }
    this.state.set('booting');
    this.later(() => this.finishBoot(), 2700);
  }

  /** Clicking the boot screen skips it. */
  protected finishBoot(): void {
    if (this.state() !== 'booting') return;
    this.clearTimers();
    this.state.set('ready');
    this.later(() => this.showBalloon(), 900);
  }

  protected power(): void {
    const state = this.state();
    if (state === 'off' || state === 'shutdown') this.boot();
    else this.shutdown();
  }

  protected shutdown(): void {
    this.clearTimers();
    this.startOpen.set(false);
    this.balloon.set(false);
    this.wins.set([]);
    this.order.set([]);
    this.state.set('shutdown');
  }

  private showBalloon(): void {
    const view = this.view;
    if (!view) return;
    this.balloon.set(true);
    view.clearTimeout(this.balloonTimer);
    this.balloonTimer = view.setTimeout(() => this.balloon.set(false), 7000);
  }

  // ── Desktop icons ───────────────────────────────────────────────────

  protected onIconDown(event: PointerEvent): void {
    this.lastPointer = event.pointerType;
  }

  /** Mouse: click selects, double-click opens. Touch, pen and keyboard: one activation opens. */
  protected onIconClick(item: number, event: MouseEvent): void {
    this.selected.set(item);
    this.balloon.set(false);
    if (event.detail === 0 || this.lastPointer !== 'mouse') this.openItem(item);
  }

  protected onIconsKey(event: KeyboardEvent): void {
    const vectors: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const icons = Array.from(this.iconsEl().nativeElement.querySelectorAll<HTMLElement>('.icon'));
    let next = -1;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = icons.length - 1;
    else if (vectors[event.key]) {
      const [dx, dy] = vectors[event.key];
      const center = (el: HTMLElement) => {
        const box = el.getBoundingClientRect();
        return [box.left + box.width / 2, box.top + box.height / 2];
      };
      const [cx, cy] = center(icons[this.selected()] ?? icons[0]);
      let best = Infinity;
      icons.forEach((icon, i) => {
        const [x, y] = center(icon);
        const along = (x - cx) * dx + (y - cy) * dy;
        if (along < 8) return;
        const across = Math.abs((x - cx) * dy) + Math.abs((y - cy) * dx);
        const score = along + across * 2.5;
        if (score < best) {
          best = score;
          next = i;
        }
      });
    } else return;
    event.preventDefault();
    if (next < 0) return;
    this.selected.set(next);
    icons[next]?.focus();
  }

  protected onDeskDown(event: PointerEvent): void {
    const target = event.target as HTMLElement;
    if (target === event.currentTarget || target.classList.contains('icons')) this.selected.set(-1);
  }

  // ── Windows ─────────────────────────────────────────────────────────

  /** Open a project (or README for `item === projects.length`), or bring its window back. */
  protected async openItem(item: number): Promise<void> {
    this.startOpen.set(false);
    this.balloon.set(false);
    if (this.state() !== 'ready') return;
    const list = this.projects();
    const index = item >= list.length ? -1 : item;
    const existing = this.wins().find((w) => w.index === index);
    if (existing) {
      if (existing.min) await this.restore(existing);
      else this.focusWin(existing.id, true);
      return;
    }

    const project = index >= 0 ? list[index] : null;
    const box = this.place(project);
    const id = this.nextId++;
    this.wins.update((wins) => [
      ...wins,
      { id, index, ...box, max: false, min: false, hidden: !this.reduced, paused: false },
    ]);
    this.order.update((order) => [...order, id]);

    const from = this.iconRect(index);
    if (from) await this.zoomRects(from, this.targetRect(box));
    this.patch(id, { hidden: false });
    this.focusWin(id, true);
  }

  protected focusWin(id: number, moveFocus = false): void {
    const order = this.order();
    if (order[order.length - 1] !== id) this.order.set([...order.filter((o) => o !== id), id]);
    if (moveFocus) {
      afterNextRender(
        () => this.winEl(id)?.focus({ preventScroll: true }),
        { injector: this.injector },
      );
    }
  }

  protected async closeWin(win: Win): Promise<void> {
    const el = this.winEl(win.id);
    const to = this.iconRect(win.index);
    if (el && to && !win.hidden && !win.min) {
      const from = el.getBoundingClientRect();
      this.patch(win.id, { hidden: true });
      await this.zoomRects(from, to);
    }
    this.wins.update((wins) => wins.filter((w) => w.id !== win.id));
    this.order.update((order) => order.filter((o) => o !== win.id));
    const item = win.index < 0 ? this.projects().length : win.index;
    this.selected.set(item);
    this.iconsEl()
      .nativeElement.querySelector<HTMLElement>(`[data-icon="${item}"]`)
      ?.focus({ preventScroll: true });
  }

  protected async minimise(win: Win): Promise<void> {
    const el = this.winEl(win.id);
    const to = this.taskRect(win.id);
    if (el && to) {
      const from = el.getBoundingClientRect();
      this.patch(win.id, { hidden: true });
      await this.zoomRects(from, to);
    }
    this.patch(win.id, { min: true, hidden: false });
  }

  protected toggleMax(win: Win): void {
    if (this.compact()) return;
    const el = this.winEl(win.id);
    if (el && !this.reduced) {
      el.classList.add('is-morph');
      this.later(() => el.classList.remove('is-morph'), 380);
    }
    this.patch(win.id, { max: !win.max });
  }

  /** Taskbar button: focus, minimise the active window, or restore a minimised one. */
  protected onTask(win: Win): void {
    if (win.min) void this.restore(win);
    else if (this.active() === win.id) void this.minimise(win);
    else this.focusWin(win.id, true);
  }

  protected onWinKey(win: Win, event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    void this.closeWin(win);
  }

  protected togglePlay(win: Win): void {
    this.patch(win.id, { paused: !win.paused && this.playing().has(win.id) });
    this.focusWin(win.id);
  }

  protected restart(win: Win): void {
    const video = this.winEl(win.id)?.querySelector('video');
    if (video) video.currentTime = 0;
    this.patch(win.id, { paused: false });
    this.focusWin(win.id);
  }

  protected seek(win: Win, event: Event): void {
    const range = event.target as HTMLInputElement;
    const video = this.winEl(win.id)?.querySelector('video');
    range.style.setProperty('--p', `${Number(range.value) / 10}%`);
    if (video && Number.isFinite(video.duration)) {
      video.currentTime = (Number(range.value) / 1000) * video.duration;
    }
  }

  protected seekHold(win: Win, holding: boolean): void {
    this.seekingId = holding ? win.id : -1;
  }

  protected openCaseFrom(win: Win): void {
    const media = this.winEl(win.id)?.querySelector<HTMLElement>('app-project-media') ?? null;
    this.openCase.emit({ index: win.index, media });
  }

  protected toggleStart(): void {
    this.balloon.set(false);
    this.startOpen.update((open) => !open);
    if (!this.startOpen()) return;
    afterNextRender(
      () => this.rigEl().nativeElement.querySelector<HTMLElement>('.sm-item')?.focus({ preventScroll: true }),
      { injector: this.injector },
    );
  }

  protected closeStart(): void {
    if (!this.startOpen()) return;
    this.startOpen.set(false);
    this.rigEl().nativeElement.querySelector<HTMLElement>('.start')?.focus();
  }

  protected onStartKey(event: KeyboardEvent): void {
    const items = Array.from(
      this.rigEl().nativeElement.querySelectorAll<HTMLElement>('.start-menu button'),
    );
    const at = items.indexOf(this.document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.closeStart();
    } else if (event.key === 'ArrowDown') items[(at + 1) % items.length]?.focus();
    else if (event.key === 'ArrowUp') items[(at - 1 + items.length) % items.length]?.focus();
    else return;
    event.preventDefault();
  }

  // ── Drag / resize (native pointer work; one signal write at the end) ──

  protected startDrag(win: Win, event: PointerEvent): void {
    if (event.button !== 0 || win.max || this.compact()) return;
    if ((event.target as HTMLElement).closest('button')) return;
    const el = this.winEl(win.id);
    if (!el) return;
    event.preventDefault();
    const bar = event.currentTarget as HTMLElement;
    bar.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    let x = win.x;
    let y = win.y;
    el.classList.add('is-dragging');
    const move = (e: PointerEvent) => {
      x = Math.min(Math.max(0, win.x + e.clientX - startX), this.deskW - win.w);
      y = Math.min(Math.max(0, win.y + e.clientY - startY), this.deskH - win.h);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      el.classList.remove('is-dragging');
      this.patch(win.id, { x, y });
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  }

  protected startResize(win: Win, event: PointerEvent): void {
    if (event.button !== 0) return;
    const el = this.winEl(win.id);
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    const grip = event.currentTarget as HTMLElement;
    grip.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    let w = win.w;
    let h = win.h;
    el.classList.add('is-dragging');
    const move = (e: PointerEvent) => {
      w = Math.min(Math.max(MIN_W, win.w + e.clientX - startX), this.deskW - win.x);
      h = Math.min(Math.max(MIN_H, win.h + e.clientY - startY), this.deskH - win.y);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      el.classList.remove('is-dragging');
      this.patch(win.id, { w, h });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  // ── Internals ───────────────────────────────────────────────────────

  private async restore(win: Win): Promise<void> {
    const from = this.taskRect(win.id);
    this.patch(win.id, { min: false, hidden: !this.reduced });
    this.focusWin(win.id);
    if (from) await this.zoomRects(from, this.targetRect(win.max ? null : win));
    this.patch(win.id, { hidden: false });
    this.focusWin(win.id, true);
  }

  /** Default size from the media shape, cascaded from the last window, inside the desktop. */
  private place(project: SideProject | null): Box {
    const W = this.deskW;
    const H = this.deskH;
    const count = this.wins().length;
    if (!project) {
      const w = Math.min(420, W - 24);
      const h = Math.min(330, H - 24);
      return { w, h, x: Math.max(0, W - w - 28), y: Math.min(24 + count * 10, H - h) };
    }
    const shape = project.media.shape;
    const ratio = shape === 'portrait' ? 9 / 16 : shape === 'wide' ? 16 / 10 : 4 / 3;
    let mediaH = Math.min(H - CHROME_H - 40, shape === 'portrait' ? 470 : 340);
    let w = Math.max(mediaH * ratio, 320) + INFO_W + 8;
    if (w > W - 24) {
      w = W - 24;
      mediaH = (w - INFO_W - 8) / ratio;
    }
    w = Math.max(MIN_W, Math.round(w));
    const h = Math.max(MIN_H, Math.min(Math.round(mediaH + CHROME_H), H - 16));
    const step = count % 6;
    const x = Math.min(Math.max(0, Math.round(W * 0.2) + step * 30), W - w);
    const y = Math.min(Math.max(0, 18 + step * 26), H - h);
    return { x, y, w, h };
  }

  private clampAll(): void {
    const W = this.deskW;
    const H = this.deskH;
    let changed = false;
    const next = this.wins().map((win) => {
      const w = Math.min(win.w, W);
      const h = Math.min(win.h, H);
      const x = Math.min(Math.max(0, win.x), W - w);
      const y = Math.min(Math.max(0, win.y), H - h);
      if (w === win.w && h === win.h && x === win.x && y === win.y) return win;
      changed = true;
      return { ...win, x, y, w, h };
    });
    if (changed) this.wins.set(next);
  }

  private patch(id: number, change: Partial<Win>): void {
    this.wins.update((wins) => wins.map((w) => (w.id === id ? { ...w, ...change } : w)));
  }

  private winEl(id: number): HTMLElement | null {
    return this.deskEl().nativeElement.querySelector<HTMLElement>(`.win[data-win="${id}"]`);
  }

  private iconRect(index: number): DOMRect | null {
    const item = index < 0 ? this.projects().length : index;
    const glyph = this.iconsEl().nativeElement.querySelector<HTMLElement>(`[data-icon="${item}"] .glyph`);
    const box = glyph?.getBoundingClientRect();
    return box && box.width ? box : null;
  }

  private taskRect(id: number): DOMRect | null {
    const button = this.rigEl().nativeElement.querySelector<HTMLElement>(`.task[data-task="${id}"]`);
    const box = button?.getBoundingClientRect();
    return box && box.width ? box : null;
  }

  /** A window box (desktop px) → viewport rect; null/compact = the whole desktop. */
  private targetRect(box: Box | null): DOMRect {
    const desk = this.deskEl().nativeElement.getBoundingClientRect();
    if (!box || this.compact()) return desk;
    return new DOMRect(desk.left + box.x, desk.top + box.y, box.w, box.h);
  }

  /** The classic outline rectangles stepping from one box to another. */
  private zoomRects(from: DOMRect, to: DOMRect): Promise<void> {
    const view = this.view;
    if (this.reduced || !view) return Promise.resolve();
    const layer = this.zoomEl().nativeElement;
    const base = layer.getBoundingClientRect();
    const scope = Array.from(layer.attributes).find((a) => a.name.startsWith('_ngcontent'));
    const steps = 8;
    const duration = 240;
    for (let i = 0; i < steps; i++) {
      const t = easeOut((i + 1) / steps);
      const rect = this.document.createElement('span');
      rect.className = 'zr';
      if (scope) rect.setAttribute(scope.name, '');
      rect.style.left = `${from.left - base.left + (to.left - from.left) * t}px`;
      rect.style.top = `${from.top - base.top + (to.top - from.top) * t}px`;
      rect.style.width = `${from.width + (to.width - from.width) * t}px`;
      rect.style.height = `${from.height + (to.height - from.height) * t}px`;
      layer.append(rect);
      rect
        .animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], {
          duration: 150,
          delay: (i * duration) / steps,
          fill: 'both',
        })
        .finished.then(
          () => rect.remove(),
          () => rect.remove(),
        );
    }
    return new Promise((resolve) => view.setTimeout(resolve, duration + 30));
  }

  /** Mirror each playing video's time onto its scrubber, without change detection. */
  private startLoop(): void {
    const view = this.view;
    if (!view || this.frame) return;
    const desk = this.deskEl().nativeElement;
    const loop = () => {
      if (!this.inView()) {
        this.frame = 0;
        return;
      }
      desk.querySelectorAll<HTMLElement>('.win[data-win]').forEach((el) => {
        const video = el.querySelector('video');
        const range = el.querySelector<HTMLInputElement>('.seek');
        const time = el.querySelector<HTMLElement>('.time');
        if (!video || !range || !time || !Number.isFinite(video.duration) || !video.duration) return;
        if (Number(el.dataset['win']) !== this.seekingId) {
          const value = (video.currentTime / video.duration) * 1000;
          range.value = String(Math.round(value));
          range.style.setProperty('--p', `${value / 10}%`);
        }
        const label = `${this.mmss(video.currentTime)} / ${this.mmss(video.duration)}`;
        if (time.textContent !== label) time.textContent = label;
      });
      this.frame = view.requestAnimationFrame(loop);
    };
    this.frame = view.requestAnimationFrame(loop);
  }

  private mmss(seconds: number): string {
    const s = Math.floor(seconds);
    return `${Math.floor(s / 60)}:${pad(s % 60)}`;
  }

  private later(fn: () => void, ms: number): void {
    const view = this.view;
    if (view) this.timers.push(view.setTimeout(fn, ms));
  }

  private clearTimers(): void {
    this.timers.forEach((id) => this.view?.clearTimeout(id));
    this.timers = [];
  }
}
