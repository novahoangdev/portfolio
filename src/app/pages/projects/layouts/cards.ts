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
import { canHover, kindLabel, OpenCase, pad, prefersReducedMotion } from './shared';

type Phase = 'sealed' | 'shaking' | 'bursting' | 'open';

interface Metrics {
  readonly w: number;
  readonly h: number;
  readonly cardW: number;
  readonly cardH: number;
  readonly packW: number;
  readonly packH: number;
  readonly packY: number;
}

interface Slot {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly s: number;
  readonly z: number;
  readonly o: number;
}

/** Textures (SVG noise / lighting), kept out of the stylesheets to respect the CSS budget. */
const FELT = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23f)'/%3E%3C/svg%3E")`;
const CRINKLE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='480' preserveAspectRatio='none'%3E%3Cfilter id='c'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.009 0.026' numOctaves='3' seed='11'/%3E%3CfeDiffuseLighting lighting-color='%23fff' surfaceScale='4'%3E%3CfeDistantLight azimuth='235' elevation='38'/%3E%3C/feDiffuseLighting%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23c)'/%3E%3C/svg%3E")`;
const FIBRES = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='6'%3E%3Cpath d='M0 6V3l3-2 2 3 4-3 3 2 2-2 4 3 3-2 3 2v3z' fill='%23f6f0e0'/%3E%3C/svg%3E")`;

/** Crimped edge (zig-zag teeth) for the foil pack, top or bottom. */
function crimp(edge: 'top' | 'bottom', teeth: number, depth: number): string {
  const points: string[] = [];
  const y = (raised: boolean) =>
    edge === 'top' ? (raised ? '0px' : `${depth}px`) : raised ? '100%' : `calc(100% - ${depth}px)`;
  for (let i = 0; i <= teeth * 2; i++) {
    const x = ((i / (teeth * 2)) * 100).toFixed(2);
    points.push(`${x}% ${y(i % 2 === 1)}`);
  }
  return edge === 'top'
    ? `polygon(${points.join(', ')}, 100% 100%, 0% 100%)`
    : `polygon(0% 0%, 100% 0%, ${points.reverse().join(', ')})`;
}

/** Deterministic pseudo-random in [-1, 1] from an index (no Math.random so renders stay stable). */
function jitter(i: number, salt: number): number {
  const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}

/** The sealed foil booster pack (its own component so each stylesheet stays within budget). */
@Component({
  selector: 'app-cards-pack',
  styleUrl: './cards-pack.css',
  host: { '[style.--crinkle]': 'crinkle', '[style.--fibres]': 'fibres' },
  template: `
    <div class="pack-shadow" aria-hidden="true"></div>
    <div class="pack-float">
      <div class="pack-tilt">
        <div class="pack" aria-hidden="true" (click)="pick.emit()">
          <span class="pack-top foil" [style.clip-path]="topClip">
            <span class="crimp"></span>
            <span class="pack-maker">Nova Hoang · Side Projects</span>
          </span>
          <span class="tear-gap"><span class="tear-peek"></span></span>
          <span class="pack-body foil" [style.clip-path]="bodyClip">
            <span class="crimp crimp-bottom"></span>
            <span class="pack-emblem" [style.--emblem]="emblem()">
              <span class="emblem-core">
                <span class="emblem-star">✦</span>
                <span class="emblem-set">S·01</span>
              </span>
            </span>
            <span class="pack-title">Side<br />Projects</span>
            <span class="pack-series">Series 01</span>
            <span class="pack-foot">
              <span>{{ count() }} project cards</span>
              <span>Booster pack</span>
            </span>
          </span>
          <span class="tear-strip">
            <span class="tear-notch"></span>
            <span class="tear-text">Tear here</span>
            <span class="tear-arrow">⟶</span>
          </span>
        </div>
      </div>
    </div>
    <div class="burst" aria-hidden="true"></div>
  `,
})
export class CardsPack {
  readonly count = input.required<number>();
  readonly emblem = input.required<string>();
  readonly pick = output<void>();
  protected readonly topClip = crimp('top', 22, 7);
  protected readonly bodyClip = crimp('bottom', 22, 7);
  protected readonly crinkle = CRINKLE;
  protected readonly fibres = FIBRES;
}

/**
 * Layout — Booster Pack. A sealed foil pack floats on a felt mat; tear the strip
 * (or press "Open pack") and the project cards burst out into a fanned hand.
 * Holo cards tilt toward the pointer; pick one to inspect it, pick again to open.
 */
