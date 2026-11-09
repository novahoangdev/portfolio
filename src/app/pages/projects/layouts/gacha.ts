import { DOCUMENT } from '@angular/common';
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

/** idle = ready to turn, turning = crank going round, dropping = capsule on its way, waiting = in the tray, open = card out. */
type Phase = 'idle' | 'turning' | 'dropping' | 'waiting' | 'open';

/** A capsule inside the globe, in globe-radius units (centre 0,0; rim at distance 1). */
interface Ball {
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  va: number;
  state: 'in' | 'exit' | 'gone';
  /** Exit animation: start time and start position. */
  t0: number;
  x0: number;
  y0: number;
  el: HTMLElement | null;
  spin: HTMLElement | null;
}

const GRAVITY = 9;
const WALL = 0.025;
const TICK_DEG = 30;
const EXIT_MS = 560;

/** Playground layout — a glossy capsule machine: turn the crank, catch a capsule, pop it open. */
@Component({
  selector: 'app-projects-gacha',
  imports: [ProjectMediaView],
  templateUrl: './gacha.html',
  styleUrl: './gacha.css',
})
export class ProjectsGacha {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;

  protected readonly phase = signal<Phase>('idle');
  /** Project in the tray / on the card. */
  protected readonly drawn = signal<number | null>(null);
  protected readonly shown = signal<number | null>(null);
  protected readonly found = signal<ReadonlySet<number>>(new Set());
  protected readonly inGlobe = signal<ReadonlySet<number>>(new Set());
  protected readonly announce = signal('');
  protected readonly jammed = signal(false);

  /** Capsule radius relative to the globe radius: smaller capsules when there are more projects. */
  protected readonly capR = computed(() => {
    const n = this.projects().length;
    return n <= 6 ? 0.23 : n <= 8 ? 0.205 : n <= 10 ? 0.185 : 0.165;
  });

  private readonly document = inject(DOCUMENT);
  private readonly view = this.document.defaultView;
  private readonly injector = inject(Injector);
  private readonly reduced = prefersReducedMotion(this.view);
  private readonly rootEl = viewChild.required<ElementRef<HTMLElement>>('root');
  private readonly globeEl = viewChild.required<ElementRef<HTMLElement>>('globe');
  private readonly crankEl = viewChild.required<ElementRef<HTMLElement>>('crank');
  private readonly discEl = viewChild.required<ElementRef<HTMLElement>>('disc');
  private readonly fxEl = viewChild.required<ElementRef<HTMLElement>>('fx');

  private balls: Ball[] = [];
  private radiusPx = 170;
  private frame = 0;
  private running = false;
  private visible = false;
  private calm = 0;
  private stirUntil = 0;
  private stirPower = 0;
  private crankAngle = 0;
  private timers: number[] = [];
  /** The crank / capsule was worked from the keyboard: move focus along with the action. */
  private viaKeyboard = false;

