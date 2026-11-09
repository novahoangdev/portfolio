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

/** One print on the desk: position (centre, px), rotation (deg) and their velocities. */
interface Print {
  readonly el: HTMLElement;
  x: number;
  y: number;
  rot: number;
  vx: number;
  vy: number;
  vr: number;
  w: number;
  h: number;
  /** Spring target (tidy / scatter / nudge); null while free. */
  target: { x: number; y: number; rot: number; at: number } | null;
  held: boolean;
}

/** Small seeded PRNG so the first composition is the same on every visit. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Experimental layout — a desk of polaroid prints. Grab and toss them (they
 * pivot around the point you hold), double-click or press F to flip one over
 * for handwritten notes, tidy them into a grid or scatter them again.
 */
@Component({
  selector: 'app-projects-desk',
  imports: [ProjectMediaView],
  templateUrl: './desk.html',
  styleUrl: './desk.css',
})
export class ProjectsDesk {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;
  protected readonly landed = signal(false);
  protected readonly inView = signal(false);
  protected readonly hovered = signal<number | null>(null);
  protected readonly focused = signal<number | null>(null);
  /** The top-most print (last one touched). */
  protected readonly front = signal(-1);
  protected readonly flipped = signal<ReadonlySet<number>>(new Set());
  protected readonly tidy = signal(false);

  private readonly document = inject(DOCUMENT);
  private readonly deskRef = viewChild.required<ElementRef<HTMLElement>>('desk');
  private prints: Print[] = [];
  private z = 10;
  private dragged = false;
  private pendingClick: { index: number; timer: number } | null = null;
  private wake: () => void = () => {};
  private place: (mode: 'tidy' | 'scatter') => void = () => {};

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      const desk = this.deskRef().nativeElement;
      if (!view) return;
      const reduced = prefersReducedMotion(view);
      const random = seeded(7);
      let width = desk.clientWidth;
      let height = desk.clientHeight;

      this.prints = Array.from(desk.querySelectorAll<HTMLElement>('.print')).map((el) => ({
        el,
        x: 0,
        y: 0,
        rot: 0,
        vx: 0,
        vy: 0,
        vr: 0,
        w: el.offsetWidth,
        h: el.offsetHeight,
        target: null,
        held: false,
      }));
      const prints = this.prints;

      /** Half extents of a rotated print's bounding box. */
      const extents = (p: Print, rot = p.rot) => {
        const a = (rot * Math.PI) / 180;
        const c = Math.abs(Math.cos(a));
        const s = Math.abs(Math.sin(a));
        return { hx: (p.w * c + p.h * s) / 2, hy: (p.w * s + p.h * c) / 2 };
      };
      const clampX = (p: Print, x: number, rot = p.rot) => {
        const { hx } = extents(p, rot);
        return Math.min(Math.max(x, hx + 6), Math.max(hx + 6, width - hx - 6));
      };
      const clampY = (p: Print, y: number, rot = p.rot) => {
        const { hy } = extents(p, rot);
        return Math.min(Math.max(y, hy + 6), Math.max(hy + 6, height - hy - 6));
      };

      const render = (p: Print) => {
        p.el.style.transform = `translate3d(${(p.x - p.w / 2).toFixed(2)}px, ${(p.y - p.h / 2).toFixed(2)}px, 0) rotate(${p.rot.toFixed(2)}deg)`;
        // Paper flutters in the air: a slight 3D tilt against the direction of travel.
        const tiltX = Math.max(-14, Math.min(14, -p.vy * 0.008));
        const tiltY = Math.max(-14, Math.min(14, p.vx * 0.008));
        p.el.style.setProperty('--ax', `${tiltX.toFixed(2)}deg`);
        p.el.style.setProperty('--ay', `${tiltY.toFixed(2)}deg`);
        p.el.style.setProperty('--sheen', `${(50 + p.rot * 2 + p.vx * 0.01).toFixed(1)}%`);
      };

