import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
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
  viewChildren,
} from '@angular/core';
import { SideProject } from '../../../data/projects';
import { ProjectMediaView } from '../project-media';
import { canHover, kindLabel, OpenCase, pad, prefersReducedMotion } from './shared';

/** crate = digging; pulling = the sleeve flies out; playing = disc out and spinning; returning = going back in. */
type Phase = 'crate' | 'pulling' | 'playing' | 'returning';

interface SleeveSpring {
  tilt: number;
  tiltVelocity: number;
  lift: number;
  liftVelocity: number;
  /** Lifted out of the crate (being pulled / put back). */
  out: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const BASE_YAW = -14;
/** How far a pulled sleeve rises above the crate floor, in sleeve heights. */
const OUT_LIFT = 0.72;

/** Experimental layout — a record crate: dig through the sleeves, pull one and it plays. */
@Component({
  selector: 'app-projects-vinyl',
  imports: [NgTemplateOutlet, ProjectMediaView],
  templateUrl: './vinyl.html',
  styleUrl: './vinyl.css',
})
export class ProjectsVinyl {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;
  /** The record you are looking at in the crate. */
  protected readonly focus = signal(0);
  protected readonly pulled = signal<number | null>(null);
  protected readonly phase = signal<Phase>('crate');
  protected readonly inView = signal(false);
  protected readonly touch = signal(false);
  protected readonly accent = computed(() => this.projects()[this.pulled() ?? this.focus()].accent);
  private readonly half = computed(() => Math.ceil(this.projects().length / 2));

  private readonly document = inject(DOCUMENT);
  private readonly view = this.document.defaultView;
  private readonly reduced = prefersReducedMotion(this.view);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly world = viewChild.required<ElementRef<HTMLElement>>('world');
  private readonly crate = viewChild.required<ElementRef<HTMLElement>>('crate');
  private readonly sleeves = viewChildren<ElementRef<HTMLElement>>('sleeve');
  private readonly player = viewChild<ElementRef<HTMLElement>>('player');

  private springs: SleeveSpring[] = [];
  /** Continuous dig position: 2.5 = halfway between flipping record 2 and showing record 3. */
  private dig = 0;
  private digTarget = 0;
  private yaw = BASE_YAW;
  private yawTarget = BASE_YAW;
  private hovering = false;
  private frame = 0;
  private running = false;
  private rowMode = false;
  private swiped = false;
  private spin: Animation | null = null;
  private spinFrame = 0;
  private timers: number[] = [];

