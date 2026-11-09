import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Component,
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

/** Where a project's print hangs on the dark wall (desktop), relative to its name row. */
interface Slot {
  /** Left edge, % of the room width. */
  readonly x: number;
  /** Width, % of the room width. */
  readonly w: number;
  /** Vertical nudge from the row's centre, rem. */
  readonly dy: number;
  /** Tilt, degrees. */
  readonly r: number;
  /** Name inset from its side, % of the room width. */
  readonly nx: number;
}

const SLOTS: readonly Slot[] = [
  { x: 58, w: 24, dy: 0.4, r: 2, nx: 3 },
  { x: 6, w: 18, dy: 1.4, r: -2.5, nx: 2 },
  { x: 62, w: 18, dy: 1, r: -1.6, nx: 7 },
  { x: 15, w: 19, dy: 1.2, r: 2.4, nx: 5 },
  { x: 63, w: 18, dy: 1, r: 1.4, nx: 3 },
  { x: 5, w: 18, dy: 1.4, r: -2.2, nx: 3 },
  { x: 66, w: 19, dy: 0.6, r: 2, nx: 8 },
];

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const distanceTo = (box: Box, x: number, y: number) =>
  Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));

/**
 * Layout — Flashlight: lights off. Every project hangs on a dark wall behind
 * giant outlined names; the pointer (or finger) is a torch. Whatever sits in
 * the beam wakes up: its name fills with colour, its demo plays, a caption
 * appears. Idle, the torch wanders on its own; keyboard focus steers it.
 */
@Component({
  selector: 'app-projects-flashlight',
  imports: [ProjectMediaView],
  templateUrl: './flashlight.html',
  styleUrl: './flashlight.css',
})
export class ProjectsFlashlight {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  /** The project in the beam (-1: none). */
  protected readonly active = signal(-1);
  protected readonly lightsOn = signal(false);