@Component({
  selector: 'app-projects-cards',
  imports: [ProjectMediaView, CardsPack],
  templateUrl: './cards.html',
  styleUrl: './cards.css',
})
export class ProjectsCards {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;
  protected readonly felt = FELT;

  protected readonly phase = signal<Phase>('sealed');
  protected readonly selected = signal<number | null>(null);
  protected readonly hovered = signal<number | null>(null);
  protected readonly front = signal(0);
  protected readonly mobile = signal(false);
  protected readonly reduced = signal(false);
  /** Off screen: the pack's idle loops (bob, glint, emblem) and the foil shimmer pause. */
  protected readonly offscreen = signal(false);
  protected readonly m = signal<Metrics>({
    w: 1200,
    h: 720,
    cardW: 236,
    cardH: 330,
    packW: 280,
    packH: 440,
    packY: 340,
  });

  /** Every project's accent around the pack's emblem. */
  protected readonly emblem = computed(() => {
    const accents = this.projects().map((p) => p.accent);
    const step = 100 / accents.length;
    return `conic-gradient(from -90deg, ${accents
      .map((c, i) => `${c} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`)
      .join(', ')})`;
  });

  protected readonly cardsLive = computed(() => this.phase() === 'bursting' || this.phase() === 'open');

  protected readonly selScale = computed(() => {
    const { w, h, cardW, cardH } = this.m();
    return Math.min((h * 0.7) / cardH, (w * 0.4) / cardW, 1.75);
  });

  protected readonly slots = computed<readonly Slot[]>(() => {
    const n = this.projects().length;
    const { w, h, cardW, cardH } = this.m();
    const sel = this.selected();
    const hov = this.hovered();

    if (this.mobile()) {
      const front = this.front();
      const cy = 62 + cardH / 2 + 34;
      return this.projects().map((_, i) => {
        const k = (i - front + n) % n;
        const depth = Math.min(k, 3);
        return {
          x: depth * 4 * (k % 2 ? 1 : -1),
          y: cy - depth * 15,
          r: k === 0 ? 0 : (k % 2 ? 1 : -1) * (1.5 + depth * 1.2),
          s: 1 - depth * 0.055,
          z: n - k,
          o: k > 3 ? 0 : 1,
        };
      });
    }

    const spacing = Math.min(cardW * 0.7, (w - cardW * 1.7) / Math.max(1, n - 1));
    const rotStep = Math.min(4.2, 30 / Math.max(1, n - 1));
    const baseY = h - cardH / 2 - Math.max(56, h * 0.1);
    const sink = sel !== null ? cardH * 0.58 : 0;
    const selScale = this.selScale();

    return this.projects().map((_, i) => {
      const t = i - (n - 1) / 2;
      let x = t * spacing;
      let y = baseY + t * t * 3.5 + sink;
      let r = t * rotStep;
      let s = 1;
      let z = i + 1;
      if (sel === i) {
        return { x: 0, y: h * 0.45, r: 0, s: selScale, z: 200, o: 1 };
      }
      if (sel === null && hov !== null) {
        if (hov === i) {
          y -= cardH * 0.22;
          r *= 0.3;
          s = 1.07;
          z = 100;
        } else {
          const d = i - hov;
          x += (Math.sign(d) * spacing * 0.5) / Math.abs(d);
        }
      }
      return { x, y, r, s, z, o: 1 };
    });
  });

  private readonly document = inject(DOCUMENT);
  private readonly mat = viewChild.required<ElementRef<HTMLElement>>('mat');
  private timers: number[] = [];
  /** When the last drag (tear or swipe) moved, so the click that ends it is ignored. */
  private swipedAt = 0;
  private focusAfterOpen = false;

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      if (!view) return;
      const mat = this.mat().nativeElement;
      const reduced = prefersReducedMotion(view);
      const hover = canHover(view);
      this.reduced.set(reduced);
      const narrow = view.matchMedia('(max-width: 640px)');

