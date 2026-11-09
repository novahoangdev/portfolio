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
import { canHover, OpenCase, pad, prefersReducedMotion } from './shared';

/** Organic sheet-metal shapes in a 0..1 box (also used as objectBoundingBox clip paths). */
const SHAPES = [
  {
    id: 'disc',
    aspect: 1,
    d: 'M0.5,0.01 C0.8,0 1,0.22 0.99,0.52 C0.98,0.82 0.76,1 0.48,0.99 C0.2,0.98 0.01,0.78 0.02,0.48 C0.03,0.2 0.22,0.02 0.5,0.01 Z',
  },
  {
    id: 'leaf',
    aspect: 0.78,
    d: 'M0.5,0.01 C0.86,0.16 1.02,0.48 0.86,0.78 C0.76,0.94 0.62,1 0.5,0.99 C0.3,0.97 0.06,0.8 0.04,0.52 C0.03,0.28 0.22,0.1 0.5,0.01 Z',
  },
  {
    id: 'kidney',
    aspect: 1.28,
    d: 'M0.34,0.04 C0.62,-0.03 0.97,0.1 0.99,0.46 C1,0.82 0.72,0.99 0.44,0.97 C0.18,0.95 0.01,0.8 0.02,0.6 C0.03,0.44 0.22,0.46 0.28,0.34 C0.33,0.24 0.14,0.1 0.34,0.04 Z',
  },
  {
    id: 'petal',
    aspect: 0.86,
    d: 'M0.5,0.02 C0.72,0.24 0.98,0.48 0.97,0.72 C0.96,0.92 0.76,1 0.5,1 C0.24,1 0.04,0.92 0.03,0.72 C0.02,0.48 0.28,0.24 0.5,0.02 Z',
  },
  {
    id: 'pebble',
    aspect: 1.16,
    d: 'M0.46,0.02 C0.78,0 1,0.2 0.99,0.5 C0.98,0.8 0.72,0.99 0.42,0.97 C0.14,0.95 0,0.74 0.02,0.48 C0.04,0.2 0.2,0.04 0.46,0.02 Z',
  },
] as const;

type Shape = (typeof SHAPES)[number];

/** One node of the mobile: an arm with two children, or a shape (leaf). */
interface Node {
  readonly leaf: number;
  readonly kids: Node[];
  readonly depth: number;
  readonly leaves: Node[];
  mass: number;
  /** Rest x of the point this node hangs by (leaf top / arm pivot). */
  attachX: number;
  thread: number;
  a: number;
  b: number;
  bow: number;
  rest: number;
  inertia: number;
  swing: number;
  swingV: number;
  tilt: number;
  tiltV: number;
  yaw: number;
  yawV: number;
  // Kinematics (per frame).
  hx: number;
  hy: number;
  hvx: number;
  hax: number;
  px: number;
  py: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  z: number;
  worldYaw: number;
  // Leaves only.
  w: number;
  h: number;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  el: HTMLElement | null;
  shadow: HTMLElement | null;
  /** Per-frame targets: only these get written, and only when the value changes. */
  wrap: HTMLElement | null;
  shadowShape: HTMLElement | null;
  shade: HTMLElement | null;
  tag: HTMLElement | null;
  /** Smoothed counter-rotation of the tag, and the last strings written. */
  tagRot: number;
  tagUntil: number;
  last: { tf: string; stf: string; scale: string; shade: string; tag: string };
}

