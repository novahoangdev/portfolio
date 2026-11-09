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
import { ProjectKind, projectKinds, SideProject } from '../../../data/projects';
import { ProjectMediaView } from '../project-media';
import { kindLabel, OpenCase, pad, prefersReducedMotion } from './shared';

interface Pt {
  readonly x: number;
  readonly y: number;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface MetroLine {
  readonly kind: ProjectKind;
  readonly label: string;
  readonly code: string;
  readonly color: string;
  /** Home row y. */
  readonly y: number;
  /** Row order (top to bottom). */
  readonly row: number;
  readonly d: string;
  readonly badge: Pt;
  readonly stops: number;
}

interface StationLabel {
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly lines: readonly string[];
  readonly box: Rect;
}

interface Station {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly lines: readonly number[];
  readonly interchange: boolean;
  readonly color: string;
  readonly label: StationLabel;
  /** Button hit area (station + label). */
  readonly hit: Rect;
}

interface Edge {
  readonly a: number;
  readonly b: number;
  /** -1: a walking transfer inside the hub. */
  readonly line: number;
  readonly pts: readonly Pt[];
  readonly len: number;
}

interface Network {
  readonly w: number;
  readonly h: number;
  readonly lines: readonly MetroLine[];
  readonly stations: readonly Station[];
  readonly hub: Rect;
  readonly hubLabel: Pt;
  readonly edges: readonly Edge[];
  readonly river: string;
  /** Node count: stations, then one hub port per line. */
  readonly nodes: number;
  readonly nodePos: readonly Pt[];
}

/** One sample of a train journey. */
interface Track {
  readonly pts: readonly Pt[];
  readonly cum: readonly number[];
  readonly line: readonly number[];
  readonly len: number;
}

const LINE_COLORS: Record<ProjectKind, string> = {
  web: '#e4483a',
  ios: '#2f74e0',
  '3d': '#9a5ae0',
  tools: '#1d9f70',
};
const FALLBACK_COLORS = ['#e0a020', '#d6457f', '#2aa6c9', '#7a8a2e'];
const LINE_CODES: Record<ProjectKind, string> = { web: 'W', ios: 'i', '3d': '3D', tools: 'T' };

const U = 46; // row unit (rows sit 2U apart; interchanges between them)
const COL = 150; // column spacing
const FONT = 14;
const LINE_H = 16.5;
const CHAR_W = 0.6 * FONT;

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/** Remove consecutive duplicate vertices. */
function dedupe(pts: Pt[]): Pt[] {
  return pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]!) > 0.5);
}

/** Octilinear route between two stops of a line whose home row is `home`. */
function route(a: Pt, b: Pt, home: number): Pt[] {
  const da = Math.abs(a.y - home);
  const db = Math.abs(b.y - home);
  if (b.x - a.x >= da + db + 10) {
    return dedupe([a, { x: a.x + da, y: home }, { x: b.x - db, y: home }, b]);
  }
  const dy = Math.abs(b.y - a.y);
  const dx = b.x - a.x;
  if (dy >= dx) return [a, b];
  const run = (dx - dy) / 2;
  return dedupe([a, { x: a.x + run, y: a.y }, { x: b.x - run, y: b.y }, b]);
}

/** Rounded-corner path through `pts` (SVG `d`) plus a dense sampling of it. */
function smooth(pts: readonly Pt[], radius: (i: number) => number): { d: string; samples: Pt[] } {
  if (pts.length < 2) return { d: '', samples: [...pts] };
  const first = pts[0]!;
  let d = `M${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  const samples: Pt[] = [first];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1]!;
    const v = pts[i]!;
    const n = pts[i + 1]!;
    const lp = dist(p, v);
    const ln = dist(v, n);
    const r = Math.min(radius(i), lp / 2, ln / 2);
    const v1 = { x: v.x + ((p.x - v.x) / lp) * r, y: v.y + ((p.y - v.y) / lp) * r };
    const v2 = { x: v.x + ((n.x - v.x) / ln) * r, y: v.y + ((n.y - v.y) / ln) * r };
    d += ` L${v1.x.toFixed(1)} ${v1.y.toFixed(1)} Q${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v2.x.toFixed(1)} ${v2.y.toFixed(1)}`;
    samples.push(v1);
    for (let k = 1; k <= 6; k++) {
      const t = k / 6;
      const u = 1 - t;
      samples.push({
        x: u * u * v1.x + 2 * u * t * v.x + t * t * v2.x,
        y: u * u * v1.y + 2 * u * t * v.y + t * t * v2.y,
      });
    }
  }
  const last = pts[pts.length - 1]!;
  d += ` L${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  samples.push(last);
  return { d, samples };
}

function lengthOf(pts: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1]!, pts[i]!);
  return len;
}