      const measure = () => {
        const mobile = narrow.matches;
        const w = mat.clientWidth;
        if (mobile) {
          const cardW = Math.min(w * 0.7, 290);
          const cardH = cardW * 1.4;
          const packW = Math.min(w * 0.58, 236);
          const packH = packW * 1.56;
          const h = Math.max(cardH + 196, packH + 204);
          this.m.set({ w, h, cardW, cardH, packW, packH, packY: 52 + packH / 2 + 18 });
        } else {
          const h = mat.clientHeight;
          const cardH = Math.min(h * 0.44, 340, ((w - 64) / 5.2) * 1.4);
          const cardW = cardH / 1.4;
          const packH = Math.min(h * 0.64, 470);
          const packW = packH * 0.64;
          this.m.set({ w, h, cardW, cardH, packW, packH, packY: h * 0.47 });
        }
        this.mobile.set(mobile);
      };
      measure();
      const resize = new ResizeObserver(measure);
      resize.observe(mat);
      const io = new IntersectionObserver(([entry]) => this.offscreen.set(!entry?.isIntersecting));
      io.observe(mat);

      // --- Pointer: pack tilt + card holo tilt (native, no change detection per move) ---
      let lastCard: HTMLElement | null = null;
      const resetCard = (card: HTMLElement | null) => {
        if (!card) return;
        card.style.removeProperty('--rx');
        card.style.removeProperty('--ry');
        card.style.removeProperty('--mx');
        card.style.removeProperty('--my');
        card.style.removeProperty('--hyp');
      };
      const onMove = (event: PointerEvent) => {
        if (reduced || event.pointerType !== 'mouse') return;
        const phase = this.phase();
        if (phase === 'sealed') {
          const tilt = mat.querySelector<HTMLElement>('.pack-tilt');
          if (!tilt) return;
          const box = tilt.getBoundingClientRect();
          const dx = Math.max(-1, Math.min(1, (event.clientX - (box.left + box.width / 2)) / (box.width * 1.4)));
          const dy = Math.max(-1, Math.min(1, (event.clientY - (box.top + box.height / 2)) / (box.height * 1.2)));
          tilt.style.setProperty('--tx', `${(dx * 16).toFixed(2)}deg`);
          tilt.style.setProperty('--ty', `${(-dy * 12).toFixed(2)}deg`);
          tilt.style.setProperty('--sx', `${(50 + dx * 50).toFixed(1)}%`);
          tilt.style.setProperty('--sy', `${(50 + dy * 50).toFixed(1)}%`);
          return;
        }
        if (!hover || this.mobile()) return;
        const card = (event.target as Element | null)?.closest<HTMLElement>('.card') ?? null;
        if (card !== lastCard) {
          resetCard(lastCard);
          lastCard = card;
        }
        if (!card) return;
        const box = card.getBoundingClientRect();
        const px = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
        const py = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
        card.style.setProperty('--rx', `${((0.5 - py) * 18).toFixed(2)}deg`);
        card.style.setProperty('--ry', `${((px - 0.5) * 22).toFixed(2)}deg`);
        card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
        card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
        card.style.setProperty('--hyp', Math.min(1, Math.hypot(px - 0.5, py - 0.5) * 2).toFixed(3));
      };
      const onLeave = () => {
        resetCard(lastCard);
        lastCard = null;
        const tilt = mat.querySelector<HTMLElement>('.pack-tilt');
        tilt?.style.removeProperty('--tx');
        tilt?.style.removeProperty('--ty');
      };

      // --- Tear strip drag ---
      let tearId: number | null = null;
      let tearStartX = 0;
      let tear = 0;
      const setTear = (value: number) => {
        tear = value;
        mat.querySelector<HTMLElement>('.pack')?.style.setProperty('--tear', value.toFixed(3));
      };
      const onDown = (event: PointerEvent) => {
        const strip = (event.target as Element | null)?.closest<HTMLElement>('.tear-strip');
        if (strip && this.phase() === 'sealed' && event.button === 0) {
          tearId = event.pointerId;
          tearStartX = event.clientX;
          strip.setPointerCapture(event.pointerId);
          mat.querySelector('.pack')?.classList.add('is-tearing');
          event.preventDefault();
          return;
        }
        onSwipeDown(event);
      };
      const onTearMove = (event: PointerEvent) => {
        if (tearId !== event.pointerId) return;
        const strip = mat.querySelector<HTMLElement>('.tear-strip');
        if (!strip) return;
        if (Math.abs(event.clientX - tearStartX) > 6) this.swipedAt = performance.now();
        const box = strip.getBoundingClientRect();
        const progress = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
        setTear(Math.max(tear * 0.96, progress));
        if (tear > 0.88) {
          tearId = null;
          this.open();
        }
      };
      const onTearUp = (event: PointerEvent) => {
        if (tearId !== event.pointerId) return;
        tearId = null;
        mat.querySelector('.pack')?.classList.remove('is-tearing');
        if (tear > 0.6) this.open();
        else setTear(0);
      };

