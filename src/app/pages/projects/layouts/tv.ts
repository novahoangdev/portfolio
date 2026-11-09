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

/** cold = never switched on yet, booting = power-on animation, off = switched off by the viewer. */
type ScreenState = 'cold' | 'booting' | 'on' | 'off';
/** static = full snow while the tuner searches, tuning = the new picture rolls in under fading snow. */
type TunePhase = 'idle' | 'static' | 'tuning';

interface Snow {
  start(): void;
  stop(): void;
}

/** Analogue "snow": random grey pixels, torn rows and a rolling sync bar, drawn small and stretched. */
function createSnow(canvas: HTMLCanvasElement, view: Window): Snow {
  const width = 168;
  const height = 126;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return { start: () => {}, stop: () => {} };
  const image = context.createImageData(width, height);
  const pixels = new Uint32Array(image.data.buffer);
  let frame = 0;
  let running = false;
  let tick = 0;

  const draw = () => {
    tick++;
    const bar = ((tick * 9) % (height + 60)) - 30;
    for (let y = 0; y < height; y++) {
      const tear = Math.random() < 0.06 ? Math.random() * 70 : 0;
      const distance = Math.abs(y - bar);
      const band = distance < 14 ? (14 - distance) * 5 : 0;
      const row = y * width;
      for (let x = 0; x < width; x++) {
        let v = Math.random() * 215 + tear + band;
        if (v > 255) v = 255;
        const g = v | 0;
        pixels[row + x] = 0xff000000 | (g << 16) | (g << 8) | g;
      }
    }
    context.putImageData(image, 0, 0);
    if (running) frame = view.requestAnimationFrame(draw);
  };

  return {
    start() {
      if (running) return;
      running = true;
      draw();
    },
    stop() {
      running = false;
      view.cancelAnimationFrame(frame);
    },
  };
}

/** Experimental layout — a walnut CRT set: every channel is a project; turn the dial to surf. */
@Component({
  selector: 'app-projects-tv',
  imports: [ProjectMediaView],
  templateUrl: './tv.html',
  styleUrl: './tv.css',
})
export class ProjectsTv {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;

  /** The channel the dial points at (OSD, guide, accent). */
  protected readonly channel = signal(0);
  /** The channel whose picture is on the tube. */
  protected readonly showing = signal(0);
  protected readonly screen = signal<ScreenState>('cold');
  protected readonly phase = signal<TunePhase>('idle');
  protected readonly osd = signal(false);
  protected readonly inView = signal(false);
  protected readonly powered = computed(() => this.screen() === 'on' || this.screen() === 'booting');
  protected readonly step = computed(() => 360 / this.projects().length);
  protected readonly announcement = computed(() => {
    if (!this.powered()) return 'Television off';
    const project = this.projects()[this.channel()];
    return `Channel ${this.channel() + 1}: ${project.name}`;
  });

  private readonly document = inject(DOCUMENT);
  private readonly view = this.document.defaultView;
  private readonly reduced = prefersReducedMotion(this.view);
  private readonly setEl = viewChild.required<ElementRef<HTMLElement>>('set');
  private readonly dialEl = viewChild.required<ElementRef<HTMLElement>>('dial');
  private readonly knobEl = viewChild.required<ElementRef<HTMLElement>>('knob');
  private readonly channelsEl = viewChild.required<ElementRef<HTMLElement>>('channels');
  private readonly antennaEl = viewChild.required<ElementRef<HTMLElement>>('antenna');
  private readonly noiseEl = viewChild.required<ElementRef<HTMLCanvasElement>>('noise');

  private snow: Snow = { start: () => {}, stop: () => {} };
  /** Knob rotation in degrees; continuous so it can keep turning the same way. */
  private dialAngle = 0;
  private timers: number[] = [];
  private osdTimer = 0;
  private snowStopTimer = 0;