/** Liang–Barsky: does segment a→b touch rect r? */
function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });

function wrapName(name: string): string[] {
  const words = name.split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + ' ' + word).length <= 12) lines[lines.length - 1] = last + ' ' + word;
    else lines.push(word);
  }
  // Keep at most two lines.
  return lines.length > 2 ? [lines[0]!, lines.slice(1).join(' ')] : lines;
}

function permutations(n: number): number[][] {
  if (n > 6) return [Array.from({ length: n }, (_, i) => i)];
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (!rest.length) out.push(prefix);
    rest.forEach((r, i) => walk([...prefix, r], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  walk([], Array.from({ length: n }, (_, i) => i));
  return out;
}

/** Lay the projects out as an octilinear network: one line per kind, a hub where all lines start. */
function buildNetwork(projects: readonly SideProject[]): Network {
  const kinds = projectKinds.filter((k) => projects.some((p) => p.kinds.includes(k.id)));
  const K = kinds.length;
  const lineOf = (kind: ProjectKind) => kinds.findIndex((k) => k.id === kind);
  const projectLines = projects.map((p) => p.kinds.map(lineOf).filter((l) => l >= 0));

  // Order the rows so lines that share stations sit next to each other.
  let best: number[] = [];
  let bestCost = Infinity;
  for (const perm of permutations(K)) {
    let cost = perm.reduce((sum, row, line) => sum + Math.abs(row - line) * 0.01, 0);
    for (const lines of projectLines) {
      if (lines.length < 2) continue;
      const rows = lines.map((l) => perm[l]!);
      const span = Math.max(...rows) - Math.min(...rows);
      cost += (span - (lines.length - 1)) * 10;
      const mean = rows.reduce((a, b) => a + b, 0) / rows.length;
      if (Number.isInteger(mean) && !rows.includes(mean)) cost += 100;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = perm;
    }
  }
  const rowY = (line: number) => best[line]! * 2 * U;

  // Columns: each station sits one column after the previous stop on each of its lines.
  const lastCol = new Array<number>(K).fill(-1);
  const cols = projectLines.map((lines) => {
    const col = Math.max(0, ...lines.map((l) => lastCol[l]! + 1));
    lines.forEach((l) => (lastCol[l] = col));
    return col;
  });

  const hubX = 0;
  const firstX = 150;
  const pos: Pt[] = projectLines.map((lines, i) => ({
    x: firstX + cols[i]! * COL,
    y: lines.length ? lines.map(rowY).reduce((a, b) => a + b, 0) / lines.length : 0,
  }));

  const colorOf = (line: number) => LINE_COLORS[kinds[line]!.id] ?? FALLBACK_COLORS[line % FALLBACK_COLORS.length]!;
  const nodes = projects.length + K;
  const nodePos: Pt[] = [...pos, ...kinds.map((_, l) => ({ x: hubX, y: rowY(l) }))];

  // Edges + line paths.
  const edges: Edge[] = [];
  const segments: [Pt, Pt][] = [];
  const lineDrafts = kinds.map((kind, l) => {
    const home = rowY(l);
    const stops = projects.map((_, i) => i).filter((i) => projectLines[i]!.includes(l));
    const nodesOnLine = [projects.length + l, ...stops];
    const vertices: Pt[] = [];
    const stationVertex = new Set<number>();
    for (let s = 1; s < nodesOnLine.length; s++) {
      const a = nodesOnLine[s - 1]!;
      const b = nodesOnLine[s]!;
      const pts = route(nodePos[a]!, nodePos[b]!, home);
      const sampled = smooth(pts, () => 22).samples;
      edges.push({ a, b, line: l, pts: sampled, len: lengthOf(sampled) });
      if (vertices.length) vertices.pop();
      stationVertex.add(vertices.length);
      vertices.push(...pts);
      stationVertex.add(vertices.length - 1);
    }
    // Tail to the terminus badge.
    const end = vertices[vertices.length - 1] ?? nodePos[projects.length + l]!;
    const dEnd = Math.abs(end.y - home);
    const badge = { x: end.x + dEnd + 70, y: home };
    vertices.push(...dedupe([end, { x: end.x + dEnd, y: home }, { x: badge.x - 16, y: home }]).slice(1));
    for (let i = 1; i < vertices.length; i++) segments.push([vertices[i - 1]!, vertices[i]!]);
    const { d } = smooth(vertices, (i) => (stationVertex.has(i) ? 8 : 22));
    return {
      kind: kind.id,
      label: kind.label,
      code: LINE_CODES[kind.id] ?? kind.label.charAt(0).toUpperCase(),
      color: colorOf(l),
      y: home,
      row: best[l]!,
      d,
      badge,
      stops: stops.length,
    } satisfies MetroLine;
  });

  // Hub transfers between neighbouring rows.
  const byRow = kinds.map((_, l) => l).sort((a, b) => rowY(a) - rowY(b));
  for (let r = 1; r < byRow.length; r++) {
    const a = projects.length + byRow[r - 1]!;
    const b = projects.length + byRow[r]!;
    const pts = [nodePos[a]!, nodePos[b]!];
    edges.push({ a, b, line: -1, pts, len: lengthOf(pts) });
  }

  const rows = kinds.map((_, l) => rowY(l));
  const hub: Rect = { x: hubX - 12, y: Math.min(...rows) - 12, w: 24, h: Math.max(...rows) - Math.min(...rows) + 24 };

  // Labels: try a few spots around each station, keep the one that collides least.
  const placed: Rect[] = [grow(hub, 4)];
  const marks: Rect[] = pos.map((p, i) => {
    const r = projectLines[i]!.length > 1 ? 11 : 8;
    return { x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r };
  });
  const stations: Station[] = projects.map((project, i) => {
    const p = pos[i]!;
    const interchange = projectLines[i]!.length > 1;
    const sr = interchange ? 11 : 9;
    const lines = wrapName(project.name);
    const w = Math.max(...lines.map((l) => l.length)) * CHAR_W;
    const h = lines.length * LINE_H;
    const candidates: { box: Rect; anchor: StationLabel['anchor']; cost: number }[] = [
      { box: { x: p.x - w / 2, y: p.y + sr + 8, w, h }, anchor: 'middle', cost: 0 },
      { box: { x: p.x - w / 2, y: p.y - sr - 8 - h, w, h }, anchor: 'middle', cost: 0.5 },
      { box: { x: p.x + sr + 16, y: p.y - h / 2, w, h }, anchor: 'start', cost: 1 },
      { box: { x: p.x - sr - 16 - w, y: p.y - h / 2, w, h }, anchor: 'end', cost: 1.5 },
      { box: { x: p.x + 10, y: p.y + sr + 6, w, h }, anchor: 'start', cost: 2 },
      { box: { x: p.x + 10, y: p.y - sr - 6 - h, w, h }, anchor: 'start', cost: 2.2 },
      { box: { x: p.x - 10 - w, y: p.y + sr + 6, w, h }, anchor: 'end', cost: 2.4 },
    ];
    let chosen = candidates[0]!;
    let chosenCost = Infinity;
    for (const c of candidates) {
      const hitBox = grow(c.box, 3);
      let cost = c.cost;
      for (const [a, b] of segments) if (segmentHitsRect(a, b, hitBox)) cost += 12;
      marks.forEach((m, j) => j !== i && overlap(m, hitBox) > 0 && (cost += 12));
      for (const other of placed) cost += overlap(other, c.box) / 40;
      if (cost < chosenCost) {
        chosenCost = cost;
        chosen = c;
      }
    }
    placed.push(chosen.box);
    const box = chosen.box;
    const x = chosen.anchor === 'middle' ? box.x + w / 2 : chosen.anchor === 'start' ? box.x : box.x + w;
    const label: StationLabel = { x, y: box.y + FONT * 0.82, anchor: chosen.anchor, lines, box };
    const minX = Math.min(p.x - sr - 4, box.x - 4);
    const minY = Math.min(p.y - sr - 4, box.y - 4);
    const hit: Rect = {
      x: minX,
      y: minY,
      w: Math.max(p.x + sr + 4, box.x + box.w + 4) - minX,
      h: Math.max(p.y + sr + 4, box.y + box.h + 4) - minY,
    };
    return {
      index: i,
      x: p.x,
      y: p.y,
      lines: projectLines[i]!,
      interchange,
      color: colorOf(projectLines[i]![0] ?? 0),
      label,
      hit,
    };
  });

  // Bounds of everything, plus room for the cartouche and legend overlays.
  const xs = [hub.x, ...lineDrafts.map((l) => l.badge.x + 18), ...stations.flatMap((s) => [s.hit.x, s.hit.x + s.hit.w])];
  const ys = [hub.y - 28, hub.y + hub.h, ...stations.flatMap((s) => [s.hit.y, s.hit.y + s.hit.h])];
  const pad = { l: 70, r: 60, t: 120, b: 92 };
  const ox = Math.min(...xs) - pad.l;
  const oy = Math.min(...ys) - pad.t;
  const w = Math.max(...xs) - ox + pad.r;
  const h = Math.max(...ys) - oy + pad.b;
  const sx = (p: Pt): Pt => ({ x: p.x - ox, y: p.y - oy });
  const shiftRect = (r: Rect): Rect => ({ ...r, x: r.x - ox, y: r.y - oy });
  const shiftD = (d: string) =>
    d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) =>
      `${(+x - ox).toFixed(1)} ${(+y - oy).toFixed(1)}`,
    );

  // A decorative river crossing the sheet behind the lines.
  const rx = w * 0.46;
  const ry = h * 0.2;
  const drop = h * 0.36;
  const river = smooth(
    [
      { x: rx - 30, y: -40 },
      { x: rx - 30, y: ry - 30 },
      { x: rx - 30 + drop, y: ry - 30 + drop },
      { x: w * 0.78, y: ry - 30 + drop },
      { x: w * 0.78 + h, y: ry - 30 + drop + h },
    ],
    () => 70,
  ).d;

  return {
    w,
    h,
    lines: lineDrafts.map((l) => ({ ...l, d: shiftD(l.d), y: l.y - oy, badge: sx(l.badge) })),
    stations: stations.map((s) => ({
      ...s,
      x: s.x - ox,
      y: s.y - oy,
      hit: shiftRect(s.hit),
      label: { ...s.label, x: s.label.x - ox, y: s.label.y - oy, box: shiftRect(s.label.box) },
    })),
    hub: shiftRect(hub),
    hubLabel: { x: hub.x - ox + hub.w / 2, y: hub.y - oy - 14 },
    edges: edges.map((e) => ({ ...e, pts: e.pts.map(sx) })),
    river,
    nodes,
    nodePos: nodePos.map(sx),
  };
}