      // --- Mobile: swipe the front card of the stack ---
      let swipeId: number | null = null;
      let sx = 0;
      let sy = 0;
      let lastX = 0;
      let lastT = 0;
      let vx = 0;
      let dragging = false;
      let slotEl: HTMLElement | null = null;
      const onSwipeDown = (event: PointerEvent) => {
        if (!this.mobile() || this.phase() !== 'open') return;
        const slot = (event.target as Element | null)?.closest<HTMLElement>('.slot.is-front');
        if (!slot) return;
        swipeId = event.pointerId;
        sx = lastX = event.clientX;
        sy = event.clientY;
        lastT = performance.now();
        vx = 0;
        dragging = false;
        slotEl = slot;
      };
      const onSwipeMove = (event: PointerEvent) => {
        if (swipeId !== event.pointerId || !slotEl) return;
        const dx = event.clientX - sx;
        const dy = event.clientY - sy;
        if (!dragging) {
          if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
          dragging = true;
          slotEl.classList.add('is-dragging');
        }
        const now = performance.now();
        this.swipedAt = now;
        vx = (event.clientX - lastX) / Math.max(1, now - lastT);
        lastX = event.clientX;
        lastT = now;
        slotEl.style.setProperty('--dx', `${dx}px`);
        slotEl.style.setProperty('--drot', `${dx * 0.06}deg`);
      };
      const onSwipeUp = (event: PointerEvent) => {
        if (swipeId !== event.pointerId || !slotEl) return;
        swipeId = null;
        const slot = slotEl;
        slotEl = null;
        slot.classList.remove('is-dragging');
        if (!dragging) return;
        const dx = event.clientX - sx;
        if (Math.abs(dx) > 70 || Math.abs(vx) > 0.55) {
          const dir = Math.sign(dx || vx);
          slot.style.setProperty('--dx', `${dir * mat.clientWidth}px`);
          slot.style.setProperty('--drot', `${dir * 24}deg`);
          this.later(() => {
            slot.style.removeProperty('--dx');
            slot.style.removeProperty('--drot');
            this.step(dir < 0 ? 1 : -1);
          }, reduced ? 0 : 200);
        } else {
          slot.style.removeProperty('--dx');
          slot.style.removeProperty('--drot');
        }
      };

      const onPointerMove = (event: PointerEvent) => {
        onMove(event);
        onTearMove(event);
        onSwipeMove(event);
      };
      const onPointerUp = (event: PointerEvent) => {
        onTearUp(event);
        onSwipeUp(event);
      };

      mat.addEventListener('pointermove', onPointerMove);
      mat.addEventListener('pointerleave', onLeave);
      mat.addEventListener('pointerdown', onDown);
      mat.addEventListener('pointerup', onPointerUp);
      mat.addEventListener('pointercancel', onPointerUp);