  constructor() {
    let cleanup = () => {};

    afterNextRender(() => {
      const view = this.view;
      if (!view) return;
      this.springs = this.projects().map(() => ({ tilt: 0, tiltVelocity: 0, lift: 0, liftVelocity: 0, out: false }));
      this.touch.set(!canHover(view));

      const rowQuery = view.matchMedia('(max-width: 640px)');
      const onRowChange = () => {
        this.rowMode = rowQuery.matches;
        if (!this.rowMode) this.kick();
      };
      onRowChange();
      rowQuery.addEventListener('change', onRowChange);

      const io = new IntersectionObserver(([entry]) => this.inView.set(!!entry?.isIntersecting), {
        threshold: 0.15,
      });
      io.observe(this.stage().nativeElement.parentElement ?? this.stage().nativeElement);

      const unbind = this.bindDigging(view);
      cleanup = () => {
        unbind();
        io.disconnect();
        rowQuery.removeEventListener('change', onRowChange);
        view.cancelAnimationFrame(this.frame);
        view.cancelAnimationFrame(this.spinFrame);
        this.timers.forEach((id) => view.clearTimeout(id));
        this.spin?.cancel();
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }

  protected side(index: number): string {
    return index < this.half() ? 'A' : 'B';
  }

  protected onSleeve(index: number): void {
    if (this.swiped) {
      this.swiped = false;
      return;
    }
    void this.pull(index);
  }

  /** Tabbing (or the parent restoring focus) onto a sleeve digs to it. */
  protected onSleeveFocus(index: number): void {
    if (index !== Math.round(this.digTarget)) this.digTo(index);
  }

  protected onCrateKey(event: KeyboardEvent): void {
    const n = this.projects().length;
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = this.focus() + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = this.focus() - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = n - 1;
    else return;
    event.preventDefault();
    this.digTo(clamp(next, 0, n - 1), true);
  }

  protected onPlayerKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    void this.putBack();
  }

  protected openPulled(): void {
    const index = this.pulled();
    if (index === null) return;
    const media = this.player()?.nativeElement.querySelector<HTMLElement>('app-project-media') ?? null;
    this.openCase.emit({ index, media });
  }

  /** Lift the sleeve out, fly it aside, slide the disc out and drop the needle. */
  protected async pull(index: number): Promise<void> {
    if (this.phase() !== 'crate') return;
    const sleeve = this.sleeves()[index]?.nativeElement;
    if (!sleeve) return;
    const animate = !this.reduced;
    this.digTo(index);
    this.phase.set('pulling');

    if (animate && !this.rowMode) {
      this.springs[index].out = true;
      this.kick();
      await this.wait(320);
    }
    const from = sleeve.getBoundingClientRect();
    this.pulled.set(index);
    this.changes.detectChanges();

    const player = this.player()?.nativeElement;
    const cover = player?.querySelector<HTMLElement>('.p-sleeve');
    if (animate && cover) {
      const to = cover.getBoundingClientRect();
      const flight = cover.animate(
        [
          { transform: this.flip(from, to) },
          { transform: 'translate(0, -4%) rotate(-3deg) scale(1.03)', offset: 0.6 },
          { transform: 'none' },
        ],
        { duration: 950, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
      await flight.finished.catch(() => undefined);
    }
    if (this.pulled() !== index) return;
    this.phase.set('playing');
    this.startSpin();
    player?.querySelector<HTMLElement>('.p-open')?.focus({ preventScroll: true });
  }

  /** Lift the needle, stop the platter, slide the disc in and drop the sleeve back into its slot. */
  protected async putBack(): Promise<void> {
    const index = this.pulled();
    if (index === null || this.phase() !== 'playing') return;
    this.phase.set('returning');
    this.rampSpin(0, 800);

    if (!this.reduced && !this.rowMode) {
      await this.wait(1180);
      const cover = this.player()?.nativeElement.querySelector<HTMLElement>('.p-sleeve');
      const sleeve = this.sleeves()[index]?.nativeElement;
      if (cover && sleeve) {
        const flight = cover.animate(
          [{ transform: 'none' }, { transform: this.flip(sleeve.getBoundingClientRect(), cover.getBoundingClientRect()) }],
          { duration: 640, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' },
        );
        await flight.finished.catch(() => undefined);
      }
    } else if (!this.reduced) {
      await this.wait(520);
    }

    this.stopSpin();
    this.pulled.set(null);
    this.springs[index].out = false;
    this.phase.set('crate');
    this.changes.detectChanges();
    this.kick();
    const sleeve = this.sleeves()[index]?.nativeElement;
    sleeve?.focus({ preventScroll: true });
    if (this.rowMode) sleeve?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  /** Transform that puts an element at `to` over the rect `from` (both measured untransformed-ish). */
  private flip(from: DOMRect, to: DOMRect): string {
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${from.width / to.width}, ${from.height / to.height})`;
  }

  private digTo(index: number, moveFocus = false): void {
    this.digTarget = index;
    this.focus.set(index);
    this.kick();
    if (!moveFocus) return;
    const sleeve = this.sleeves()[index]?.nativeElement;
    sleeve?.focus({ preventScroll: true });
    if (this.rowMode) sleeve?.scrollIntoView({ behavior: this.reduced ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
  }

  private setFocusFromDig(): void {
    const index = clamp(Math.round(this.digTarget), 0, this.projects().length - 1);
    if (index !== this.focus()) this.focus.set(index);
  }

  /** Where sleeve i wants to be for the current dig position: [tilt deg, lift in sleeve heights, shade]. */
  private target(i: number): [number, number, number] {
    if (this.springs[i]?.out) return [0, OUT_LIFT, 0];
    const ahead = this.dig - i;
    if (ahead > 0) {
      // Flipped forward, leaning on the ones in front: the front-most leans furthest.
      const flip = smoothstep(0, 1, ahead);
      const tilt = -flip * (38 + 2.5 * clamp(ahead - 1, 0, 3));
      const lift = Math.max(0, 1 - ahead * 1.6) * 0.14;
      return [tilt, lift, flip * 0.5];
    }
    const behind = -ahead;
    const near = Math.max(0, 1 - behind * 1.6);
    const lift = near * (0.14 + (this.hovering ? 0.04 : 0));
    return [clamp(behind, 0, 1) * 4, lift, clamp(behind, 0, 1.5) * 0.16];
  }

  /** Start the spring loop (no-op in the mobile row, where CSS lays the sleeves out). */
  private kick(): void {
    const view = this.view;
    if (!view || this.rowMode || this.running) return;
    if (this.reduced) {
      this.dig = this.digTarget;
      this.render(true);
      return;
    }
    this.running = true;
    this.frame = view.requestAnimationFrame(this.tick);
  }

  private readonly tick = () => {
    this.dig += (this.digTarget - this.dig) * 0.16;
    this.yaw += (this.yawTarget - this.yaw) * 0.07;
    const busy = this.render(false) || Math.abs(this.digTarget - this.dig) > 0.002 || Math.abs(this.yawTarget - this.yaw) > 0.02;
    if (busy && this.view) this.frame = this.view.requestAnimationFrame(this.tick);
    else this.running = false;
  };

  /** Step every sleeve's spring (or snap, when `snap`) and write it to CSS. Returns whether anything moves. */
  private render(snap: boolean): boolean {
    let busy = false;
    this.world().nativeElement.style.setProperty('--yaw', `${this.yaw.toFixed(2)}deg`);
    this.sleeves().forEach(({ nativeElement: el }, i) => {
      const spring = this.springs[i];
      if (!spring) return;
      const [tilt, lift, shade] = this.target(i);
      if (snap) {
        spring.tilt = tilt;
        spring.lift = lift;
        spring.tiltVelocity = spring.liftVelocity = 0;
      } else {
        spring.tiltVelocity = (spring.tiltVelocity + (tilt - spring.tilt) * 0.085) * 0.8;
        spring.tilt += spring.tiltVelocity;
        spring.liftVelocity = (spring.liftVelocity + (lift - spring.lift) * 0.09) * 0.76;
        spring.lift += spring.liftVelocity;
        if (
          Math.abs(spring.tiltVelocity) > 0.01 ||
          Math.abs(tilt - spring.tilt) > 0.03 ||
          Math.abs(spring.liftVelocity) > 0.0004 ||
          Math.abs(lift - spring.lift) > 0.0008
        ) {
          busy = true;
        }
      }
      el.style.setProperty('--tilt', `${spring.tilt.toFixed(2)}deg`);
      el.style.setProperty('--lift', spring.lift.toFixed(4));
      el.style.setProperty('--shade', shade.toFixed(3));
    });
    return busy;
  }

  /** Pointer along the crate digs (mouse); horizontal swipes dig (touch); the mobile row scrolls. */
  private bindDigging(view: Window): () => void {
    const stage = this.stage().nativeElement;
    const crate = this.crate().nativeElement;
    const n = this.projects().length;
    let pointerId: number | null = null;
    let startX = 0;
    let startDig = 0;

    const span = () => {
      const sleeve = this.sleeves()[0]?.nativeElement;
      return Math.max(240, (sleeve?.offsetWidth ?? 240) * 2.4);
    };
    const onMove = (event: PointerEvent) => {
      if (this.rowMode || this.phase() !== 'crate' || this.reduced) return;
      const box = stage.getBoundingClientRect();
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
        const width = span();
        const x = (event.clientX - (box.left + box.width / 2)) / width + 0.5;
        const q = clamp(x, 0, 1) * (n - 1);
        const base = Math.floor(q);
        this.digTarget = Math.min(n - 1, base + smoothstep(0.3, 0.7, q - base));
        this.yawTarget = BASE_YAW + clamp((event.clientX - (box.left + box.width / 2)) / box.width, -0.5, 0.5) * 12;
        this.hovering = true;
        this.setFocusFromDig();
        this.kick();
        return;
      }
      if (pointerId !== event.pointerId) return;
      const dx = event.clientX - startX;
      if (Math.abs(dx) > 8) this.swiped = true;
      this.digTarget = clamp(startDig - (dx / (box.width * 0.55)) * (n - 1), 0, n - 1);
      this.setFocusFromDig();
      this.kick();
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || this.rowMode || this.phase() !== 'crate') return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startDig = this.digTarget;
      this.swiped = false;
    };
    const onUp = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      this.digTarget = Math.round(this.digTarget);
      this.setFocusFromDig();
      this.kick();
      // Let the click that follows a swipe be ignored, then forget the swipe.
      view.setTimeout(() => (this.swiped = false), 60);
    };
    const onLeave = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      this.hovering = false;
      this.digTarget = Math.round(this.digTarget);
      this.yawTarget = BASE_YAW;
      this.setFocusFromDig();
      this.kick();
    };

    // Mobile row: the centred sleeve is the one you are looking at.
    let scrollFrame = 0;
    const onScroll = () => {
      if (!this.rowMode) return;
      view.cancelAnimationFrame(scrollFrame);
      scrollFrame = view.requestAnimationFrame(() => {
        const centre = crate.getBoundingClientRect().left + crate.clientWidth / 2;
        let best = 0;
        let bestDistance = Infinity;
        this.sleeves().forEach(({ nativeElement }, i) => {
          const box = nativeElement.getBoundingClientRect();
          const distance = Math.abs(box.left + box.width / 2 - centre);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
          }
        });
        this.digTarget = best;
        if (best !== this.focus()) this.focus.set(best);
      });
    };

    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('pointerleave', onLeave);
    crate.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      view.cancelAnimationFrame(scrollFrame);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('pointerleave', onLeave);
      crate.removeEventListener('scroll', onScroll);
    };
  }

  private startSpin(): void {
    const disc = this.player()?.nativeElement.querySelector<HTMLElement>('.disc');
    if (!disc || this.reduced) return;
    this.spin?.cancel();
    this.spin = disc.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], {
      duration: 1800,
      iterations: Infinity,
    });
    this.spin.playbackRate = 0;
    // The needle drops first, then the platter gets up to 33⅓.
    this.later(() => this.rampSpin(1, 1600), 700);
  }

  private rampSpin(to: number, ms: number): void {
    const spin = this.spin;
    const view = this.view;
    if (!spin || !view) return;
    view.cancelAnimationFrame(this.spinFrame);
    const from = spin.playbackRate;
    const start = view.performance.now();
    const step = (now: number) => {
      const t = clamp((now - start) / ms, 0, 1);
      spin.playbackRate = from + (to - from) * (1 - (1 - t) ** 2);
      if (t < 1) this.spinFrame = view.requestAnimationFrame(step);
    };
    this.spinFrame = view.requestAnimationFrame(step);
  }

  private stopSpin(): void {
    this.view?.cancelAnimationFrame(this.spinFrame);
    this.spin?.cancel();
    this.spin = null;
  }

  private later(fn: () => void, ms: number): void {
    if (this.view) this.timers.push(this.view.setTimeout(fn, ms));
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.later(resolve, ms));
  }
}
