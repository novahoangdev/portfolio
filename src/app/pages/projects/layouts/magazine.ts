import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  afterRenderEffect,
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
import { ProjectMedia, SideProject } from '../../../data/projects';
import { ProjectMediaView } from '../project-media';
import { canHover, kindLabel, OpenCase, pad, prefersReducedMotion } from './shared';

type PageKind = 'cover' | 'contents-left' | 'contents' | 'media' | 'text' | 'index-left' | 'index' | 'back';

interface Page {
  readonly kind: PageKind;
  /** Printed page number (1 = cover). */
  readonly folio: number;
  readonly project?: number;
  /** Left-hand (verso) page in the two-page spread. */
  readonly verso: boolean;
}

interface Leaf {
  readonly key: string;
  readonly front: Page;
  readonly back: Page | null;
}

interface IndexEntry {
  readonly name: string;
  readonly pages: readonly number[];
}

/** CSS-style cubic-bezier easing (x1, y1, x2, y2). */
function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sampleX(t) - x;
      const d = slopeX(t);
      if (Math.abs(err) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    t = Math.min(1, Math.max(0, t));
    return sampleY(t);
  };
}

const turnEase = bezier(0.3, 0.05, 0.16, 1);
const glide = bezier(0.16, 1, 0.3, 1);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
  ease: (t: number) => number;
}

/** Layout — Magazine: a printed issue with real 3D page turns, one spread per project. */
@Component({
  selector: 'app-projects-magazine',
  imports: [NgTemplateOutlet, ProjectMediaView],
  templateUrl: './magazine.html',
  styleUrl: './magazine.css',
})
export class ProjectsMagazine {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;

  /** ≤ 760px: one page at a time, swipe to flip. */
  protected readonly single = signal(false);
  /** Leaves turned (two-page mode) or pages turned (single mode). */
  protected readonly turned = signal(0);
  protected readonly onScreen = signal(false);

  protected readonly issue = computed(() => pad(this.projects().length));

  /** Cover image: the first portrait demo (it fills a portrait cover), else the featured one. */
  protected readonly coverMedia = computed<ProjectMedia>(() => {
    const list = this.projects();
    for (const p of list) {
      for (const m of [p.media, ...(p.extraMedia ?? [])]) if (m.shape === 'portrait') return m;
    }
    return (list.find((p) => p.featured) ?? list[0]).media;
  });

  protected readonly coverProject = computed(() => {
    const list = this.projects();
    const media = this.coverMedia();
    return list.find((p) => p.media === media || p.extraMedia?.includes(media)) ?? list[0];
  });

  protected readonly coverLines = computed(() =>
    this.projects()
      .filter((p) => p !== this.coverProject())
      .slice(0, 4),
  );

  protected readonly kindsAll = computed(() => [
    ...new Set(this.projects().flatMap((p) => p.kinds.map(kindLabel))),
  ]);

  protected readonly pages = computed<readonly Page[]>(() => {
    const kinds: { kind: PageKind; project?: number }[] = [{ kind: 'cover' }, { kind: 'contents-left' }, { kind: 'contents' }];
    this.projects().forEach((_, project) => kinds.push({ kind: 'media', project }, { kind: 'text', project }));
    kinds.push({ kind: 'index-left' }, { kind: 'index' }, { kind: 'back' });
    return kinds.map((k, i) => ({ ...k, folio: i + 1, verso: i % 2 === 1 }));
  });

  protected readonly leaves = computed<readonly Leaf[]>(() => {
    const pages = this.pages();
    if (this.single()) return pages.map((front) => ({ key: `s${front.folio}`, front, back: null }));
    const leaves: Leaf[] = [];
    for (let i = 0; i < pages.length; i += 2) {
      leaves.push({ key: `d${i}`, front: pages[i], back: pages[i + 1] ?? null });
    }
    return leaves;
  });

  /** Highest `turned` value: the back cover lying closed (two-page) / the last page (single). */
  protected readonly maxTurn = computed(() => (this.single() ? this.leaves().length - 1 : this.leaves().length));

  /** Pages currently facing the reader. */
  protected readonly visiblePages = computed<readonly Page[]>(() => {
    const t = this.turned();
    const leaves = this.leaves();
    if (this.single()) return [leaves[t]?.front].filter((p): p is Page => !!p);
    return [leaves[t - 1]?.back, leaves[t]?.front].filter((p): p is Page => !!p);
  });