/** Shortest journey between two nodes, as a dense track. */
function journey(net: Network, from: number, to: number): Track | null {
  const distTo = new Array<number>(net.nodes).fill(Infinity);
  const prev = new Array<{ edge: Edge; from: number } | null>(net.nodes).fill(null);
  const done = new Array<boolean>(net.nodes).fill(false);
  distTo[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < net.nodes; i++) if (!done[i] && distTo[i]! < Infinity && (u < 0 || distTo[i]! < distTo[u]!)) u = i;
    if (u < 0 || u === to) break;
    done[u] = true;
    for (const e of net.edges) {
      const v = e.a === u ? e.b : e.b === u ? e.a : -1;
      if (v < 0 || done[v]) continue;
      const d = distTo[u]! + e.len + (e.line < 0 ? 40 : 0);
      if (d < distTo[v]!) {
        distTo[v] = d;
        prev[v] = { edge: e, from: u };
      }
    }
  }
  if (!Number.isFinite(distTo[to]!)) return null;
  const legs: { pts: readonly Pt[]; line: number }[] = [];
  for (let v = to; v !== from; ) {
    const step = prev[v]!;
    legs.unshift({ pts: step.edge.a === step.from ? step.edge.pts : [...step.edge.pts].reverse(), line: step.edge.line });
    v = step.from;
  }
  const pts: Pt[] = [];
  const line: number[] = [];
  let lastLine = legs.find((l) => l.line >= 0)?.line ?? 0;
  for (const leg of legs) {
    if (leg.line >= 0) lastLine = leg.line;
    leg.pts.forEach((p, k) => {
      if (k === 0 && pts.length) return;
      pts.push(p);
      line.push(lastLine);
    });
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  return { pts, cum, line, len: cum[cum.length - 1] ?? 0 };
}