const hash = (i: number, salt = 0) => {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Experimental layout — a Calder-style hanging mobile. Wire arms balance in a
 * tree built from the project list; each arm is a rotational spring around its
 * pivot. The pointer makes wind, shapes can be pushed or dragged, and a hovered
 * shape slows, grows and plays its film with a hand-lettered tag.
 */
@Component({
  selector: 'app-projects-calder',
  imports: [ProjectMediaView],
  templateUrl: './calder.html',
  styleUrl: './calder.css',
})
export class ProjectsCalder {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly shapes = SHAPES;
  protected readonly inView = signal(false);
  protected readonly hovered = signal<number | null>(null);
  protected readonly focused = signal<number | null>(null);
  protected readonly selected = signal<number | null>(null);
  protected readonly captionTop = signal(false);
  protected readonly active = computed(() => this.hovered() ?? this.focused() ?? this.selected());

  private readonly document = inject(DOCUMENT);
  private readonly stageRef = viewChild.required<ElementRef<HTMLElement>>('stage');
  protected readonly reduced = prefersReducedMotion(this.document.defaultView);
  protected readonly hoverable = canHover(this.document.defaultView);
  private suppressClick = false;

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      const stage = this.stageRef().nativeElement;
      if (!view) return;
      const reduced = this.reduced;
      const projects = this.projects();
      const n = projects.length;
      const wires = stage.querySelector<SVGPathElement>('.wire')!;
      const wireShadow = stage.querySelector<SVGPathElement>('.wire-shadow')!;
      const svg = stage.querySelector<SVGSVGElement>('.wires')!;
      const leafEls = Array.from(stage.querySelectorAll<HTMLElement>('.leaf'));
      const shadowEls = Array.from(stage.querySelectorAll<HTMLElement>('.shadow'));

      const makeNode = (leaf: number, kids: Node[], depth: number): Node => ({
        leaf,
        kids,
        depth,
        leaves: leaf >= 0 ? [] : kids.flatMap((k) => (k.leaf >= 0 ? [k] : k.leaves)),
        mass: 0,
        attachX: 0,
        thread: 0,
        a: 0,
        b: 0,
        bow: 0,
        rest: 0,
        inertia: 1,
        swing: 0,
        swingV: 0,
        tilt: 0,
        tiltV: 0,
        yaw: 0,
        yawV: 0,
        hx: 0,
        hy: 0,
        hvx: 0,
        hax: 0,
        px: 0,
        py: 0,
        lx: 0,
        ly: 0,
        rx: 0,
        ry: 0,
        z: 0,
        worldYaw: 0,
        w: 0,
        h: 0,
        cx: 0,
        cy: 0,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
        el: leaf >= 0 ? (leafEls[leaf] ?? null) : null,
        shadow: leaf >= 0 ? (shadowEls[leaf] ?? null) : null,
        wrap: leaf >= 0 ? (leafEls[leaf]?.querySelector<HTMLElement>('.shape-wrap') ?? null) : null,
        shadowShape: leaf >= 0 ? (shadowEls[leaf]?.querySelector<HTMLElement>('.shadow-shape') ?? null) : null,
        shade: leaf >= 0 ? (leafEls[leaf]?.querySelector<HTMLElement>('.shape-shade') ?? null) : null,
        tag: leaf >= 0 ? (leafEls[leaf]?.querySelector<HTMLElement>('.tag') ?? null) : null,
        tagRot: 0,
        tagUntil: 0,
        last: { tf: '', stf: '', scale: '', shade: '', tag: '' },
      });

      /**
       * Two Calder cascades from a root arm: each arm carries one shape on one end
       * and the rest of its cascade on the other, so shapes step down level by level.
       */
      const cascade = (items: number[], depth: number): Node => {
        if (items.length === 1) return makeNode(items[0]!, [], depth);
        return makeNode(-1, [makeNode(items[0]!, [], depth + 1), cascade(items.slice(1), depth + 1)], depth);
      };
      const order = projects.map((_, i) => i);
      const half = Math.ceil(order.length / 2);
      const root =
        order.length < 3
          ? cascade(order, 0)
          : makeNode(-1, [cascade(order.slice(0, half), 1), cascade(order.slice(half), 1)], 0);
      const all: Node[] = [];
      const walk = (node: Node) => {
        all.push(node);
        node.kids.forEach(walk);
      };
      walk(root);
      const leaves = all.filter((node) => node.leaf >= 0);
      const arms = all.filter((node) => node.leaf < 0);

      let width = 0;
      let height = 0;
      let ceilingX = 0;
      let mobile = false;

      // ---------- geometry: sizes, slots, balance ----------
      const layout = () => {
        width = stage.clientWidth;
        height = stage.clientHeight;
        mobile = width < 700;
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        const maxDepth = Math.max(...leaves.map((l) => l.depth));
        let base = Math.min(clamp(width * 0.118, 60, 190), ((width * 0.94) / n) * (mobile ? 2 : 1.45));
        const top = mobile ? 54 : 70;
        const bottom = mobile ? 150 : 96;
        const sized = () => {
          for (const l of leaves) {
            const p = projects[l.leaf]!;
            const shape = SHAPES[l.leaf % SHAPES.length]!;
            const s = base * (p.featured ? 1.16 : 1) * (0.82 + 0.34 * hash(l.leaf, 1));
            l.w = Math.round(s * Math.sqrt(shape.aspect));
            l.h = Math.round(s / Math.sqrt(shape.aspect));
            l.mass = (l.w * l.h) / 10000;
            l.thread = Math.round((mobile ? 8 : 12) + hash(l.leaf, 2) * (mobile ? 30 : 58));
          }
        };
        sized();
        // Shrink until the slots and the cascade fit the wall.
        const maxH = () => Math.max(...leaves.map((l) => l.h + l.thread));
        for (let tries = 0; tries < 12; tries++) {
          const slots = leaves.reduce((sum, l) => sum + Math.max(l.w, l.h * 0.7) * (mobile ? 0.66 : 0.94), 0);
          const levelH = (height - top - bottom - maxH()) / Math.max(1, maxDepth - 1);
          if (slots <= width * (mobile ? 0.86 : 0.94) && levelH >= maxH() * (mobile ? 0.36 : 0.5)) break;
          base *= 0.93;
          sized();
        }
        const levelH = Math.max(40, (height - top - bottom - maxH()) / Math.max(1, maxDepth - 1));
        const slotW = (l: Node) => Math.max(l.w, l.h * 0.7) * (mobile ? 0.66 : 0.94);
        const total = leaves.reduce((sum, l) => sum + slotW(l), 0);
        let x = (width - total) / 2;
        for (const l of leaves) {
          l.attachX = x + slotW(l) / 2;
          x += slotW(l);
        }
        // Bottom-up: masses and balance points (Σ m·d equal on both sides of every pivot).
        const balance = (node: Node) => {
          if (node.leaf >= 0) return;
          const [L, R] = node.kids as [Node, Node];
          balance(L);
          balance(R);
          node.mass = L.mass + R.mass + 0.02;
          node.attachX = (L.mass * L.attachX + R.mass * R.attachX) / (L.mass + R.mass);
          node.a = node.attachX - L.attachX;
          node.b = R.attachX - node.attachX;
          node.rest = (hash(node.depth * 7 + node.leaves.length + node.attachX * 0.01, 3) - 0.5) * 0.24;
        };
        balance(root);
        // Threads: the root hangs from the ceiling; arms hang one level below their parent.
        root.thread = top;
        ceilingX = root.attachX;
        stage.style.setProperty('--ceil', `${ceilingX.toFixed(1)}px`);
        for (const arm of arms) {
          for (const kid of arm.kids) if (kid.leaf < 0) kid.thread = levelH * (0.78 + 0.34 * hash(kid.leaves.length * 5 + kid.depth, 6));
        }
        for (const arm of arms) arm.bow = Math.min(mobile ? 12 : 22, Math.max(arm.a, arm.b) * 0.1);
        for (const node of all) {
          node.swing = node.swingV = node.tiltV = node.yaw = node.yawV = 0;
          node.tilt = node.rest;
          node.inertia = 1;
        }
        for (const l of leaves) {
          l.el?.style.setProperty('--thread', `${l.thread}px`);
          l.el?.style.setProperty('--w', `${l.w}px`);
          l.el?.style.setProperty('--h', `${l.h}px`);
          l.shadow?.style.setProperty('--thread', `${l.thread}px`);
          l.shadow?.style.setProperty('--w', `${l.w}px`);
          l.shadow?.style.setProperty('--h', `${l.h}px`);
          l.el?.classList.toggle('tag-left', l.attachX > width * 0.68);
          l.el?.classList.toggle('tag-right', l.attachX < width * 0.32);
        }
        kinematics(1 / 60, true);
        // Varied link lengths can push the lowest shape past the floor: shorten the links to fit.
        for (let tries = 0; tries < 8; tries++) {
          const lowest = Math.max(...leaves.map((l) => l.cy + l.h / 2));
          if (lowest <= height - bottom + 4) break;
          const k = Math.max(0.6, (height - bottom - top) / (lowest - top));
          for (const arm of arms) if (arm !== root) arm.thread *= k;
          kinematics(1 / 60, true);
        }
        for (const arm of arms) {
          arm.inertia = Math.max(
            0.2,
            arm.leaves.reduce((sum, l) => sum + l.mass * ((l.cx - arm.px) ** 2 + (l.cy - arm.py) ** 2), 0) / 10000,
          );
        }
        render();
      };

      // ---------- forward kinematics ----------
      const place = (node: Node, hx: number, hy: number, parentYaw: number, z: number, dt: number, reset: boolean) => {
        const vx = reset ? 0 : (hx - node.hx) / dt;
        node.hax = reset ? 0 : node.hax * 0.6 + ((vx - node.hvx) / dt) * 0.4;
        node.hvx = vx;
        node.hx = hx;
        node.hy = hy;
        const s = Math.sin(node.swing);
        const c = Math.cos(node.swing);
        node.px = hx + s * node.thread;
        node.py = hy + c * node.thread;
        node.worldYaw = parentYaw + node.yaw;
        node.z = z;
        if (node.leaf >= 0) {
          const half = node.thread + node.h / 2;
          const cx = hx + s * half;
          const cy = hy + c * half;
          node.vx = reset ? 0 : (cx - node.cx) / dt;
          node.vy = reset ? 0 : (cy - node.cy) / dt;
          node.cx = cx;
          node.cy = cy;
          return;
        }
        const ct = Math.cos(node.tilt);
        const st = Math.sin(node.tilt);
        const cyaw = Math.cos(node.worldYaw);
        const syaw = Math.sin(node.worldYaw);
        // The wire arches: its ends sit `bow` below the pivot (in the arm's frame).
        node.lx = node.px - node.a * cyaw * ct - node.bow * st;
        node.ly = node.py - node.a * cyaw * st + node.bow * ct;
        node.rx = node.px + node.b * cyaw * ct - node.bow * st;
        node.ry = node.py + node.b * cyaw * st + node.bow * ct;
        place(node.kids[0]!, node.lx, node.ly, node.worldYaw, z - node.a * syaw, dt, reset);
        place(node.kids[1]!, node.rx, node.ry, node.worldYaw, z + node.b * syaw, dt, reset);
      };
      const kinematics = (dt: number, reset = false) => place(root, ceilingX, 0, 0, 0, dt, reset);

      // ---------- dynamics ----------
      const pointer = { x: -9999, y: -9999, vx: 0, vy: 0, t: 0, inside: false };
      let drag: { leaf: Node; x: number; y: number } | null = null;
      const activeLeaf = () => {
        const i = this.active();
        return i === null ? null : (leaves.find((l) => l.leaf === i) ?? null);
      };

      const simulate = (dt: number, t: number) => {
        const slow = activeLeaf();
        // Forces on shapes: idle breeze, pointer wind, a held shape.
        for (const l of leaves) {
          const i = l.leaf;
          l.fx = l.mass * 22 * (Math.sin(t * 0.33 + i * 1.7) + 0.6 * Math.sin(t * 0.57 + i * 0.9));
          l.fy = l.mass * 6 * Math.sin(t * 0.45 + i * 2.3);
          if (pointer.inside) {
            const d = Math.hypot(l.cx - pointer.x, l.cy - pointer.y);
            const reach = mobile ? 160 : 240;
            if (d < reach) {
              const f = (1 - d / reach) ** 2 * l.mass * 0.9;
              l.fx += clamp(pointer.vx, -2400, 2400) * f;
              l.fy += clamp(pointer.vy, -2400, 2400) * f * 0.5;
            }
          }
          if (drag && drag.leaf === l) {
            l.fx += ((drag.x - l.cx) * 46 - l.vx * 5) * l.mass;
            l.fy += ((drag.y - l.cy) * 46 - l.vy * 5) * l.mass;
          }
        }
        for (const node of all) {
          const set = node.leaf >= 0 ? [node] : node.leaves;
          let fx = 0;
          let torque = 0;
          let spin = 0;
          for (const l of set) {
            fx += l.fx;
            if (node.leaf < 0) {
              const rx = l.cx - node.px;
              const ry = l.cy - node.py;
              torque += rx * l.fy - ry * l.fx;
              spin += -l.fx * Math.sign(rx) * Math.min(Math.abs(rx), 260);
            } else {
              spin += l.fx * 18;
            }
          }
          const calm = slow && (node === slow || node.leaves.includes(slow)) ? (node === slow ? 7 : 2.4) : 1;
          const len = node.leaf >= 0 ? node.thread + node.h / 2 : node.thread;
          const mass = Math.max(0.05, node.leaf >= 0 ? node.mass : node.mass);
          const swingA =
            (-620 / len) * Math.sin(node.swing) -
            (node.hax / len) * Math.cos(node.swing) * 0.85 -
            0.55 * calm * node.swingV +
            (fx / (mass * len)) * 0.9;
          node.swingV += swingA * dt;
          node.swing = clamp(node.swing + node.swingV * dt, -0.7, 0.7);
          if (node.leaf < 0) {
            const tiltA = -2.6 * (node.tilt - node.rest) - 0.7 * calm * node.tiltV + (torque / node.inertia) * 0.00009;
            node.tiltV += tiltA * dt;
            node.tilt = clamp(node.tilt + node.tiltV * dt, node.rest - 0.75, node.rest + 0.75);
          }
          const yawA =
            -1.9 * node.yaw -
            0.5 * calm * node.yawV +
            (spin / Math.max(0.3, node.leaf >= 0 ? node.mass * 400 : node.inertia * 9000)) * 0.08 +
            Math.sin(t * 0.21 + node.depth * 1.3 + node.leaves.length) * 0.05;
          node.yawV += yawA * dt;
          node.yaw = clamp(node.yaw + node.yawV * dt, -0.62, 0.62);
        }
        kinematics(dt);
      };

      // ---------- rendering ----------
      const lightX = () => width * 0.5;
      const shadowOffset = (x: number, y: number, z: number) => {
        const depth = Math.max(8, 34 + z * 0.35);
        return { x: ((x - lightX()) / (y + height * 0.9)) * depth * 1.6, y: depth * 0.72 };
      };
      const f = (v: number) => v.toFixed(1);
      const render = () => {
        let d = '';
        let ds = '';
        const line = (x1: number, y1: number, x2: number, y2: number, z: number) => {
          d += `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
          const o1 = shadowOffset(x1, y1, z);
          const o2 = shadowOffset(x2, y2, z);
          ds += `M${f(x1 + o1.x)} ${f(y1 + o1.y)}L${f(x2 + o2.x)} ${f(y2 + o2.y)}`;
        };
        const curve = (x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, z1: number, z2: number) => {
          d += `M${f(x1)} ${f(y1)}Q${f(cx)} ${f(cy)} ${f(x2)} ${f(y2)}`;
          const o1 = shadowOffset(x1, y1, z1);
          const oc = shadowOffset(cx, cy, (z1 + z2) / 2);
          const o2 = shadowOffset(x2, y2, z2);
          ds += `M${f(x1 + o1.x)} ${f(y1 + o1.y)}Q${f(cx + oc.x)} ${f(cy + oc.y)} ${f(x2 + o2.x)} ${f(y2 + o2.y)}`;
        };
        for (const arm of arms) {
          // Hanging thread from the parent's end (or the ceiling) to the pivot.
          line(arm.hx, arm.hy, arm.px, arm.py, arm.z);
          // A wire bowed upward on each side of the pivot, curled at the ends.
          // Arched wire, tangent level at the pivot.
          const dx = Math.cos(arm.tilt) * Math.cos(arm.worldYaw);
          const dy = Math.sin(arm.tilt) * Math.cos(arm.worldYaw);
          const zl = arm.kids[0]!.z;
          const zr = arm.kids[1]!.z;
          curve(arm.lx, arm.ly, arm.px - dx * arm.a * 0.55, arm.py - dy * arm.a * 0.55, arm.px, arm.py, zl, arm.z);
          curve(arm.px, arm.py, arm.px + dx * arm.b * 0.55, arm.py + dy * arm.b * 0.55, arm.rx, arm.ry, arm.z, zr);
          for (const [ex, ey, z] of [
            [arm.lx, arm.ly, zl],
            [arm.rx, arm.ry, zr],
            [arm.px, arm.py, arm.z],
          ] as const) {
            d += `M${f(ex + 2.6)} ${f(ey)}a2.6 2.6 0 1 0 -5.2 0a2.6 2.6 0 1 0 5.2 0`;
            const o = shadowOffset(ex, ey, z);
            ds += `M${f(ex + o.x + 2.6)} ${f(ey + o.y)}a2.6 2.6 0 1 0 -5.2 0a2.6 2.6 0 1 0 5.2 0`;
          }
        }
        wires.setAttribute('d', d);
        wireShadow.setAttribute('d', ds);
        // Only transforms (and one opacity var on a leaf-less span) change per frame, each written
        // straight to the element it moves and only when its string changes: no inherited custom
        // properties, so a frame restyles a handful of elements instead of every leaf subtree.
        const active = this.active();
        const now = view.performance.now();
        for (const l of leaves) {
          if (!l.el || !l.shadow) continue;
          const sx = Math.max(0.3, Math.cos(l.worldYaw));
          const persp = 1 + clamp(l.z, -300, 300) / 2400;
          const rot = l.swing + (hash(l.leaf, 4) - 0.5) * 0.12;
          const r = `rotate(${rot.toFixed(4)}rad)`;
          const last = l.last;
          const tf = `translate3d(${f(l.hx - l.w / 2)}px, ${f(l.hy)}px, 0) ${r}`;
          if (tf !== last.tf) l.el.style.transform = last.tf = tf;
          const o = shadowOffset(l.cx, l.cy, l.z);
          const stf = `translate3d(${f(l.hx - l.w / 2 + o.x)}px, ${f(l.hy + o.y)}px, 0) ${r}`;
          if (stf !== last.stf) l.shadow.style.transform = last.stf = stf;
          const scale = `scale(${(sx * persp).toFixed(3)}, ${persp.toFixed(3)})`;
          if (scale !== last.scale) {
            last.scale = scale;
            if (l.wrap) l.wrap.style.transform = scale;
            if (l.shadowShape) l.shadowShape.style.transform = scale;
          }
          // The side shade is a faint gradient: 0.02 steps are invisible and spare most repaints.
          const shade = (Math.round(Math.sin(l.worldYaw) * 50) / 50).toFixed(2);
          if (shade !== last.shade && l.shade) l.shade.style.setProperty('--shade', (last.shade = shade));
          // The tag hangs plumb under its shape, lagging a little behind the swing.
          // Hidden tags are left alone until they show (and while they fade out).
          if (l.leaf === active) l.tagUntil = now + 400;
          if (l.tag && this.hoverable && (now < l.tagUntil || !last.tag)) {
            l.tagRot = last.tag ? l.tagRot + (-rot - l.tagRot) * 0.12 : -rot;
            const tag = `${l.tagRot.toFixed(4)}rad`;
            if (tag !== last.tag) l.tag.style.rotate = last.tag = tag;
          }
        }
      };

      // ---------- loop ----------
      let frame = 0;
      let last = 0;
      let acc = 0;
      const STEP = 1 / 120;
      const loop = (now: number) => {
        frame = 0;
        const dt = Math.min(0.05, (now - last) / 1000 || STEP);
        last = now;
        acc += dt;
        while (acc >= STEP) {
          simulate(STEP, now / 1000);
          acc -= STEP;
        }
        pointer.vx *= 0.86;
        pointer.vy *= 0.86;
        render();
        frame = view.requestAnimationFrame(loop);
      };
      const wake = () => {
        if (reduced || frame || !this.inView()) return;
        last = view.performance.now();
        frame = view.requestAnimationFrame(loop);
      };
      const sleep = () => {
        view.cancelAnimationFrame(frame);
        frame = 0;
      };

      // ---------- pointer: wind, push and drag ----------
      const local = (e: PointerEvent) => {
        const r = stage.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      let press: { id: number; x: number; y: number; leaf: Node | null } | null = null;
      const onMove = (e: PointerEvent) => {
        const p = local(e);
        const now = e.timeStamp;
        if (pointer.inside && pointer.t) {
          const dt = Math.max(8, now - pointer.t) / 1000;
          pointer.vx = pointer.vx * 0.5 + ((p.x - pointer.x) / dt) * 0.5;
          pointer.vy = pointer.vy * 0.5 + ((p.y - pointer.y) / dt) * 0.5;
        }
        pointer.x = p.x;
        pointer.y = p.y;
        pointer.t = now;
        pointer.inside = true;
        if (press && e.pointerId === press.id) {
          if (!drag && press.leaf && Math.hypot(p.x - press.x, p.y - press.y) > 6) {
            drag = { leaf: press.leaf, x: p.x, y: p.y };
            this.suppressClick = true;
            stage.classList.add('is-dragging');
          }
          if (drag) {
            drag.x = p.x;
            drag.y = p.y;
          }
        }
      };
      const onLeave = () => {
        pointer.inside = false;
        pointer.t = 0;
      };
      const onDown = (e: PointerEvent) => {
        if (reduced || e.button > 0) return;
        const shape = (e.target as Element).closest('.shape');
        const index = shape ? leafEls.indexOf(shape.closest('.leaf') as HTMLElement) : -1;
        const p = local(e);
        press = { id: e.pointerId, x: p.x, y: p.y, leaf: leaves.find((l) => l.leaf === index) ?? null };
      };
      const onUp = (e: PointerEvent) => {
        if (!press || e.pointerId !== press.id) return;
        if (drag) view.setTimeout(() => (this.suppressClick = false), 0);
        press = null;
        drag = null;
        stage.classList.remove('is-dragging');
        if (e.pointerType !== 'mouse') onLeave();
      };
      stage.addEventListener('pointermove', onMove, { passive: true });
      stage.addEventListener('pointerleave', onLeave);
      stage.addEventListener('pointerdown', onDown);
      view.addEventListener('pointermove', onMove, { passive: true });
      view.addEventListener('pointerup', onUp);
      view.addEventListener('pointercancel', onUp);

      const io = new IntersectionObserver(
        ([entry]) => {
          const visible = !!entry?.isIntersecting;
          this.inView.set(visible);
          if (visible) wake();
          else sleep();
        },
        { threshold: 0.05 },
      );
      io.observe(stage);
      let size = '';
      const ro = new ResizeObserver(() => {
        const next = `${stage.clientWidth}x${stage.clientHeight}`;
        if (next === size) return;
        size = next;
        layout();
      });
      ro.observe(stage);
      layout();

      cleanup = () => {
        sleep();
        io.disconnect();
        ro.disconnect();
        stage.removeEventListener('pointermove', onMove);
        stage.removeEventListener('pointerleave', onLeave);
        stage.removeEventListener('pointerdown', onDown);
        view.removeEventListener('pointermove', onMove);
        view.removeEventListener('pointerup', onUp);
        view.removeEventListener('pointercancel', onUp);
      };
    });
    inject(DestroyRef).onDestroy(() => cleanup());
  }

  protected shapeOf(index: number): Shape {
    return SHAPES[index % SHAPES.length]!;
  }

  protected clipOf(index: number): string {
    return `url(#calder-${this.shapeOf(index).id})`;
  }

  protected activate(index: number, leaf: HTMLElement): void {
    if (this.suppressClick) return;
    if (!this.hoverable && this.selected() !== index) {
      // Pin the caption at whichever end of the wall is away from the chosen shape.
      const stage = this.stageRef().nativeElement.getBoundingClientRect();
      const box = leaf.getBoundingClientRect();
      this.captionTop.set(box.top + box.height / 2 - stage.top > stage.height * 0.5);
      this.selected.set(index);
      return;
    }
    this.open(index, leaf);
  }

  protected open(index: number, leaf: HTMLElement): void {
    this.openCase.emit({ index, media: leaf.querySelector<HTMLElement>('app-project-media') });
  }

  protected openSelected(): void {
    const index = this.selected();
    const leaf = this.stageRef().nativeElement.querySelector<HTMLElement>(`.leaf[data-project="${index}"]`);
    if (index !== null && leaf) this.open(index, leaf);
  }

  protected onStageClick(event: MouseEvent): void {
    if (!(event.target as Element).closest('.leaf, .caption')) this.selected.set(null);
  }

  protected onBlur(index: number): void {
    if (this.focused() === index) this.focused.set(null);
  }

  protected onLeave(index: number): void {
    if (this.hovered() === index) this.hovered.set(null);
  }
}