  private readonly document = inject(DOCUMENT);
  private readonly room = viewChild.required<ElementRef<HTMLElement>>('room');
  /** Set by the render loop; lets keyboard focus steer the beam. */
  private steer: (x: number, y: number) => void = () => {};

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};
    afterNextRender(() => {
      if (view) cleanup = this.setup(this.room().nativeElement, view);
    });
    inject(DestroyRef).onDestroy(() => cleanup());
  }

  protected slot(index: number): Slot {
    return SLOTS[index % SLOTS.length];
  }

  protected kinds(project: SideProject): string {
    return project.kinds.map(kindLabel).join(' · ');
  }

  protected open(index: number): void {
    const media = this.room().nativeElement.querySelector<HTMLElement>(
      `[data-project="${index}"] app-project-media`,
    );
    this.openCase.emit({ index, media });
  }

  /** Tabbing onto a print swings the torch onto it. */
  protected onFocus(tile: HTMLElement): void {
    const room = this.room().nativeElement.getBoundingClientRect();
    const box = tile.getBoundingClientRect();
    this.steer(box.left + box.width / 2 - room.left, box.top + box.height / 2 - room.top);
  }

  protected toggleLights(): void {
    this.lightsOn.update((on) => !on);
  }

  private setup(room: HTMLElement, view: Window): () => void {
    const canvas = room.querySelector('canvas');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return () => {};
    const ctx = context;
    const reduced = prefersReducedMotion(view);
    const rows = [...room.querySelectorAll<HTMLElement>('.row')];
    const beamGlow = room.querySelector<HTMLElement>('.beam');

    let width = 0;
    let height = 0;
    let radius = 200;
    let dpr = 1;
    let tiles: Box[] = [];
    let names: Box[] = [];
    let motes: Mote[] = [];

    // Light state, in room coordinates.
    let x = 0;
    let y = 0;
    let targetX = 0;
    let targetY = 0;
    let stretch = 0;
    let angle = 0;
    let darkness = 1;
    // The real pointer (for the small cursor ring).
    let pointerX = -1;
    let pointerY = -1;
    let clientX = -1;
    let clientY = -1;
    let ring = 0;
    let mode: 'wander' | 'pointer' | 'touch' | 'focus' = 'wander';
    let idleAt = 0;
    let wanderT = Math.random() * 1000;

    let frame = 0;
    let last = 0;
    let onScreen = false;

    const roomBox = () => room.getBoundingClientRect();

    const measure = () => {
      const box = roomBox();
      width = room.clientWidth;
      height = room.clientHeight;
      dpr = Math.min(1.5, view.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      radius = clamp(width * (width < 700 ? 0.42 : 0.15), 150, 270);
      if (beamGlow) beamGlow.style.width = beamGlow.style.height = `${radius * 2}px`;

      const relative = (el: Element | null): Box => {
        const b = el?.getBoundingClientRect();
        if (!b) return { left: -1e5, top: -1e5, right: -1e5, bottom: -1e5 };
        return { left: b.left - box.left, top: b.top - box.top, right: b.right - box.left, bottom: b.bottom - box.top };
      };
      tiles = rows.map((row) => relative(row.querySelector('.tile')));
      names = rows.map((row) => relative(row.querySelector('.name:not(.ghost)')));

      const count = reduced ? 0 : Math.round(clamp((width * height) / 8000, 60, 320));
      motes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.012,
        vy: -0.004 - Math.random() * 0.012,
        size: 0.5 + Math.random() * 1.5,
        alpha: 0.25 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2,
      }));

      if (!x && !y) {
        x = targetX = width * 0.5;
        y = targetY = clamp(-box.top + view.innerHeight * 0.5, radius, height - radius);
      }
      kick();
    };

    /** The slice of the room that is on screen, in room coordinates. */
    const visible = () => {
      const box = roomBox();
      const top = clamp(-box.top, 0, height);
      const bottom = clamp(view.innerHeight - box.top, 0, height);
      return { top, bottom: Math.max(bottom, top + 1) };
    };

    const wander = (dt: number) => {
      if (reduced) return;
      wanderT += dt * 0.001;
      const { top, bottom } = visible();
      const cx = width / 2;
      const cy = (top + bottom) / 2;
      targetX = cx + Math.sin(wanderT * 0.37) * width * 0.36 + Math.sin(wanderT * 0.91 + 1.3) * width * 0.06;
      targetY = cy + Math.sin(wanderT * 0.53 + 0.6) * (bottom - top) * 0.32 + Math.cos(wanderT * 1.17) * 18;
    };

    const pickActive = () => {
      const current = this.active();
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < rows.length; i++) {
        const score = Math.min(distanceTo(tiles[i], x, y), distanceTo(names[i], x, y) + radius * 0.12);
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      const keep = current >= 0 && Math.min(distanceTo(tiles[current], x, y), distanceTo(names[current], x, y) + radius * 0.12) < radius * 0.45;
      const next = keep && bestScore > 0 ? current : bestScore < radius * 0.3 ? best : -1;
      if (next !== current) this.active.set(next);
    };

    const hovering = () => {
      const i = this.active();
      if (i < 0 || pointerX < 0) return false;
      return distanceTo(tiles[i], pointerX, pointerY) === 0 || distanceTo(names[i], pointerX, pointerY) === 0;
    };

    const draw = (now: number, dt: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, width, height);

      const flicker = reduced ? 1 : 0.97 + Math.sin(now * 0.013) * 0.012 + Math.sin(now * 0.047 + 1.7) * 0.008;
      ctx.fillStyle = `rgba(3, 5, 7, ${(0.95 * darkness).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);

      // Cut the beam out of the dark: hot centre, soft spill, long falloff.
      const r = radius * flicker;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.scale(1 + stretch, 1 - stretch * 0.35);
      const beam = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      beam.addColorStop(0, 'rgba(0,0,0,1)');
      beam.addColorStop(0.36, 'rgba(0,0,0,0.97)');
      beam.addColorStop(0.5, 'rgba(0,0,0,0.8)');
      beam.addColorStop(0.66, 'rgba(0,0,0,0.42)');
      beam.addColorStop(0.84, 'rgba(0,0,0,0.12)');
      beam.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = beam;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();

      // Warm haze in the beam.
      ctx.globalCompositeOperation = 'source-over';
      const haze = ctx.createRadialGradient(x, y, 0, x, y, r * 0.9);
      haze.addColorStop(0, `rgba(255, 222, 176, ${(0.07 * darkness).toFixed(3)})`);
      haze.addColorStop(0.5, `rgba(255, 206, 150, ${(0.035 * darkness).toFixed(3)})`);
      haze.addColorStop(1, 'rgba(255, 206, 150, 0)');
      ctx.fillStyle = haze;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);

      // Dust drifting through the light.
      if (motes.length) {
        ctx.globalCompositeOperation = 'lighter';
        const reach = r * 0.95;
        for (const mote of motes) {
          mote.phase += dt * 0.0012;
          mote.x += (mote.vx + Math.sin(mote.phase) * 0.006) * dt;
          mote.y += mote.vy * dt;
          if (mote.y < -4) mote.y = height + 4;
          if (mote.x < -4) mote.x = width + 4;
          else if (mote.x > width + 4) mote.x = -4;
          const d = Math.hypot(mote.x - x, mote.y - y);
          if (d > reach) continue;
          const glow = Math.pow(1 - d / reach, 1.6) * mote.alpha * darkness;
          ctx.fillStyle = `rgba(255, 238, 210, ${glow.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(mote.x, mote.y, mote.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // A small ring marks the real pointer; it swells over something you can open.
      if (pointerX >= 0 && mode === 'pointer') {
        ring += ((hovering() ? 1 : 0) - ring) * (1 - Math.pow(0.8, dt / 16.67));
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = `rgba(255, 244, 228, ${(0.55 + ring * 0.35).toFixed(3)})`;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.arc(pointerX, pointerY, 5 + ring * 13, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 244, 228, 0.95)';
        ctx.beginPath();
        ctx.arc(pointerX, pointerY, 1.6 * (1 - ring) + 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const tick = (now: number) => {
      frame = 0;
      const dt = Math.min(48, now - (last || now));
      last = now;

      if (mode !== 'wander' && performance.now() > idleAt) mode = 'wander';
      if (mode === 'wander') wander(dt);

      const ease = reduced ? 0.3 : mode === 'touch' ? 0.2 : mode === 'wander' ? 0.035 : 0.12;
      const k = 1 - Math.pow(1 - ease, dt / 16.67);
      const vx = (targetX - x) * k;
      const vy = (targetY - y) * k;
      x += vx;
      y += vy;
      const speed = Math.hypot(vx, vy) / Math.max(1, dt);
      if (!reduced) {
        stretch += (clamp(speed * 0.09, 0, 0.22) - stretch) * 0.15;
        if (speed > 0.02) angle = Math.atan2(vy, vx);
      }
      darkness += ((this.lightsOn() ? 0 : 1) - darkness) * (1 - Math.pow(0.9, dt / 16.67));

      draw(now, dt);
      if (beamGlow) {
        // The light itself, screen-blended onto the wall (compositor-only).
        beamGlow.style.transform =
          `translate3d(${(x - radius).toFixed(1)}px, ${(y - radius).toFixed(1)}px, 0) ` +
          `rotate(${angle.toFixed(3)}rad) scale(${(1 + stretch).toFixed(3)}, ${(1 - stretch * 0.35).toFixed(3)})`;
        beamGlow.style.opacity = darkness.toFixed(3);
      }
      pickActive();
      if (onScreen && this.document.visibilityState === 'visible') frame = requestAnimationFrame(tick);
    };

    function kick() {
      if (!frame && onScreen) {
        last = 0;
        frame = requestAnimationFrame(tick);
      }
    }

    const local = (clientX: number, clientY: number) => {
      const box = roomBox();
      return { lx: clientX - box.left, ly: clientY - box.top };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      clientX = event.clientX;
      clientY = event.clientY;
      const { lx, ly } = local(clientX, clientY);
      pointerX = targetX = lx;
      pointerY = targetY = ly;
      mode = 'pointer';
      idleAt = performance.now() + 1e9;
      kick();
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pointerX = pointerY = clientX = -1;
      idleAt = performance.now() + 1400;
    };
    // The page scrolls under a resting mouse: keep the beam on the same spot of the screen.
    const onScroll = () => {
      if (mode !== 'pointer' || clientX < 0) return;
      const { lx, ly } = local(clientX, clientY);
      pointerX = targetX = lx;
      pointerY = targetY = ly;
      kick();
    };
    const onTouch = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      const { lx, ly } = local(touch.clientX, touch.clientY);
      targetX = lx;
      targetY = ly;
      if (event.type === 'touchstart' && mode !== 'touch') {
        // Snap most of the way so a tap lights what it lands on.
        x += (lx - x) * 0.7;
        y += (ly - y) * 0.7;
      }
      mode = 'touch';
      pointerX = pointerY = -1;
      idleAt = performance.now() + 1e9;
      kick();
    };
    const onTouchEnd = () => {
      idleAt = performance.now() + 2600;
    };

    this.steer = (fx, fy) => {
      targetX = fx;
      targetY = fy;
      if (reduced) {
        x = fx;
        y = fy;
      }
      mode = 'focus';
      idleAt = performance.now() + 6000;
      kick();
    };

    const io = new IntersectionObserver(([entry]) => {
      onScreen = !!entry?.isIntersecting;
      if (onScreen) kick();
    });
    io.observe(room);
    const resize = new ResizeObserver(() => measure());
    resize.observe(room);
    const onVisibility = () => kick();
    this.document.addEventListener('visibilitychange', onVisibility);
    // Rows move when web fonts land; measure again.
    this.document.fonts?.ready.then(() => measure()).catch(() => {});

    view.addEventListener('scroll', onScroll, { passive: true });
    room.addEventListener('pointermove', onPointerMove);
    room.addEventListener('pointerleave', onPointerLeave);
    room.addEventListener('touchstart', onTouch, { passive: true });
    room.addEventListener('touchmove', onTouch, { passive: true });
    room.addEventListener('touchend', onTouchEnd);
    room.addEventListener('touchcancel', onTouchEnd);
    measure();

    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      resize.disconnect();
      this.steer = () => {};
      this.document.removeEventListener('visibilitychange', onVisibility);
      view.removeEventListener('scroll', onScroll);
      room.removeEventListener('pointermove', onPointerMove);
      room.removeEventListener('pointerleave', onPointerLeave);
      room.removeEventListener('touchstart', onTouch);
      room.removeEventListener('touchmove', onTouch);
      room.removeEventListener('touchend', onTouchEnd);
      room.removeEventListener('touchcancel', onTouchEnd);
    };
  }
}