/** Trapezoidal speed profile: pull away, cruise, brake into the platform. */
function ride(t: number): number {
  const a = 0.3;
  const b = 0.34;
  const v = 1 / (1 - a / 2 - b / 2);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < a) return (0.5 * v * t * t) / a;
  if (t < 1 - b) return v * (a / 2) + v * (t - a);
  return 1 - (0.5 * v * (1 - t) * (1 - t)) / b;
}

/**
 * Layout — Metro Map: the projects as a transit network. One line per kind,
 * every project a station (interchanges where kinds meet). Pick a station and
 * a little train rides the real lines there; on arrival the platform screen
 * shows the project. Phones get a vertical strip-map.
 */
@Component({
  selector: 'app-projects-metro',
  imports: [ProjectMediaView],
  templateUrl: './metro.html',
  styleUrl: './metro.css',
})
export class ProjectsMetro {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;
  protected readonly net = computed(() => buildNetwork(this.projects()));
  /** Where the train is (or is heading). */
  protected readonly current = signal(0);
  /** Project on the platform screen. */
  protected readonly shown = signal(0);
  protected readonly moving = signal(false);
  protected readonly hovered = signal(-1);
  protected readonly drawn = signal(false);
  protected readonly inView = signal(false);
  protected readonly compact = signal(false);
  protected readonly ready = signal(false);