  protected readonly playingProject = computed(() => {
    if (!this.onScreen()) return null;
    return this.visiblePages().find((p) => p.kind === 'media')?.project ?? null;
  });

  protected readonly coverVisible = computed(() => this.visiblePages().some((p) => p.kind === 'cover'));

  /** Page number where each project's spread starts. */
  protected readonly projectFolio = computed(() => {
    const map = new Map<number, number>();
    for (const p of this.pages()) if (p.kind === 'media' && p.project !== undefined) map.set(p.project, p.folio);
    return map;
  });

  protected readonly techIndex = computed<readonly IndexEntry[]>(() => {
    const folios = this.projectFolio();
    const map = new Map<string, number[]>();
    this.projects().forEach((p, i) => {
      for (const t of p.technologies) {
        const list = map.get(t) ?? [];
        list.push((folios.get(i) ?? 0) + 1);
        map.set(t, list);
      }
    });
    return [...map.entries()]
      .map(([name, pages]) => ({ name, pages }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /** Stops on the progress rail: one per spread (two-page) or per page (single). */
  protected readonly stops = computed(() => {
    const leaves = this.leaves();
    const list = this.projects();
    const stops: { label: string; accent: string | null }[] = [];
    for (let t = 0; t <= this.maxTurn(); t++) {
      const pages = this.single()
        ? [leaves[t]?.front]
        : [leaves[t - 1]?.back, leaves[t]?.front];
      const page = pages.find((p) => p && p.project !== undefined) ?? pages.find((p) => !!p);
      const project = page?.project !== undefined ? list[page.project] : null;
      stops.push({ label: project ? project.name : this.pageLabel(page?.kind), accent: project?.accent ?? null });
    }
    return stops;
  });

  protected readonly currentLabel = computed(() => this.stops()[this.turned()]?.label ?? '');

  private readonly document = inject(DOCUMENT);
  private readonly root = viewChild.required<ElementRef<HTMLElement>>('root');
  private readonly rootRef = viewChild<ElementRef<HTMLElement>>('root');

  private goImpl: (target: number) => void = () => {};
  private suppressClick = false;

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    // The cover is a plain decorative <video>: play it only while the cover faces the reader.
    afterRenderEffect(() => {
      this.single();
      const video = this.rootRef()?.nativeElement.querySelector<HTMLVideoElement>('video.pg-cover-video');
      if (!video) return;
      if (this.coverVisible() && this.onScreen() && !prefersReducedMotion(view)) {
        video.muted = true;
        video.play().catch(() => {
          // Autoplay may be blocked; the poster stays.
        });
      } else video.pause();
    });

    afterNextRender(() => {
      if (!view) return;
      const root = this.root().nativeElement;
      const book = root.querySelector<HTMLElement>('.mz-book')!;
      const reduced = prefersReducedMotion(view);
      const hover = canHover(view);

      const mq = view.matchMedia('(max-width: 760px)');
      this.single.set(mq.matches);

      /** Current angle (0 = lying right, 180 = lying left) per leaf. */
      let angles: number[] = [];
      const tweens = new Map<number, Tween>();
      let frame = 0;
      let dragLeaf: number | null = null;
      /** Leaf peeled by hovering an edge (and the angle it rests at). */
      let peeled: number | null = null;
      let skew = 1;

      const leafEls = () => [...book.querySelectorAll<HTMLElement>('.mz-leaf')];
      const reset = () => {
        const n = this.leaves().length;
        const t = clamp(this.turned(), 0, this.maxTurn());
        angles = Array.from({ length: n }, (_, k) => (k < t ? 180 : 0));
        tweens.clear();
        dragLeaf = null;
        peeled = null;
      };

      /* ---------- Paint ---------- */

      const paint = () => {
        const els = leafEls();
        const n = els.length;
        const single = this.single();
        const settledTurn = angles.filter((a) => a >= 90).length;
        let castRight = 0;
        let castLeft = 0;
        let edge = 0;
        els.forEach((el, k) => {
          const a = angles[k] ?? 0;
          const moving = a > 0.01 && a < 179.99;
          const near = k >= settledTurn - 2 && k <= settledTurn + 1;
          el.classList.toggle('is-away', !moving && !near);
          el.classList.toggle('is-moving', moving);
          const p = a / 180;
          const lift = Math.sin(p * Math.PI);
          const z = moving ? 1000 + (a >= 90 ? k : n - k) : a >= 90 ? k + 1 : n - k + 1;
          el.style.zIndex = String(z);
          el.style.transform = `rotateY(${(-a).toFixed(2)}deg) translateZ(${(lift * 2).toFixed(2)}px) skewY(${(skew * lift * (single ? 1.5 : 2.6)).toFixed(3)}deg)`;
          el.style.setProperty('--front', String(Math.min(1, p * 2)));
          el.style.setProperty('--back', String(Math.min(1, (1 - p) * 2)));
          el.style.setProperty('--sheen', lift.toFixed(3));
          el.style.setProperty('--p', p.toFixed(4));
          el.style.opacity = single && a > 90 ? String(clamp(1 - (a - 90) / 70, 0, 1)) : '';
          if (moving) {
            const cos = Math.cos(p * Math.PI);
            if (a < 90) {
              castRight = Math.max(castRight, lift);
              edge = cos;
            } else {
              castLeft = Math.max(castLeft, lift);
              edge = -cos;
            }
          }
        });
        book.style.setProperty('--cast-right', castRight.toFixed(3));
        book.style.setProperty('--cast-left', castLeft.toFixed(3));
        book.style.setProperty('--edge', `${(edge * 100).toFixed(2)}%`);
        // Paper thickness: how many leaves rest on each side.
        book.style.setProperty('--left-count', String(Math.max(0, settledTurn - 1)));
        book.style.setProperty('--right-count', String(Math.max(0, n - settledTurn - 1)));
                book.style.setProperty('--has-left', angles.some((a) => a >= 90) ? '1' : '0');
        book.style.setProperty('--has-right', angles.some((a) => a < 90) ? '1' : '0');
        // A closed magazine sits centred on its cover (or back cover) and slides open with the turn.
        if (!single) {
          const ease = (deg: number) => (1 - Math.cos((deg * Math.PI) / 180)) / 2;
          const shift = -(1 - ease(angles[0] ?? 0)) + ease(angles[n - 1] ?? 0);
          book.style.setProperty('--shift', shift.toFixed(4));
        } else {
          book.style.setProperty('--shift', '0');
        }
      };

      const tick = (now: number) => {
        frame = 0;
        for (const [k, tw] of tweens) {
          const t = clamp((now - tw.start) / tw.duration, 0, 1);
          if (now < tw.start) continue;
          angles[k] = tw.from + (tw.to - tw.from) * tw.ease(t);
          if (t >= 1) {
            angles[k] = tw.to;
            tweens.delete(k);
          }
        }
        paint();
        if (tweens.size) frame = requestAnimationFrame(tick);
        else root.classList.remove('is-turning');
      };
      /** One rAF loop for drags and tweens: a separate paint-only frame could swallow a tween's first tick. */
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(tick);
      };
      const run = () => {
        root.classList.add('is-turning');
        schedule();
      };
      /** Send every leaf that is neither tweening nor being dragged back to rest. */
      const settle = () => {
        const t = this.turned();
        angles.forEach((a, k) => {
          const rest = k < t ? 180 : 0;
          if (k !== dragLeaf && k !== peeled && !tweens.has(k) && a !== rest) tweenLeaf(k, rest, 450, 0, glide);
        });
      };
      const tweenLeaf = (k: number, to: number, duration: number, delay = 0, ease = turnEase) => {
        tweens.set(k, { from: angles[k] ?? 0, to, start: performance.now() + delay, duration, ease });
        run();
      };

      const fade = () => {
        book.classList.remove('is-fading');
        void book.offsetWidth;
        book.classList.add('is-fading');
      };

      /** Turn to `target` (a `turned` value); several leaves riffle in sequence. */
      const go = (target: number) => {
        target = clamp(target, 0, this.maxTurn());
        const from = this.turned();
        peeled = null;
        if (target === from && !tweens.size) {
          // Settle anything resting mid-air (e.g. after a peel).
          angles.forEach((a, k) => {
            const rest = k < target ? 180 : 0;
            if (a !== rest) tweenLeaf(k, rest, 450, 0, glide);
          });
          return;
        }
        this.turned.set(target);
        // Focus inside a page that is about to be hidden would be lost: keep it on the magazine.
        if (book.contains(this.document.activeElement)) root.focus({ preventScroll: true });
        if (reduced) {
          angles = angles.map((_, k) => (k < target ? 180 : 0));
          tweens.clear();
          fade();
          paint();
          return;
        }
        const span = Math.abs(target - from);
        const gap = span > 1 ? clamp(420 / span, 55, 120) : 0;
        const duration = span > 1 ? 760 : 980;
        let order = 0;
        if (target > from) {
          for (let k = 0; k < angles.length; k++) {
            if (k < target && (angles[k] ?? 0) < 180) tweenLeaf(k, 180, duration, order++ * gap);
          }
        } else {
          for (let k = angles.length - 1; k >= 0; k--) {
            if (k >= target && (angles[k] ?? 0) > 0) tweenLeaf(k, 0, duration, order++ * gap);
          }
        }
      };
      this.goImpl = go;

      /* ---------- Layout switch (two-page ⇄ single) ---------- */

      const onMode = () => {
        const single = mq.matches;
        if (single === this.single()) return;
        const t = this.turned();
        this.single.set(single);
        // Keep the reader on the same content.
        this.turned.set(single ? (t === 0 ? 0 : Math.min(2 * t - 1, this.maxTurn())) : Math.ceil(t / 2));
        reset();
        requestAnimationFrame(() => requestAnimationFrame(paint));
      };
      mq.addEventListener('change', onMode);
      reset();
      paint();

      /* ---------- Dragging the page ---------- */

      let pointerId: number | null = null;
      let startX = 0;
      let startY = 0;
      let grab = 1;
      let dir: 1 | -1 = 1;
      let dragging = false;
      let lastX = 0;
      let lastT = 0;
      let velocity = 0;
      let downInEdge: 'next' | 'prev' | null = null;

      const geometry = () => {
        const rect = book.getBoundingClientRect();
        const single = this.single();
        const pw = single ? rect.width : rect.width / 2;
        const spine = single ? rect.left : rect.left + rect.width / 2;
        return { rect, pw, spine, single };
      };

      /** Which edge zone (if any) a point sits in. */
      const zoneAt = (x: number): 'next' | 'prev' | null => {
        const { rect, pw, single } = geometry();
        if (single) {
          if (x > rect.right - pw * 0.3) return 'next';
          if (x < rect.left + pw * 0.3) return 'prev';
          return null;
        }
        if (x > rect.right - pw * 0.16) return 'next';
        if (x < rect.left + pw * 0.16) return 'prev';
        return null;
      };

      const onDown = (e: PointerEvent) => {
        this.suppressClick = false;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (pointerId !== null) return;
        const target = e.target as Element;
        // Mouse drags start on paper only; a finger may swipe from anywhere on the page.
        const onControl = !!target.closest('a, button');
        if (onControl && e.pointerType === 'mouse' && !target.closest('.mz-photo')) return;
        pointerId = e.pointerId;
        startX = lastX = e.clientX;
        startY = e.clientY;
        lastT = performance.now();
        velocity = 0;
        dragging = false;
        downInEdge = onControl ? null : zoneAt(e.clientX);
      };

      const beginDrag = (e: PointerEvent): boolean => {
        const { pw, spine, single } = geometry();
        const t = this.turned();
        if (single) dir = e.clientX < startX ? 1 : -1;
        else dir = startX >= spine ? 1 : -1;
        const leaf = dir === 1 ? t : t - 1;
        if (leaf < 0 || leaf >= angles.length || (dir === 1 && t >= this.maxTurn())) return false;
        // Take this leaf over; turns in flight on other leaves finish on their own.
        tweens.delete(leaf);
        if (peeled !== null && peeled !== leaf) tweenLeaf(peeled, peeled < t ? 180 : 0, 520, 0, glide);
        peeled = null;
        root.classList.remove('is-peeling');
        dragLeaf = leaf;
        grab = clamp(Math.abs(startX - spine) / pw, 0.35, 1);
        const rect = book.getBoundingClientRect();
        skew = startY > rect.top + rect.height / 2 ? 1 : -1;
        dragging = true;
        root.classList.add('is-dragging');
        try {
          book.setPointerCapture(e.pointerId);
        } catch {
          // The pointer may already be gone.
        }
        return true;
      };

      const onMove = (e: PointerEvent) => {
        if (pointerId === null) {
          if (hover && e.pointerType === 'mouse') hoverPeel(e);
          return;
        }
        if (e.pointerId !== pointerId) return;
        // The button is up but the pointerup never reached us: release now.
        if (e.pointerType === 'mouse' && e.buttons === 0) {
          onUp(e);
          return;
        }
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragging) {
          if (Math.abs(dx) < 7 || Math.abs(dx) < Math.abs(dy)) {
            if (Math.abs(dy) > 12) pointerId = null; // a vertical scroll, not a turn
            return;
          }
          if (!beginDrag(e)) {
            pointerId = null;
            return;
          }
          this.suppressClick = true;
        }
        const now = performance.now();
        velocity = velocity * 0.4 + ((e.clientX - lastX) / Math.max(1, now - lastT)) * 0.6;
        lastX = e.clientX;
        lastT = now;
        if (dragLeaf === null) return;
        const { pw, spine, single } = geometry();
        let a: number;
        if (single) {
          const progress = clamp((dir === 1 ? -dx : dx) / (pw * 0.85), 0, 1);
          a = dir === 1 ? progress * 180 : 180 - progress * 180;
        } else {
          a = (Math.acos(clamp((e.clientX - spine) / (grab * pw), -1, 1)) * 180) / Math.PI;
        }
        if (reduced) return;
        angles[dragLeaf] = clamp(a, 0, 180);
        schedule();
      };

      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        pointerId = null;
        // The click (if any) follows this pointerup in the same task; never let the flag outlive it.
        view.setTimeout(() => (this.suppressClick = false), 0);
        root.classList.remove('is-dragging');
        if (!dragging) {
          // A tap on the page edge turns the page (a cancelled or lost pointer is not a tap).
          if (e.type === 'pointerup' && downInEdge && downInEdge === zoneAt(e.clientX)) {
            this.suppressClick = true;
            const t = this.turned();
            go(downInEdge === 'next' ? t + 1 : t - 1);
          }
          return;
        }
        dragging = false;
        const k = dragLeaf;
        dragLeaf = null;
        if (k === null) return;
        const a = angles[k] ?? 0;
        if (performance.now() - lastT > 120) velocity = 0;
        // Flicks win over position; otherwise the page falls the way it leans.
        const flick = Math.abs(velocity) > 0.45 ? (velocity < 0 ? 1 : -1) : 0;
        const forward = flick ? flick === 1 : this.single() ? (dir === 1 ? a > 50 : a > 130) : a > 90;
        const t = this.turned();
        if (reduced) {
          const moved = Math.abs(e.clientX - startX) > 40;
          if (moved) go(dir === 1 ? t + 1 : t - 1);
          return;
        }
        const to = forward ? 180 : 0;
        const remaining = Math.abs(to - a) / 180;
        tweenLeaf(k, to, 260 + remaining * 620, 0, glide);
        const next = forward ? k + 1 : k;
        if (next !== t) this.turned.set(next);
        settle();
      };

      // Capture taken away from the book without a pointerup (it bubbles: ignore a child handing capture to the book).
      const onLostCapture = (e: PointerEvent) => {
        if (e.target === book) onUp(e);
      };

      // Swallow the click that follows a drag or an edge tap.
      const onClickCapture = (e: MouseEvent) => {
        if (!this.suppressClick) return;
        this.suppressClick = false;
        e.stopPropagation();
        e.preventDefault();
      };

      /* ---------- Hover: lift the corner under the mouse ---------- */

      const hoverPeel = (e: PointerEvent) => {
        if (reduced || tweens.size > (peeled !== null ? 1 : 0)) return;
        const zone = zoneAt(e.clientX);
        const { rect } = geometry();
        const inside = e.clientY > rect.top && e.clientY < rect.bottom;
        const t = this.turned();
        const leaf = inside ? (zone === 'next' && t < this.maxTurn() ? t : zone === 'prev' && t > 0 ? t - 1 : null) : null;
        if (leaf === peeled) return;
        if (peeled !== null) tweenLeaf(peeled, peeled < t ? 180 : 0, 520, 0, glide);
        peeled = leaf;
        root.classList.toggle('is-peeling', leaf !== null);
        if (leaf !== null) {
          skew = e.clientY > rect.top + rect.height / 2 ? 1 : -1;
          tweenLeaf(leaf, leaf < t ? 180 - 16 : 16, 620, 0, glide);
        }
      };
      const onLeave = () => {
        if (peeled === null || pointerId !== null) return;
        const t = this.turned();
        tweenLeaf(peeled, peeled < t ? 180 : 0, 520, 0, glide);
        peeled = null;
        root.classList.remove('is-peeling');
      };

      /* ---------- Visibility + first peek ---------- */

      let peeked = false;
      const io = new IntersectionObserver(
        ([entry]) => {
          const on = !!entry?.isIntersecting;
          this.onScreen.set(on);
          if (on && !peeked && (entry?.intersectionRatio ?? 0) > 0.5 && !reduced && this.turned() === 0) {
            peeked = true;
            skew = 1;
            const k = 0;
            tweens.set(k, { from: 0, to: 24, start: performance.now() + 500, duration: 700, ease: glide });
            run();
            view.setTimeout(() => {
              if (this.turned() === 0 && dragLeaf === null && peeled === null) tweenLeaf(k, 0, 900, 0, glide);
            }, 1300);
          }
        },
        { threshold: [0, 0.55] },
      );
      io.observe(root);

      book.addEventListener('pointerdown', onDown);
      book.addEventListener('pointermove', onMove);
      book.addEventListener('pointerup', onUp);
      book.addEventListener('pointercancel', onUp);
      book.addEventListener('lostpointercapture', onLostCapture);
      book.addEventListener('pointerleave', onLeave);
      book.addEventListener('click', onClickCapture, true);

      cleanup = () => {
        cancelAnimationFrame(frame);
        io.disconnect();
        mq.removeEventListener('change', onMode);
        book.removeEventListener('pointerdown', onDown);
        book.removeEventListener('pointermove', onMove);
        book.removeEventListener('pointerup', onUp);
        book.removeEventListener('pointercancel', onUp);
        book.removeEventListener('lostpointercapture', onLostCapture);
        book.removeEventListener('pointerleave', onLeave);
        book.removeEventListener('click', onClickCapture, true);
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }

  /* ---------- Template API ---------- */

  protected go(target: number): void {
    this.goImpl(target);
  }

  protected step(delta: number): void {
    this.goImpl(this.turned() + delta);
  }

  /** Jump to the spread / page where a project starts. */
  protected goToProject(project: number): void {
    const folio = this.projectFolio().get(project);
    if (folio === undefined) return;
    // Media page index (0-based) = folio - 1; it is a verso: visible once (folio - 1 + 1) / 2 leaves are turned.
    this.goImpl(this.single() ? folio - 1 : folio / 2);
  }

  protected faceVisible(k: number, side: 'front' | 'back'): boolean {
    const t = this.turned();
    if (this.single()) return side === 'front' && k === t;
    return side === 'front' ? k === t : k === t - 1;
  }

  protected onKey(event: KeyboardEvent): void {
    const keys: Record<string, number> = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 };
    if (event.key in keys) {
      this.step(keys[event.key] ?? 0);
    } else if (event.key === 'Home') {
      this.go(0);
    } else if (event.key === 'End') {
      this.go(this.maxTurn());
    } else return;
    event.preventDefault();
  }

  protected open(project: number): void {
    const root = this.root().nativeElement;
    const media = root.querySelector<HTMLElement>(`.mz-media[data-project="${project}"] app-project-media`);
    const box = media?.getBoundingClientRect();
    const visible = !!media && !!box && box.width > 0 && this.visiblePages().some((p) => p.kind === 'media' && p.project === project);
    this.openCase.emit({ index: project, media: visible ? media : null });
  }

  protected linksOf(p: SideProject): { label: string; href: string }[] {
    const links: { label: string; href: string }[] = [];
    if (p.liveUrl) links.push({ label: 'Live site', href: p.liveUrl });
    if (p.demoUrl) links.push({ label: 'Watch demo', href: p.demoUrl });
    if (p.repoUrl) links.push({ label: 'GitHub', href: p.repoUrl });
    return links;
  }

  protected kindsOf(p: SideProject): string {
    return p.kinds.map(kindLabel).join(' · ');
  }

  private pageLabel(kind: PageKind | undefined): string {
    switch (kind) {
      case 'cover':
        return 'Cover';
      case 'contents-left':
      case 'contents':
        return 'Contents';
      case 'index-left':
      case 'index':
        return 'Index';
      case 'back':
        return 'Back cover';
      default:
        return '';
    }
  }
}