  constructor() {
    let cleanup = () => {};

    afterNextRender(() => {
      const view = this.view;
      if (!view) return;
      this.snow = createSnow(this.noiseEl().nativeElement, view);
      this.applyDial(false);

      // Switch the set on the first time it is properly on screen.
      const io = new IntersectionObserver(
        ([entry]) => {
          const visible = !!entry?.isIntersecting;
          this.inView.set(visible);
          if (visible && this.screen() === 'cold') {
            this.later(() => this.screen() === 'cold' && this.powerOn(), 280);
          }
        },
        { threshold: 0.35 },
      );
      io.observe(this.setEl().nativeElement);

      cleanup = this.bindDial(view);
      const disconnect = cleanup;
      cleanup = () => {
        disconnect();
        io.disconnect();
        this.clearTimers();
        view.clearTimeout(this.osdTimer);
        view.clearTimeout(this.snowStopTimer);
        this.snow.stop();
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }

  /** Turn to channel `index` (wrapped). `fromDial` = the knob is already where it should be. */
  protected tune(index: number, fromDial = false): void {
    const n = this.projects().length;
    const next = ((index % n) + n) % n;
    if (!fromDial) this.turnDialTo(next);
    if (next === this.channel() && this.phase() === 'idle') {
      if (this.powered()) this.flashOsd();
      return;
    }
    this.channel.set(next);
    if (!this.powered()) {
      this.showing.set(next);
      return;
    }
    this.flashOsd();
    if (this.reduced) {
      this.showing.set(next);
      return;
    }

    // Snow → the new picture rolls in under fading snow → clean picture.
    this.clearTimers();
    this.phase.set('static');
    this.startSnow();
    this.restartClass(this.antennaEl().nativeElement, 'is-wobbling');
    this.later(() => {
      this.showing.set(next);
      this.phase.set('tuning');
      this.restartClass(this.channelsEl().nativeElement, 'is-rolling');
    }, 190);
    this.later(() => {
      this.phase.set('idle');
      this.stopSnowSoon();
    }, 470);
  }

  protected togglePower(): void {
    if (this.powered()) this.powerOff();
    else this.powerOn();
  }

  protected onScreen(index: number, button: HTMLElement): void {
    if (!this.powered()) {
      this.powerOn();
      return;
    }
    if (index !== this.showing() || this.phase() !== 'idle') return;
    this.openCase.emit({ index, media: button.querySelector('app-project-media') });
  }

  /** The parent focuses a channel when its case closes: tune the set to it. */
  protected onChannelFocus(index: number): void {
    if (index !== this.channel()) this.tune(index);
  }

  protected openShowing(): void {
    const index = this.channel();
    if (!this.powered()) this.powerOn();
    const media = this.setEl().nativeElement.querySelector<HTMLElement>(
      `.channel[data-project="${index}"] app-project-media`,
    );
    this.openCase.emit({ index, media });
  }

  protected onKey(event: KeyboardEvent): void {
    if ((event.target as HTMLElement | null)?.closest('.dial')) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') this.tune(this.channel() + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') this.tune(this.channel() - 1);
    else return;
    event.preventDefault();
  }

  protected onDialKey(event: KeyboardEvent): void {
    const n = this.projects().length;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp') this.tune(this.channel() + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown') this.tune(this.channel() - 1);
    else if (event.key === 'Home') this.tune(0);
    else if (event.key === 'End') this.tune(n - 1);
    else return;
    event.preventDefault();
  }

  private powerOn(): void {
    this.clearTimers();
    this.showing.set(this.channel());
    if (this.reduced) {
      this.screen.set('on');
      this.flashOsd();
      return;
    }
    this.screen.set('booting');
    this.phase.set('static');
    this.startSnow();
    this.later(() => {
      this.phase.set('tuning');
      this.flashOsd();
    }, 520);
    this.later(() => {
      this.screen.set('on');
      this.phase.set('idle');
      this.stopSnowSoon();
    }, 900);
  }

  private powerOff(): void {
    this.clearTimers();
    this.phase.set('idle');
    this.snow.stop();
    this.osd.set(false);
    this.screen.set('off');
  }

  private flashOsd(): void {
    const view = this.view;
    if (!view) return;
    this.osd.set(true);
    view.clearTimeout(this.osdTimer);
    this.osdTimer = view.setTimeout(() => this.osd.set(false), 2600);
  }

  private startSnow(): void {
    this.view?.clearTimeout(this.snowStopTimer);
    this.snow.start();
  }

  /** Let the snow fade out (CSS) before stopping its frame loop. */
  private stopSnowSoon(): void {
    const view = this.view;
    if (!view) return;
    view.clearTimeout(this.snowStopTimer);
    this.snowStopTimer = view.setTimeout(() => this.snow.stop(), 260);
  }

  private later(fn: () => void, ms: number): void {
    const view = this.view;
    if (!view) return;
    this.timers.push(view.setTimeout(fn, ms));
  }

  private clearTimers(): void {
    this.timers.forEach((id) => this.view?.clearTimeout(id));
    this.timers = [];
  }

  /** Restart a one-shot CSS animation class. */
  private restartClass(element: HTMLElement, name: string): void {
    element.classList.remove(name);
    void element.offsetWidth;
    element.classList.add(name);
  }

  /** Spring the knob to `index`, the short way round. */
  private turnDialTo(index: number): void {
    const n = this.projects().length;
    const step = this.step();
    const detent = Math.round(this.dialAngle / step);
    const current = ((detent % n) + n) % n;
    let delta = index - current;
    if (delta > n / 2) delta -= n;
    if (delta < -n / 2) delta += n;
    this.dialAngle = (detent + delta) * step;
    this.applyDial(true);
  }

  private applyDial(animate: boolean): void {
    const knob = this.knobEl().nativeElement;
    knob.classList.toggle('is-free', !animate);
    knob.style.transform = `rotate(${this.dialAngle}deg)`;
  }

  /** Drag the knob round with sticky detents; tap advances; wheel turns it. */
  private bindDial(view: Window): () => void {
    const dial = this.dialEl().nativeElement;
    let pointerId: number | null = null;
    let lastPointerAngle = 0;
    let raw = 0;
    let travelled = 0;
    let lastDetent = 0;
    let wheel = 0;

    const pointerAngle = (event: PointerEvent) => {
      const box = dial.getBoundingClientRect();
      const x = event.clientX - (box.left + box.width / 2);
      const y = event.clientY - (box.top + box.height / 2);
      return (Math.atan2(y, x) * 180) / Math.PI;
    };
    const click = (event: PointerEvent) => {
      this.restartClass(dial, 'is-ticking');
      if (event.pointerType === 'touch') {
        try {
          view.navigator.vibrate?.(6);
        } catch {
          // Haptics are optional.
        }
      }
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      pointerId = event.pointerId;
      dial.setPointerCapture(event.pointerId);
      dial.focus({ preventScroll: true });
      lastPointerAngle = pointerAngle(event);
      raw = this.dialAngle;
      travelled = 0;
      lastDetent = Math.round(raw / this.step());
      dial.classList.add('is-grabbed');
      this.applyDial(false);
    };
    const onMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      const angle = pointerAngle(event);
      let delta = angle - lastPointerAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      lastPointerAngle = angle;
      raw += delta;
      travelled += Math.abs(delta);
      // Sticky detents: the knob lags near a click and jumps between them.
      const step = this.step();
      const nearest = Math.round(raw / step) * step;
      const offset = (raw - nearest) / step;
      this.dialAngle = raw - (Math.sin(offset * Math.PI * 2) * step * 0.85) / (Math.PI * 2);
      this.applyDial(false);
      const detent = Math.round(raw / step);
      if (detent !== lastDetent) {
        lastDetent = detent;
        click(event);
        this.tune(detent, true);
      }
    };
    const onUp = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      dial.classList.remove('is-grabbed');
      if (travelled < 4) {
        this.tune(this.channel() + 1);
        return;
      }
      this.dialAngle = Math.round(raw / this.step()) * this.step();
      this.applyDial(true);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      wheel += Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (Math.abs(wheel) < 40) return;
      this.tune(this.channel() + Math.sign(wheel));
      wheel = 0;
    };

    dial.addEventListener('pointerdown', onDown);
    dial.addEventListener('pointermove', onMove);
    dial.addEventListener('pointerup', onUp);
    dial.addEventListener('pointercancel', onUp);
    dial.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      dial.removeEventListener('pointerdown', onDown);
      dial.removeEventListener('pointermove', onMove);
      dial.removeEventListener('pointerup', onUp);
      dial.removeEventListener('pointercancel', onUp);
      dial.removeEventListener('wheel', onWheel);
    };
  }
}