  protected readonly lineByKind = computed(() => {
    const map = new Map<ProjectKind, MetroLine>();
    for (const line of this.net().lines) map.set(line.kind, line);
    return map;
  });

  /** Strip-map lanes: each line spans from its first to its last stop. */
  protected readonly lanes = computed(() => {
    const projects = this.projects();
    return this.net().lines.map((line) => {
      const stops = projects.map((p, i) => (p.kinds.includes(line.kind) ? i : -1)).filter((i) => i >= 0);
      return { line, lane: line.row, from: stops[0] ?? 0, to: stops[stops.length - 1] ?? 0 };
    });
  });

  private readonly document = inject(DOCUMENT);
  private readonly root = viewChild.required<ElementRef<HTMLElement>>('root');
  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  private readonly cam = viewChild<ElementRef<HTMLElement>>('cam');
  private readonly train = viewChild<ElementRef<SVGGElement>>('train');
  private readonly reduced = prefersReducedMotion(this.document.defaultView);

  private queued: number | null = null;
  private trip: { track: Track; start: number; duration: number; to: number } | null = null;
  private trainPos: Pt = { x: 0, y: 0 };
  private trainAngle = 0;
  private trainLine = -1;
  private camera = { x: 0, y: 0, s: 1, init: false };
  private wake = () => {};
  private stripTimer = 0;

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      if (!view) return;
      const root = this.root().nativeElement;
      const mq = view.matchMedia('(max-width: 760px)');
      const onMq = () => {
        this.compact.set(mq.matches);
        this.camera.init = false;
        this.wake();
      };
      onMq();
      mq.addEventListener('change', onMq);

      const start = this.net().stations[this.current()];
      if (start) this.trainPos = { x: start.x, y: start.y };
      this.trainLine = start?.lines[0] ?? 0;