      /** Rows of prints, centred, used by "Tidy up" and as the base of each scatter. */
      const grid = () => {
        const gap = Math.max(12, Math.min(36, width * 0.025));
        const rows: Print[][] = [[]];
        let rowWidth = 0;
        for (const p of prints) {
          const row = rows[rows.length - 1]!;
          if (row.length && rowWidth + gap + p.w > width - gap * 2) {
            rows.push([p]);
            rowWidth = p.w;
          } else {
            rowWidth += (row.length ? gap : 0) + p.w;
            row.push(p);
          }
        }
        const rowHeights = rows.map((row) => Math.max(...row.map((p) => p.h)));
        const total = rowHeights.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);
        // Too tall for the desk: let the rows overlap like a fanned pile.
        const squeeze = total > height - gap * 2 ? (height - gap * 2 - total) / Math.max(1, rows.length - 1) : 0;
        const spots = new Map<Print, { x: number; y: number }>();
        let y = Math.max(gap, (height - total - squeeze * (rows.length - 1)) / 2);
        rows.forEach((row, r) => {
          const w = row.reduce((sum, p) => sum + p.w, 0) + gap * (row.length - 1);
          let x = (width - w) / 2;
          for (const p of row) {
            spots.set(p, { x: x + p.w / 2, y: y + rowHeights[r]! / 2 });
            x += p.w + gap;
          }
          y += rowHeights[r]! + gap + squeeze;
        });
        return spots;
      };

      this.place = (mode) => {
        const spots = grid();
        const now = performance.now();
        const rand = this.prints.some((p) => p.x !== 0) ? Math.random : random;
        prints.forEach((p, i) => {
          const spot = spots.get(p)!;
          let x = spot.x;
          let y = spot.y;
          let rot = (rand() - 0.5) * 3;
          if (mode === 'scatter') {
            x += (rand() - 0.5) * p.w * 0.9;
            y += (rand() - 0.5) * p.h * 0.7;
            rot = (rand() - 0.5) * 26;
          }
          rot = rot + Math.round((p.rot - rot) / 360) * 360;
          p.target = { x: clampX(p, x, rot), y: clampY(p, y, rot), rot, at: now + i * 55 };
          p.held = false;
          if (reduced) {
            p.x = p.target.x;
            p.y = p.target.y;
            p.rot = p.target.rot;
            p.target = null;
            render(p);
          }
        });
        this.tidy.set(mode === 'tidy');
        this.flipped.set(new Set());
        this.wake();
      };

      // First composition: a scatter, applied instantly (the entrance animation is CSS).
      const spots = grid();
      prints.forEach((p) => {
        const spot = spots.get(p)!;
        p.rot = (random() - 0.5) * 22;
        p.x = clampX(p, spot.x + (random() - 0.5) * p.w * 0.8);
        p.y = clampY(p, spot.y + (random() - 0.5) * p.h * 0.6);
        render(p);
      });
      prints.forEach((p) => (p.el.style.zIndex = String(++this.z)));
      this.front.set(prints.length - 1);

      // ---- Simulation loop (only runs while something moves) ----
      let frame = 0;
      let last = 0;
      let running = false;
      const step = (now: number) => {
        const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
        last = now;
        let busy = false;
        for (const p of prints) {
          if (p.held) {
            busy = true;
            // Let the flutter settle when the pointer pauses.
            const calm = Math.exp(-9 * dt);
            p.vx *= calm;
            p.vy *= calm;
            render(p);
            continue;
          }
          if (p.target) {
            if (now < p.target.at) {
              busy = true;
              continue;
            }
            // Under-damped spring: glides over and settles with a small overshoot.
            const k = 150;
            const c = 2 * Math.sqrt(k) * 0.72;
            p.vx += (k * (p.target.x - p.x) - c * p.vx) * dt;
            p.vy += (k * (p.target.y - p.y) - c * p.vy) * dt;
            p.vr += (k * (p.target.rot - p.rot) - c * p.vr) * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;
            const far = Math.hypot(p.target.x - p.x, p.target.y - p.y);
            p.el.classList.toggle('is-flying', far > 40);
            if (far < 0.4 && Math.abs(p.target.rot - p.rot) < 0.1 && Math.hypot(p.vx, p.vy) < 4 && Math.abs(p.vr) < 2) {
              p.x = p.target.x;
              p.y = p.target.y;
              p.rot = p.target.rot;
              p.vx = p.vy = p.vr = 0;
              p.target = null;
              p.el.classList.remove('is-flying');
            } else busy = true;
            render(p);
            continue;
          }
          const speed = Math.hypot(p.vx, p.vy);
          if (speed < 2 && Math.abs(p.vr) < 1) {
            p.vx = p.vy = p.vr = 0;
            continue;
          }
          busy = true;
          // Paper sliding on wood: friction, and spin that fades.
          const friction = Math.exp(-4.2 * dt);
          p.vx *= friction;
          p.vy *= friction;
          p.vr *= Math.exp(-3.6 * dt);
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          // Bounce softly off the desk edges, picking up a little spin.
          const { hx, hy } = extents(p);
          if (p.x < hx + 4 || p.x > width - hx - 4) {
            p.x = clampX(p, p.x);
            p.vr += p.vy * 0.06 * (p.x < width / 2 ? -1 : 1);
            p.vx *= -0.38;
          }
          if (p.y < hy + 4 || p.y > height - hy - 4) {
            p.y = clampY(p, p.y);
            p.vr += p.vx * 0.06 * (p.y < height / 2 ? 1 : -1);
            p.vy *= -0.38;
          }
          render(p);
        }
        if (busy) frame = requestAnimationFrame(step);
        else running = false;
      };
      this.wake = () => {
        if (running) return;
        running = true;
        last = performance.now();
        frame = requestAnimationFrame(step);
      };

      // ---- Grab, drag and throw ----
      let active: Print | null = null;
      let pointerId: number | null = null;
      let grabLocal = { x: 0, y: 0 };
      let startX = 0;
      let startY = 0;
      let samples: { x: number; y: number; t: number }[] = [];

      const local = (event: PointerEvent) => {
        const rect = desk.getBoundingClientRect();
        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
      };
      const onDown = (event: PointerEvent) => {
        if (event.button !== 0 || pointerId !== null) return;
        const target = event.target as HTMLElement;
        if (target.closest('.flip, .note-open')) return;
        const el = target.closest<HTMLElement>('.print');
        const p = prints.find((print) => print.el === el);
        if (!p) return;
        const index = prints.indexOf(p);
        this.bringToFront(index);
        this.dragged = false;
        pointerId = event.pointerId;
        active = p;
        const at = local(event);
        startX = at.x;
        startY = at.y;
        samples = [{ ...at, t: event.timeStamp }];
        // Remember where on the print it was grabbed (in the print's own frame).
        const a = (-p.rot * Math.PI) / 180;
        const dx = at.x - p.x;
        const dy = at.y - p.y;
        grabLocal = { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
        p.target = null;
        p.el.classList.remove('is-flying');
      };
      const onMove = (event: PointerEvent) => {
        if (event.pointerId !== pointerId || !active) return;
        const p = active;
        const at = local(event);
        if (!this.dragged) {
          if (Math.hypot(at.x - startX, at.y - startY) < 5) return;
          this.dragged = true;
          this.cancelPendingClick();
          p.held = true;
          p.vx = p.vy = p.vr = 0;
          p.el.classList.add('is-held');
          desk.classList.add('is-dragging');
          try {
            desk.setPointerCapture(event.pointerId);
          } catch {
            // Capture can fail if the pointer is already gone.
          }
          this.tidy.set(false);
          this.wake();
        }
        event.preventDefault();
        const prev = samples[samples.length - 1]!;
        samples.push({ ...at, t: event.timeStamp });
        while (samples.length > 2 && event.timeStamp - samples[0]!.t > 90) samples.shift();
        const dtMove = Math.max(1, event.timeStamp - prev.t) / 1000;
        const mvx = (at.x - prev.x) / dtMove;
        const mvy = (at.y - prev.y) / dtMove;

        if (!reduced) {
          // Dragged by a corner, the print's centre trails behind the pointer (friction at the centre).
          const a = (p.rot * Math.PI) / 180;
          const ox = grabLocal.x * Math.cos(a) - grabLocal.y * Math.sin(a);
          const oy = grabLocal.x * Math.sin(a) + grabLocal.y * Math.cos(a);
          const lever = Math.hypot(ox, oy) / (Math.max(p.w, p.h) / 2);
          const speed = Math.hypot(mvx, mvy);
          if (speed > 30 && lever > 0.05) {
            const want = Math.atan2(-mvy, -mvx);
            const have = Math.atan2(-oy, -ox);
            const torque = Math.sin(want - have) * Math.min(speed, 2400) * lever * 0.6;
            p.vr += torque * dtMove;
          }
          p.vr *= Math.exp(-7 * dtMove);
          // Keep it readable: a soft pull back once it turns past ±40°.
          const over = Math.abs(p.rot) > 40 ? p.rot - Math.sign(p.rot) * 40 : 0;
          p.vr -= over * 18 * dtMove;
          p.rot += p.vr * dtMove;
          p.vx = mvx;
          p.vy = mvy;
        }
        const a = (p.rot * Math.PI) / 180;
        const ox = grabLocal.x * Math.cos(a) - grabLocal.y * Math.sin(a);
        const oy = grabLocal.x * Math.sin(a) + grabLocal.y * Math.cos(a);
        p.x = clampX(p, at.x - ox);
        p.y = clampY(p, at.y - oy);
      };
      const onUp = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        pointerId = null;
        const p = active;
        active = null;
        desk.classList.remove('is-dragging');
        if (!p || !p.held) return;
        p.held = false;
        p.el.classList.remove('is-held');
        if (reduced) {
          p.vx = p.vy = p.vr = 0;
          render(p);
          return;
        }
        // Throw with the pointer's recent velocity.
        const first = samples[0]!;
        const lastSample = samples[samples.length - 1]!;
        const span = Math.max(16, lastSample.t - first.t) / 1000;
        const stale = event.timeStamp - lastSample.t > 80;
        const vx = stale ? 0 : (lastSample.x - first.x) / span;
        const vy = stale ? 0 : (lastSample.y - first.y) / span;
        const speed = Math.hypot(vx, vy);
        const cap = speed > 3200 ? 3200 / speed : 1;
        p.vx = vx * cap;
        p.vy = vy * cap;
        p.vr += vx * cap * 0.025;
        this.wake();
      };

      desk.addEventListener('pointerdown', onDown);
      desk.addEventListener('pointermove', onMove, { passive: false });
      desk.addEventListener('pointerup', onUp);
      desk.addEventListener('pointercancel', onUp);

      // Arrow keys nudge the focused print.
      this.nudgeBy = (index, dx, dy) => {
        const p = prints[index];
        if (!p) return;
        const x = clampX(p, (p.target?.x ?? p.x) + dx);
        const y = clampY(p, (p.target?.y ?? p.y) + dy);
        if (reduced) {
          p.x = x;
          p.y = y;
          render(p);
          return;
        }
        p.target = { x, y, rot: p.target?.rot ?? p.rot + (Math.random() - 0.5) * 3, at: 0 };
        this.tidy.set(false);
        this.wake();
      };

      // Flipping picks the print up to read: straighten it and keep the zoomed print on the desk.
      this.reveal = (index) => {
        const p = prints[index];
        if (!p) return;
        const read = Math.min(1.6, Math.max(1.1, 250 / p.w));
        p.el.style.setProperty('--read', read.toFixed(3));
        const rot = Math.round(p.rot / 360) * 360 + (Math.random() - 0.5) * 3;
        const hx = (p.w * read) / 2 + 8;
        const hy = (p.h * read) / 2 + 8;
        const x = Math.min(Math.max(p.x, hx), Math.max(hx, width - hx));
        const y = Math.min(Math.max(p.y, hy), Math.max(hy, height - hy));
        if (reduced) {
          p.x = x;
          p.y = y;
          p.rot = rot;
          render(p);
          return;
        }
        p.target = { x, y, rot, at: 0 };
        this.tidy.set(false);
        this.wake();
      };

      // Re-fit on resize: keep relative positions; re-tidy if tidy.
      const resize = new ResizeObserver(() => {
        const w = desk.clientWidth;
        const h = desk.clientHeight;
        if (w === width && h === height) return;
        const sx = w / width;
        const sy = h / height;
        width = w;
        height = h;
        for (const p of prints) {
          p.w = p.el.offsetWidth;
          p.h = p.el.offsetHeight;
          p.x = clampX(p, p.x * sx);
          p.y = clampY(p, p.y * sy);
          if (p.target) p.target = { ...p.target, x: clampX(p, p.target.x * sx), y: clampY(p, p.target.y * sy) };
          render(p);
        }
        if (this.tidy()) this.place('tidy');
      });
      resize.observe(desk);

      // Deal the prints when the desk scrolls into view; pause videos off screen.
      const io = new IntersectionObserver(
        ([entry]) => {
          const visible = !!entry?.isIntersecting;
          this.inView.set(visible);
          if (visible && !this.landed()) this.landed.set(true);
        },
        { threshold: 0.2 },
      );
      io.observe(desk);

      cleanup = () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        io.disconnect();
        this.cancelPendingClick();
        desk.removeEventListener('pointerdown', onDown);
        desk.removeEventListener('pointermove', onMove);
        desk.removeEventListener('pointerup', onUp);
        desk.removeEventListener('pointercancel', onUp);
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }

  private nudgeBy: (index: number, dx: number, dy: number) => void = () => {};
  private reveal: (index: number) => void = () => {};

  protected playing(index: number): boolean {
    if (!this.inView() || !this.landed()) return false;
    return index === this.hovered() || index === this.focused() || index === this.front();
  }

  protected isFlipped(index: number): boolean {
    return this.flipped().has(index);
  }

  /** Small per-print variety for the tape and caption (stable across renders). */
  protected tapeAngle(index: number): number {
    return [-6, 4, -2, 7, -8, 3, -4, 5][index % 8]!;
  }

  protected tapeStyle(index: number): 'top' | 'corners' {
    return index % 3 === 1 ? 'corners' : 'top';
  }

  protected tidyUp(): void {
    this.place('tidy');
  }

  protected scatter(): void {
    this.place('scatter');
  }

  protected onFrontClick(index: number, event: MouseEvent): void {
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    // Keyboard activation (Enter / Space) opens straight away.
    if (event.detail === 0) {
      this.open(index);
      return;
    }
    if (this.pendingClick?.index === index) {
      this.cancelPendingClick();
      this.toggleFlip(index);
      return;
    }
    this.cancelPendingClick();
    const view = this.document.defaultView;
    if (!view) return;
    // Wait a beat: a second click flips the print instead of opening it.
    this.pendingClick = { index, timer: view.setTimeout(() => {
      this.pendingClick = null;
      this.open(index);
    }, 240) };
  }

  protected toggleFlip(index: number, moveFocus = false): void {
    this.bringToFront(index);
    const next = new Set(this.flipped());
    const flipping = !next.has(index);
    if (flipping) {
      next.add(index);
      this.reveal(index);
    } else next.delete(index);
    this.flipped.set(next);
    if (moveFocus) {
      // Follow the visible face once the inert state has been updated.
      this.document.defaultView?.setTimeout(() => {
        const print = this.prints[index]?.el;
        print?.querySelector<HTMLElement>(flipping ? '.note-open' : '.front')?.focus({ preventScroll: true });
      });
    }
  }

  protected onKey(index: number, event: KeyboardEvent): void {
    const step = event.shiftKey ? 48 : 14;
    switch (event.key) {
      case 'ArrowLeft':
        this.nudgeBy(index, -step, 0);
        break;
      case 'ArrowRight':
        this.nudgeBy(index, step, 0);
        break;
      case 'ArrowUp':
        this.nudgeBy(index, 0, -step);
        break;
      case 'ArrowDown':
        this.nudgeBy(index, 0, step);
        break;
      case 'f':
      case 'F':
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        this.toggleFlip(index, true);
        break;
      case 'Escape':
        if (!this.isFlipped(index)) return;
        this.toggleFlip(index, true);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  protected onFocus(index: number): void {
    this.focused.set(index);
    this.bringToFront(index);
  }

  protected open(index: number): void {
    const print = this.prints[index]?.el ?? null;
    if (this.isFlipped(index) && print) {
      // Turn it face up instantly so the photo can morph into the case view.
      print.classList.add('no-flip-anim');
      print.classList.remove('is-flipped');
      const next = new Set(this.flipped());
      next.delete(index);
      this.flipped.set(next);
      this.document.defaultView?.setTimeout(() => print.classList.remove('no-flip-anim'), 400);
    }
    this.openCase.emit({ index, media: print?.querySelector<HTMLElement>('app-project-media') ?? null });
  }

  private bringToFront(index: number): void {
    const p = this.prints[index];
    if (!p) return;
    if (this.front() !== index) {
      p.el.style.zIndex = String(++this.z);
      this.front.set(index);
    }
  }

  private cancelPendingClick(): void {
    if (!this.pendingClick) return;
    this.document.defaultView?.clearTimeout(this.pendingClick.timer);
    this.pendingClick = null;
  }

}