  constructor() {
    let cleanup = () => {};

    afterNextRender(() => {
      const view = this.view;
      if (!view) return;
      const globe = this.globeEl().nativeElement;
      this.radiusPx = globe.clientWidth / 2;
      this.fill(false);
      this.render();

      const ro = new ResizeObserver(() => {
        this.radiusPx = globe.clientWidth / 2;
        this.render();
      });
      ro.observe(globe);

      const io = new IntersectionObserver(([entry]) => {
        this.visible = !!entry?.isIntersecting;
        if (this.visible) this.wake();
      });
      io.observe(this.rootEl().nativeElement);

      const unbind = this.bindCrank(view);
      cleanup = () => {
        unbind();
        ro.disconnect();
        io.disconnect();
        view.cancelAnimationFrame(this.frame);
        this.running = false;
        this.timers.forEach((id) => view.clearTimeout(id));
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }

  // ── Template actions ────────────────────────────────────────────────

  /** Crank pressed (click / Enter / Space): one automatic turn. */
  protected onCrankClick(event: MouseEvent): void {
    if (event.detail === 0) this.viaKeyboard = true;
    this.turn();
  }

  /** A gentle shake when the globe is poked. */
  protected poke(): void {
    if (this.reduced || this.phase() === 'turning') return;
    this.stir(0.5, 380);
  }

  protected pop(event: MouseEvent): void {
    const index = this.drawn();
    if (index === null || this.phase() !== 'waiting') return;
    const keyboard = event.detail === 0;
    const capsule = event.currentTarget as HTMLElement;
    const from = capsule.getBoundingClientRect();
    this.phase.set('open');
    this.found.update((found) => new Set(found).add(index));
    if (!this.reduced) this.burst(from, this.projects()[index].accent);
    this.later(() => this.reveal(index, from, keyboard), this.reduced ? 0 : 200);
  }

  protected again(event: MouseEvent): void {
    if (event.detail === 0) this.viaKeyboard = true;
    this.turn();
  }

  /** Re-open a collected capsule from the shelf. */
  protected show(index: number, event: MouseEvent): void {
    if (this.phase() === 'turning' || this.phase() === 'dropping') return;
    const from = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // A capsule still waiting in the tray stays there.
    if (this.phase() !== 'waiting') this.phase.set('open');
    this.reveal(index, from, event.detail === 0);
  }

  protected openShown(): void {
    const index = this.shown();
    if (index === null) return;
    const media = this.rootEl().nativeElement.querySelector<HTMLElement>('.card app-project-media');
    this.openCase.emit({ index, media });
  }

  protected capsuleLabel(index: number | null): string {
    if (index === null) return '';
    return this.found().has(index) ? `Open capsule: ${this.projects()[index].name}` : 'Open the capsule';
  }

  // ── The draw ────────────────────────────────────────────────────────

  private turn(): void {
    const phase = this.phase();
    if (phase === 'turning' || phase === 'dropping') return;
    if (phase === 'waiting') {
      // One capsule at a time: the crank jams and the tray capsule wiggles.
      this.jammed.set(true);
      this.restartClass(this.rootEl().nativeElement.querySelector('.drop'), 'is-nudged');
      this.restartClass(this.crankEl().nativeElement, 'is-jammed');
      this.announce.set('Open the capsule in the tray first.');
      this.later(() => this.jammed.set(false), 1600);
      return;
    }
    this.phase.set('turning');
    this.drawn.set(null);
    if (this.reduced) {
      this.crankAngle += 360;
      this.discEl().nativeElement.style.transform = `rotate(${this.crankAngle}deg)`;
      this.dispense();
      return;
    }
    this.autoTurn();
  }

  /** Spin the crank one full turn with ratchet ticks, stirring as it goes. */
  private autoTurn(): void {
    const view = this.view;
    if (!view) return;
    const start = this.crankAngle;
    const t0 = view.performance.now();
    const duration = 1050;
    let lastTick = Math.floor(start / TICK_DEG);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      this.crankAngle = start + 360 * eased;
      this.discEl().nativeElement.style.transform = `rotate(${this.crankAngle}deg)`;
      const tick = Math.floor(this.crankAngle / TICK_DEG);
      if (tick !== lastTick) {
        lastTick = tick;
        this.click();
        this.stir(0.9, 260);
      }
      if (t < 1) view.requestAnimationFrame(step);
      else {
        this.crankAngle = Math.round(this.crankAngle / 360) * 360;
        this.dispense();
      }
    };
    view.requestAnimationFrame(step);
  }

  /** Refill if empty, then send the lowest capsule down the chute. */
  private dispense(): void {
    if (!this.balls.some((b) => b.state === 'in')) {
      this.fill(true);
      this.restartClass(this.rootEl().nativeElement.querySelector('.lid'), 'is-popped');
      this.later(() => this.dispense(), this.reduced ? 0 : this.balls.length * 85 + 650);
      return;
    }
    this.phase.set('dropping');
    const candidates = this.balls.filter((b) => b.state === 'in');
    const ball = candidates.reduce((low, b) => (b.y > low.y ? b : low));
    const view = this.view;
    if (this.reduced || !view) {
      ball.state = 'gone';
      this.settle();
      this.render();
      this.syncGlobe();
      this.land(ball.index);
      return;
    }
    ball.state = 'exit';
    ball.t0 = view.performance.now();
    ball.x0 = ball.x;
    ball.y0 = ball.y;
    this.wake();
    this.restartClass(this.rootEl().nativeElement.querySelector('.flap'), 'is-swinging');
    this.later(() => this.land(ball.index), EXIT_MS + 120);
  }

  private land(index: number): void {
    this.syncGlobe();
    this.drawn.set(index);
    this.phase.set('waiting');
    this.announce.set('A capsule dropped into the tray. Press it to open.');
    const keyboard = this.viaKeyboard;
    this.viaKeyboard = false;
    if (keyboard) {
      afterNextRender(
        () => this.rootEl().nativeElement.querySelector<HTMLElement>('.drop')?.focus({ preventScroll: true }),
        { injector: this.injector },
      );
    }
  }

  /** Show the card, rising out of `from` (the capsule or a shelf slot). */
  private reveal(index: number, from: DOMRect, keyboard: boolean): void {
    this.shown.set(index);
    // Let the halves finish springing apart, then clear the tray.
    this.later(() => this.phase() === 'open' && this.drawn.set(null), this.reduced ? 0 : 650);
    this.announce.set(`${this.projects()[index].name}: ${this.projects()[index].tagline}`);
    afterNextRender(
      () => {
        const card = this.rootEl().nativeElement.querySelector<HTMLElement>('.card');
        if (!card) return;
        if (!this.reduced) {
          const to = card.getBoundingClientRect();
          const dx = from.left + from.width / 2 - (to.left + to.width / 2);
          const dy = from.top + from.height / 2 - (to.top + to.height / 2);
          const s = Math.max(0.08, from.width / to.width);
          card.animate(
            [
              { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(-8deg)`, opacity: 0 },
              { opacity: 1, offset: 0.25 },
              { transform: 'none', opacity: 1 },
            ],
            { duration: 820, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
          );
        }
        if (this.view?.matchMedia('(max-width: 760px)').matches) {
          card.scrollIntoView({ block: 'nearest', behavior: this.reduced ? 'auto' : 'smooth' });
        }
        if (keyboard) card.querySelector<HTMLElement>('.btn-open')?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }

  /** Confetti and sparkles in the capsule's accent. */
  private burst(from: DOMRect, accent: string): void {
    const layer = this.fxEl().nativeElement;
    const base = layer.getBoundingClientRect();
    const scope = Array.from(layer.attributes).find((a) => a.name.startsWith('_ngcontent'));
    const cx = from.left + from.width / 2 - base.left;
    const cy = from.top + from.height / 2 - base.top;
    const colors = [accent, accent, '#ffffff', '#ffd76a'];
    for (let i = 0; i < 36; i++) {
      const bit = this.document.createElement('i');
      bit.className = i % 3 === 0 ? 'spark' : 'confetti';
      if (scope) bit.setAttribute(scope.name, '');
      bit.style.left = `${cx}px`;
      bit.style.top = `${cy}px`;
      bit.style.background = colors[i % colors.length];
      layer.append(bit);
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
      const dist = 70 + Math.random() * 150;
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;
      const spin = (Math.random() - 0.5) * 720;
      bit
        .animate(
          [
            { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 1 },
            { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: 0.55 },
            { transform: `translate(calc(-50% + ${x * 1.15}px), calc(-50% + ${y + 60}px)) rotate(${spin}deg) scale(0.7)`, opacity: 0 },
          ],
          { duration: 800 + Math.random() * 500, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        )
        .finished.then(
          () => bit.remove(),
          () => bit.remove(),
        );
    }
  }

  // ── Physics ─────────────────────────────────────────────────────────

  /** Put every capsule in the globe: `fromTop` = rain in through the lid, else a settled pile. */
  private fill(fromTop: boolean): void {
    const list = this.projects();
    const elements = this.globeEl().nativeElement.querySelectorAll<HTMLElement>('.ball');
    const r = this.capR();
    const order = list.map((_, i) => i).sort(() => Math.random() - 0.5);
    const rain = fromTop && !this.reduced;
    this.balls = order.map((index, k) => ({
      index,
      x: ((k % 3) - 1) * r * 2.1,
      y: 0.6 - Math.floor(k / 3) * r * 2,
      vx: 0,
      vy: 0,
      a: Math.random() * Math.PI * 2,
      va: 0,
      state: rain ? ('gone' as const) : ('in' as const),
      t0: 0,
      x0: 0,
      y0: 0,
      el: elements[index] ?? null,
      spin: elements[index]?.querySelector<HTMLElement>('.ball-spin') ?? null,
    }));
    if (!rain) {
      this.settle();
      this.render();
      this.syncGlobe();
      return;
    }
    // Drop them in one by one through the lid.
    this.balls.forEach((ball, k) => {
      this.later(() => {
        ball.state = 'in';
        ball.x = (Math.random() - 0.5) * 0.3;
        ball.y = -(1 - r - WALL) + 0.01;
        ball.vx = (Math.random() - 0.5) * 1.2;
        ball.vy = 1.2;
        this.syncGlobe();
        this.wake();
      }, k * 85);
    });
  }

  /** Run the simulation to rest without drawing (reduced motion, first paint). */
  private settle(): void {
    for (let i = 0; i < 360; i++) this.step(1 / 60);
  }

  private stir(power: number, ms: number): void {
    const view = this.view;
    if (!view || this.reduced) return;
    this.stirUntil = Math.max(this.stirUntil, view.performance.now() + ms);
    this.stirPower = Math.max(this.stirPower * 0.6, power);
    this.wake();
  }

  private wake(): void {
    const view = this.view;
    if (!view || this.running || !this.visible) return;
    this.running = true;
    this.calm = 0;
    let last = view.performance.now();
    const loop = (now: number) => {
      if (!this.visible) {
        this.running = false;
        return;
      }
      const dt = Math.min(0.034, (now - last) / 1000);
      last = now;
      this.step(dt / 2);
      this.step(dt / 2);
      this.render();
      const moving = this.balls.some(
        (b) => b.state === 'exit' || (b.state === 'in' && Math.hypot(b.vx, b.vy) > 0.03),
      );
      this.calm = moving || now < this.stirUntil ? 0 : this.calm + 1;
      if (this.calm > 30) {
        this.running = false;
        return;
      }
      this.frame = view.requestAnimationFrame(loop);
    };
    this.frame = view.requestAnimationFrame(loop);
  }

  private step(dt: number): void {
    const r = this.capR();
    const limit = 1 - r - WALL;
    const now = this.view?.performance.now() ?? 0;
    const stirring = now < this.stirUntil;
    const live = this.balls.filter((b) => b.state === 'in');

    for (const b of live) {
      b.vy += GRAVITY * dt;
      if (stirring) {
        // Paddles under the globe: kick the low capsules up and swirl them round.
        const power = this.stirPower;
        if (b.y > 0.1 && Math.random() < 0.35) {
          b.vy -= (2.4 + Math.random() * 3.2) * power;
          b.vx += (Math.random() - 0.5) * 3 * power;
        }
        b.vx += -b.y * 5 * power * dt;
        b.vy += b.x * 5 * power * dt;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= 0.996;
      b.vy *= 0.996;
    }

    for (let iteration = 0; iteration < 3; iteration++) {
      for (let i = 0; i < live.length; i++) {
        const a = live[i];
        for (let j = i + 1; j < live.length; j++) {
          const b = live[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.0001;
          const overlap = 2 * r - d;
          if (overlap <= 0) continue;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= (nx * overlap) / 2;
          a.y -= (ny * overlap) / 2;
          b.x += (nx * overlap) / 2;
          b.y += (ny * overlap) / 2;
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) {
            const j2 = (-(1 + 0.25) * rel) / 2;
            a.vx -= j2 * nx;
            a.vy -= j2 * ny;
            b.vx += j2 * nx;
            b.vy += j2 * ny;
            // Rubbing spins both a little.
            const tangent = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
            a.va += tangent * 0.8;
            b.va -= tangent * 0.8;
          }
        }
      }
      for (const b of live) {
        const d = Math.hypot(b.x, b.y);
        if (d <= limit) continue;
        const nx = b.x / d;
        const ny = b.y / d;
        b.x = nx * limit;
        b.y = ny * limit;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) {
          b.vx -= 1.35 * vn * nx;
          b.vy -= 1.35 * vn * ny;
        }
        // Roll along the glass.
        const vt = b.vx * -ny + b.vy * nx;
        b.va = b.va * 0.8 + (vt / r) * 0.2;
        b.vx *= 0.985;
        b.vy *= 0.985;
      }
    }

    for (const b of live) {
      b.a += b.va * dt;
      b.va *= 0.97;
    }

    // Exiting capsule: slide to the hole at the bottom, then drop out of sight.
    for (const b of this.balls) {
      if (b.state !== 'exit') continue;
      const t = Math.min(1, (now - b.t0) / EXIT_MS);
      if (t < 0.5) {
        const k = t / 0.5;
        const e = k * k * (3 - 2 * k);
        b.x = b.x0 * (1 - e);
        b.y = b.y0 + (limit - b.y0) * e;
      } else {
        const k = (t - 0.5) / 0.5;
        b.x = 0;
        b.y = limit + k * k * (2 * r + 0.15);
      }
      b.a += 6 * dt;
      if (t >= 1) b.state = 'gone';
    }
  }

  private render(): void {
    const R = this.radiusPx;
    for (const b of this.balls) {
      if (!b.el || !b.spin) continue;
      b.el.style.transform = `translate(${(b.x * R).toFixed(1)}px, ${(b.y * R).toFixed(1)}px)`;
      b.spin.style.transform = `rotate(${b.a.toFixed(3)}rad)`;
    }
  }

  private syncGlobe(): void {
    this.inGlobe.set(new Set(this.balls.filter((b) => b.state !== 'gone').map((b) => b.index)));
  }

  // ── Crank (native pointer work) ─────────────────────────────────────

  private bindCrank(view: Window): () => void {
    const crank = this.crankEl().nativeElement;
    let pointerId: number | null = null;
    let lastAngle = 0;
    let travelled = 0;
    /** Crank angle when the drag began, and the furthest it has been turned since. */
    let base = 0;
    let furthest = 0;
    let lastTick = 0;

    const pointerAngle = (event: PointerEvent) => {
      const box = crank.getBoundingClientRect();
      return (Math.atan2(event.clientY - (box.top + box.height / 2), event.clientX - (box.left + box.width / 2)) * 180) / Math.PI;
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const phase = this.phase();
      travelled = 0;
      if (phase === 'turning' || phase === 'dropping' || phase === 'waiting') return;
      pointerId = event.pointerId;
      crank.setPointerCapture(event.pointerId);
      lastAngle = pointerAngle(event);
      base = furthest = this.crankAngle;
      lastTick = Math.floor(this.crankAngle / TICK_DEG);
      crank.classList.add('is-grabbed');
    };
    const onMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      const angle = pointerAngle(event);
      let delta = angle - lastAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      lastAngle = angle;
      travelled += Math.abs(delta);
      // Ratchet: clockwise only; backwards gives a few degrees, then holds.
      this.crankAngle = Math.max(furthest - 6, this.crankAngle + delta);
      furthest = Math.max(furthest, this.crankAngle);
      this.discEl().nativeElement.style.transform = `rotate(${this.crankAngle}deg)`;
      const tick = Math.floor(this.crankAngle / TICK_DEG);
      if (tick > lastTick) {
        lastTick = tick;
        this.click(event.pointerType === 'touch');
        this.stir(Math.min(1.1, 0.4 + Math.abs(delta) / 10), 260);
      }
      if (travelled > 8 && this.phase() !== 'turning') {
        this.phase.set('turning');
        this.drawn.set(null);
      }
      if (furthest - base >= 360) release(true);
    };
    const release = (completed: boolean) => {
      if (pointerId !== null && crank.hasPointerCapture(pointerId)) crank.releasePointerCapture(pointerId);
      pointerId = null;
      crank.classList.remove('is-grabbed');
      const disc = this.discEl().nativeElement;
      if (completed) {
        this.crankAngle = base + 360;
        disc.style.transform = `rotate(${this.crankAngle}deg)`;
        this.dispense();
        return;
      }
      // Not a full turn: settle back onto the last tooth.
      this.crankAngle = Math.floor(this.crankAngle / TICK_DEG) * TICK_DEG;
      disc.style.transform = `rotate(${this.crankAngle}deg)`;
      if (this.phase() === 'turning') this.phase.set(this.shown() === null ? 'idle' : 'open');
    };
    const onUp = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      if (travelled < 8) {
        // A tap: let the click handler run the automatic turn.
        pointerId = null;
        crank.classList.remove('is-grabbed');
        return;
      }
      release(false);
    };
    // A drag ends with a click event too: swallow it so it doesn't turn again.
    const onClickCapture = (event: MouseEvent) => {
      if (travelled >= 8 && event.detail > 0) {
        event.stopImmediatePropagation();
        travelled = 0;
      }
    };

    crank.addEventListener('pointerdown', onDown);
    crank.addEventListener('pointermove', onMove);
    crank.addEventListener('pointerup', onUp);
    crank.addEventListener('pointercancel', onUp);
    crank.addEventListener('click', onClickCapture, true);
    return () => {
      crank.removeEventListener('pointerdown', onDown);
      crank.removeEventListener('pointermove', onMove);
      crank.removeEventListener('pointerup', onUp);
      crank.removeEventListener('pointercancel', onUp);
      crank.removeEventListener('click', onClickCapture, true);
    };
  }

  private click(haptic = false): void {
    this.restartClass(this.crankEl().nativeElement, 'is-tick');
    if (!haptic) return;
    try {
      this.view?.navigator.vibrate?.(5);
    } catch {
      // Haptics are optional.
    }
  }

  private restartClass(element: Element | null, name: string): void {
    if (!element) return;
    element.classList.remove(name);
    void (element as HTMLElement).offsetWidth;
    element.classList.add(name);
  }

  private later(fn: () => void, ms: number): void {
    const view = this.view;
    if (view) this.timers.push(view.setTimeout(fn, ms));
  }
}