      const io = new IntersectionObserver(
        ([entry]) => {
          const visible = !!entry?.isIntersecting;
          this.inView.set(visible);
          if (visible && !this.drawn()) {
            this.drawn.set(true);
            view.setTimeout(() => this.ready.set(true), this.reduced ? 0 : 1500);
          }
          if (visible) this.wake();
        },
        { threshold: 0.2 },
      );
      io.observe(root);

      let frame = 0;
      let last = performance.now();
      const tick = (now: number) => {
        frame = 0;
        const dt = Math.min(64, now - last);
        last = now;
        const busy = this.step(now, dt);
        if (busy && this.inView()) frame = requestAnimationFrame(tick);
      };
      this.wake = () => {
        if (frame) return;
        last = performance.now();
        frame = requestAnimationFrame(tick);
      };
      const resize = new ResizeObserver(() => {
        this.camera.init = false;
        this.wake();
      });
      resize.observe(root);
      this.wake();

      cleanup = () => {
        cancelAnimationFrame(frame);
        view.clearTimeout(this.stripTimer);
        mq.removeEventListener('change', onMq);
        io.disconnect();
        resize.disconnect();
      };
    });

    inject(DestroyRef).onDestroy(() => cleanup());
  }

  protected onStation(index: number): void {
    if (index === this.current() && !this.moving()) {
      this.open(index);
      return;
    }
    this.go(index);
  }

  protected onKey(event: KeyboardEvent): void {
    const n = this.projects().length;
    let delta = 0;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') delta = 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') delta = -1;
    else return;
    event.preventDefault();
    const base = this.queued ?? this.current();
    const next = (base + delta + n) % n;
    this.root()
      .nativeElement.querySelector<HTMLElement>(`button[data-project="${next}"]`)
      ?.focus({ preventScroll: true });
    this.go(next);
  }

  /** Departure-board line for the platform screen. */
  protected readonly ticker = computed(() => {
    const list = this.projects();
    if (this.moving()) return `Now travelling to ${list[this.current()]?.name ?? ''} · Please stand clear of the doors ·`;
    const here = list[this.shown()];
    if (!here) return '';
    const lines = here.kinds.map(kindLabel);
    const change =
      lines.length > 1
        ? `Change here for ${lines.slice(0, -1).join(', ')} and ${lines[lines.length - 1]} lines`
        : `${lines[0] ?? ''} line`;
    return `This is ${here.name} · ${change} ·`;
  });

  /** The next two stops after the one on the screen. */
  protected readonly upcoming = computed(() => {
    const n = this.projects().length;
    return [1, 2].filter((k) => k < n).map((k) => (this.shown() + k) % n);
  });

  protected stepBy(delta: number): void {
    const n = this.projects().length;
    this.go(((this.queued ?? this.current()) + delta + n) % n);
  }

  protected open(index: number): void {
    const media = this.root().nativeElement.querySelector<HTMLElement>(
      `.screen[data-project="${index}"] app-project-media`,
    );
    this.openCase.emit({ index, media });
  }

  protected viewBox(net: Network): string {
    return `0 0 ${net.w.toFixed(0)} ${net.h.toFixed(0)}`;
  }

  /** Strip-map: the lanes a station touches. */
  protected laneSpan(index: number): { from: number; to: number } {
    const lanes = this.net()
      .stations[index]!.lines.map((l) => this.net().lines[l]?.row ?? l)
      .sort((a, b) => a - b);
    return { from: lanes[0] ?? 0, to: lanes[lanes.length - 1] ?? 0 };
  }

  private go(index: number): void {
    if (this.moving()) {
      this.queued = index === this.current() ? null : index;
      return;
    }
    if (index === this.current()) return;
    const net = this.net();
    const target = net.stations[index];
    if (!target) return;
    this.current.set(index);
    this.queued = null;

    if (this.reduced) {
      this.trainPos = { x: target.x, y: target.y };
      this.trainLine = target.lines[0] ?? this.trainLine;
      this.shown.set(index);
      this.camera.init = false;
      this.wake();
      return;
    }

    this.moving.set(true);
    if (this.compact()) {
      // The strip-map train is a CSS transition; just wait for it.
      const from = this.shown();
      const duration = Math.min(2200, 700 + Math.abs(index - from) * 260);
      this.root().nativeElement.style.setProperty('--strip-ms', `${duration}ms`);
      const view = this.document.defaultView!;
      view.clearTimeout(this.stripTimer);
      this.stripTimer = view.setTimeout(() => this.arrive(index), duration);
      return;
    }

    const from = net.stations[this.shown()];
    const track = from ? journey(net, from.index, index) : null;
    if (!track || track.len < 1) {
      this.arrive(index);
      return;
    }
    const duration = Math.max(1000, Math.min(3400, 650 + track.len * 1.15));
    this.trip = { track, start: performance.now(), duration, to: index };
    this.wake();
  }

  private arrive(index: number): void {
    const station = this.net().stations[index];
    if (station) this.trainPos = { x: station.x, y: station.y };
    this.trip = null;
    this.moving.set(false);
    this.shown.set(index);
    const next = this.queued;
    this.queued = null;
    if (next !== null && next !== index) this.go(next);
  }

  /** One frame of train + camera. Returns whether more frames are needed. */
  private step(now: number, dt: number): boolean {
    if (this.compact()) return false;
    let busy = false;
    const trip = this.trip;
    if (trip) {
      const t = Math.min(1, (now - trip.start) / trip.duration);
      const s = ride(t) * trip.track.len;
      const { pts, cum, line } = trip.track;
      let i = 1;
      while (i < cum.length - 1 && cum[i]! < s) i++;
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const seg = cum[i]! - cum[i - 1]! || 1;
      const k = Math.max(0, Math.min(1, (s - cum[i - 1]!) / seg));
      this.trainPos = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      const want = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      let diff = want - this.trainAngle;
      diff = ((((diff + 180) % 360) + 360) % 360) - 180;
      this.trainAngle += diff * Math.min(1, dt / 70);
      this.trainLine = line[i] ?? this.trainLine;
      if (t >= 1) this.arrive(trip.to);
      else busy = true;
    }
    this.paintTrain();
    if (this.moveCamera(dt)) busy = true;
    return busy;
  }

  private paintTrain(): void {
    const train = this.train()?.nativeElement;
    if (!train) return;
    const { x, y } = this.trainPos;
    train.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${this.trainAngle.toFixed(2)})`);
    const color = this.net().lines[this.trainLine]?.color;
    if (color) train.style.setProperty('--c', color);
  }

  /** Ease the camera toward the train. Returns whether it is still moving. */
  private moveCamera(dt: number): boolean {
    const viewport = this.viewport()?.nativeElement;
    const cam = this.cam()?.nativeElement;
    if (!viewport || !cam) return false;
    const net = this.net();
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (!w || !h) return false;
    const fit = Math.min(w / net.w, h / net.h);
    // At rest the whole sheet is visible; while riding, the camera leans in after the train.
    const riding = !!this.trip;
    const s = riding ? Math.min(1.15, fit * 1.3) : fit;
    const lean = riding ? 0.9 : 0;
    const focus = {
      x: net.w / 2 + (this.trainPos.x - net.w / 2) * lean,
      y: net.h / 2 + (this.trainPos.y - net.h / 2) * lean * 0.6,
    };
    const clampAxis = (size: number, view: number, f: number) => {
      const scaled = size * s;
      if (scaled <= view) return (view - scaled) / 2;
      return Math.min(0, Math.max(view - scaled, view / 2 - f * s));
    };
    const tx = clampAxis(net.w, w, focus.x);
    const ty = clampAxis(net.h, h, focus.y);
    const c = this.camera;
    if (!c.init || this.reduced) {
      c.x = tx;
      c.y = ty;
      c.s = s;
      c.init = true;
    } else {
      const k = 1 - Math.exp(-dt / 420);
      c.x += (tx - c.x) * k;
      c.y += (ty - c.y) * k;
      c.s += (s - c.s) * k;
    }
    cam.style.transform = `translate3d(${c.x.toFixed(2)}px, ${c.y.toFixed(2)}px, 0) scale(${c.s.toFixed(4)})`;
    return Math.abs(tx - c.x) > 0.3 || Math.abs(ty - c.y) > 0.3 || Math.abs(s - c.s) > 0.0005;
  }
}