      cleanup = () => {
        resize.disconnect();
        io.disconnect();
        mat.removeEventListener('pointermove', onPointerMove);
        mat.removeEventListener('pointerleave', onLeave);
        mat.removeEventListener('pointerdown', onDown);
        mat.removeEventListener('pointerup', onPointerUp);
        mat.removeEventListener('pointercancel', onPointerUp);
      };
    });

    inject(DestroyRef).onDestroy(() => {
      cleanup();
      this.timers.forEach((t) => clearTimeout(t));
    });
  }

  /** Small per-card randomness for the burst, stable across renders. */
  protected burst(i: number): { sr: string; br: string; lift: string; bx: string } {
    return {
      sr: `${(jitter(i, 1) * 14).toFixed(1)}deg`,
      br: `${(jitter(i, 2) * 40).toFixed(1)}deg`,
      lift: `${Math.round(60 + (jitter(i, 3) + 1) * 50)}px`,
      bx: `${Math.round(jitter(i, 4) * 220)}px`,
    };
  }

  protected typeLine(project: SideProject): string {
    return project.kinds.map((k) => kindLabel(k)).join(' · ');
  }

  protected playing(i: number): 'on' | 'off' {
    if (!this.cardsLive()) return 'off';
    const sel = this.selected();
    if (sel !== null) return sel === i ? 'on' : 'off';
    if (this.mobile()) return this.front() === i ? 'on' : 'off';
    return this.hovered() === i ? 'on' : 'off';
  }

  protected cardLabel(project: SideProject, i: number): string {
    if (this.mobile() ? this.front() === i : this.selected() === i) return `Open ${project.name} case study`;
    return `${project.name} — ${project.tagline}`;
  }

  /** Tear the pack open: shake, the top flies off, then the cards burst out. */
  protected open(): void {
    if (this.phase() !== 'sealed') return;
    const mat = this.mat().nativeElement;
    const pack = mat.querySelector<HTMLElement>('.pack');
    this.focusAfterOpen = !!mat.querySelector('.pack-cta .btn-open:focus-visible');
    pack?.classList.remove('is-tearing');
    pack?.style.setProperty('--tear', '1');
    if (this.reduced()) {
      this.phase.set('open');
      this.afterOpen();
      return;
    }
    this.phase.set('shaking');
    this.later(() => this.phase.set('bursting'), 520);
    const n = this.projects().length;
    this.later(() => {
      this.phase.set('open');
      this.afterOpen();
    }, 520 + 1150 + n * 110);
  }

  protected reseal(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.selected.set(null);
    this.hovered.set(null);
    this.front.set(0);
    this.phase.set('sealed');
    // Focus the way back in once the pack re-renders.
    this.later(() => this.mat().nativeElement.querySelector<HTMLElement>('.btn-open')?.focus(), 30);
  }

  protected hover(i: number | null): void {
    if (this.mobile() || !this.cardsLive()) return;
    this.hovered.set(i);
  }

  protected onCard(i: number, event: MouseEvent): void {
    event.stopPropagation();
    if (this.justDragged()) return;
    if (this.phase() !== 'open') return;
    if (this.mobile()) {
      if (this.front() === i) this.emitOpen(i);
      else this.front.set(i);
      return;
    }
    if (this.selected() === i) this.emitOpen(i);
    else {
      this.selected.set(i);
      this.hovered.set(null);
    }
  }

  protected onCardFocus(i: number): void {
    if (this.phase() !== 'open') return;
    if (this.mobile()) this.front.set(i);
    else if (this.selected() === null) this.hovered.set(i);
  }

  protected onMatClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (this.selected() !== null && !target?.closest('.card, button')) this.selected.set(null);
  }

  protected onPackClick(): void {
    if (this.justDragged()) return;
    this.open();
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.selected() !== null) {
      const sel = this.selected();
      this.selected.set(null);
      event.preventDefault();
      event.stopPropagation();
      this.focusCard(sel);
      return;
    }
    if (this.phase() !== 'open') return;
    const inCard = (event.target as Element | null)?.closest('.card');
    if (!inCard) return;
    const n = this.projects().length;
    const current = this.mobile() ? this.front() : (this.selected() ?? this.hovered() ?? 0);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (current + 1) % n;
    else if (event.key === 'ArrowLeft') next = (current - 1 + n) % n;
    if (next === null) return;
    event.preventDefault();
    if (this.selected() !== null) this.selected.set(next);
    this.focusCard(next);
  }

  protected step(delta: number): void {
    const n = this.projects().length;
    this.front.update((f) => (f + delta + n) % n);
  }

  protected openSelected(): void {
    const i = this.mobile() ? this.front() : this.selected();
    if (i !== null) this.emitOpen(i);
  }

  protected deselect(): void {
    const sel = this.selected();
    this.selected.set(null);
    this.focusCard(sel);
  }

  private justDragged(): boolean {
    return performance.now() - this.swipedAt < 400;
  }

  private emitOpen(index: number): void {
    const media = this.mat().nativeElement.querySelector<HTMLElement>(
      `.slot[data-project="${index}"] app-project-media`,
    );
    this.openCase.emit({ index, media });
  }

  private focusCard(i: number | null): void {
    if (i === null) return;
    this.later(
      () =>
        this.mat()
          .nativeElement.querySelector<HTMLElement>(`.slot[data-project="${i}"] .card`)
          ?.focus({ preventScroll: true }),
      0,
    );
  }

  private afterOpen(): void {
    if (this.focusAfterOpen) this.focusCard(0);
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(setTimeout(fn, ms) as unknown as number);
  }
}
