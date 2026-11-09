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

/** Syntax classes used by the README renderer (`t-<cls>` in the stylesheet). */
type TokenClass = 'p' | 'k' | 's' | 'e' | 'b' | 'hm' | 'h' | 'h2' | 'qm' | 'q' | 'tx' | 'li' | 'code' | 'lt' | 'u';

interface Token {
  readonly text: string;
  readonly cls: TokenClass;
  /** Character offset of the token in the whole document. */
  readonly start: number;
  readonly href?: string;
  /** Colour decorator drawn before the token (like an editor's colour swatch). */
  readonly swatch?: string;
}

interface Line {
  readonly tokens: readonly Token[];
  readonly start: number;
  readonly length: number;
}

interface Doc {
  readonly lines: readonly Line[];
  readonly total: number;
}

interface TermLine {
  readonly label: string;
  readonly value: string;
  readonly href?: string;
}

interface Session {
  readonly id: number;
  readonly command: string;
  readonly out: readonly TermLine[];
  readonly typed: number;
  readonly shown: number;
}

interface PaletteHit {
  readonly index: number;
  readonly file: string;
  /** File name split into plain / matched runs for highlighting. */
  readonly parts: readonly { readonly text: string; readonly hit: boolean }[];
  readonly score: number;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Turn a project into a small Markdown README, tokenised for highlighting. */
function buildDoc(project: SideProject): Doc {
  const raw: { text: string; cls: TokenClass; href?: string; swatch?: string }[][] = [];
  const line = (...tokens: { text: string; cls: TokenClass; href?: string; swatch?: string }[]) => raw.push(tokens);
  const t = (text: string, cls: TokenClass, extra: { href?: string; swatch?: string } = {}) => ({ text, cls, ...extra });
  const field = (key: string, ...value: { text: string; cls: TokenClass; swatch?: string }[]) =>
    line(t(key, 'k'), t(': ', 'p'), ...value);

  line(t('---', 'p'));
  field('name', t(slugify(project.name), 's'));
  const kinds: { text: string; cls: TokenClass }[] = [t('[', 'p')];
  project.kinds.forEach((kind, i) => {
    if (i) kinds.push(t(', ', 'p'));
    kinds.push(t(kind, 'e'));
  });
  kinds.push(t(']', 'p'));
  field('kinds', ...kinds);
  if (project.status) field('status', t(`"${project.status}"`, 's'));
  if (project.featured) field('featured', t('true', 'b'));
  field('accent', t(`"${project.accent}"`, 's', { swatch: project.accent }));
  line(t('---', 'p'));
  line();
  line(t('# ', 'hm'), t(project.name, 'h'));
  line();
  line(t('> ', 'qm'), t(project.tagline, 'q'));
  line();
  // One sentence per line (semantic line breaks), like a hand-written README.
  for (const sentence of project.summary.split(/(?<=[.!?:])\s+(?=[A-Z])/)) line(t(sentence, 'tx'));
  line();
  line(t('## ', 'hm'), t('Technologies', 'h2'));
  line();
  for (const tech of project.technologies) line(t('- ', 'li'), t('`', 'p'), t(tech, 'code'), t('`', 'p'));
  const links: [string, string | undefined][] = [
    ['Live site', project.liveUrl],
    ['Watch demo', project.demoUrl],
    ['GitHub', project.repoUrl],
  ];
  if (links.some(([, url]) => url)) {
    line();
    line(t('## ', 'hm'), t('Links', 'h2'));
    line();
    for (const [label, url] of links) {
      if (!url) continue;
      line(t('- ', 'li'), t('[', 'p'), t(label, 'lt'), t('](', 'p'), t(url, 'u', { href: url }), t(')', 'p'));
    }
  }

  let offset = 0;
  const lines: Line[] = raw.map((tokens) => {
    const start = offset;
    const placed = tokens.map((token) => {
      const placedToken: Token = { ...token, start: offset };
      offset += token.text.length;
      return placedToken;
    });
    const length = offset - start;
    offset += 1; // newline
    return { tokens: placed, start, length };
  });
  return { lines, total: Math.max(0, offset - 1) };
}

/** Subsequence fuzzy match with a bonus for consecutive / word-start hits. */
function fuzzy(query: string, text: string): { score: number; hits: Set<number> } | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, hits: new Set() };
  const s = text.toLowerCase();
  const hits = new Set<number>();
  let score = 0;
  let from = 0;
  let last = -2;
  for (const ch of q) {
    const at = s.indexOf(ch, from);
    if (at < 0) return null;
    hits.add(at);
    score += at === last + 1 ? 3 : 1;
    if (at === 0 || /[-_. ]/.test(s[at - 1] ?? '')) score += 2;
    last = at;
    from = at + 1;
  }
  return { score: score - s.length * 0.01, hits };
}

/** Layout — a dark code editor: open a project's README from the explorer, watch its live preview. */
@Component({
  selector: 'app-projects-ide',
  imports: [ProjectMediaView],
  templateUrl: './ide.html',
  styleUrl: './ide.css',
})
export class ProjectsIde {
  readonly projects = input.required<readonly SideProject[]>();
  readonly openCase = output<OpenCase>();

  protected readonly pad = pad;
  protected readonly kindLabel = kindLabel;
  protected readonly Math = Math;

  protected readonly files = computed(() =>
    this.projects().map((project, index) => ({ project, index, slug: slugify(project.name), file: `${slugify(project.name)}.md` })),
  );
  protected readonly folders = computed(() =>
    projectKinds
      .map((kind) => ({ kind: kind.id, label: kind.label, files: this.files().filter((f) => f.project.kinds.includes(kind.id)) }))
      .filter((folder) => folder.files.length > 0),
  );

  protected readonly tabs = signal<readonly number[]>([]);
  protected readonly active = signal<number | null>(null);
  protected readonly collapsed = signal<ReadonlySet<ProjectKind>>(new Set());
  protected readonly typed = signal(0);
  protected readonly userCaret = signal<{ line: number; col: number } | null>(null);
  protected readonly booted = signal(false);
  protected readonly onScreen = signal(false);
  protected readonly terminalOpen = signal(true);
  protected readonly sessions = signal<readonly Session[]>([]);
  protected readonly loading = signal(0);

  protected readonly paletteOpen = signal(false);
  protected readonly query = signal('');
  protected readonly cursor = signal(0);

  protected readonly current = computed(() => {
    const index = this.active();
    return index === null ? null : (this.files()[index] ?? null);
  });
  protected readonly doc = computed(() => {
    const current = this.current();
    return current ? buildDoc(current.project) : null;
  });
  protected readonly typing = computed(() => {
    const doc = this.doc();
    return !!doc && this.typed() < doc.total;
  });
  protected readonly caret = computed(() => {
    const doc = this.doc();
    if (!doc) return { line: 0, col: 1 };
    const typed = this.typed();
    if (typed < doc.total) {
      let line = 0;
      while (line < doc.lines.length - 1 && doc.lines[line + 1].start <= typed) line++;
      return { line, col: typed - doc.lines[line].start + 1 };
    }
    const last = doc.lines.length - 1;
    return this.userCaret() ?? { line: last, col: doc.lines[last].length + 1 };
  });
  protected readonly hits = computed<readonly PaletteHit[]>(() => {
    const query = this.query().trim();
    const results: PaletteHit[] = [];
    for (const f of this.files()) {
      const byFile = fuzzy(query, f.file);
      const byName = byFile ? null : fuzzy(query, f.project.name);
      const match = byFile ?? byName;
      if (!match) continue;
      const parts: { text: string; hit: boolean }[] = [];
      [...f.file].forEach((ch, i) => {
        const hit = !!byFile && byFile.hits.has(i);
        const prev = parts[parts.length - 1];
        if (prev && prev.hit === hit) prev.text += ch;
        else parts.push({ text: ch, hit });
      });
      results.push({ index: f.index, file: f.file, parts, score: match.score });
    }
    return query ? results.sort((a, b) => b.score - a.score) : results;
  });

  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly termBody = viewChild<ElementRef<HTMLElement>>('termBody');
  private readonly paletteInput = viewChild<ElementRef<HTMLInputElement>>('paletteInput');
  private readonly reduced = prefersReducedMotion(this.document.defaultView);
  private typeFrame = 0;
  private termTimer = 0;
  private sessionId = 0;
  private returnFocus: HTMLElement | null = null;

  constructor() {
    const view = this.document.defaultView;
    let cleanup = () => {};

    afterNextRender(() => {
      if (!view) return;
      if (view.matchMedia('(max-width: 760px)').matches) this.terminalOpen.set(false);
      if (this.reduced) {
        this.booted.set(true);
        this.open(0);
      }
      const io = new IntersectionObserver(
        ([entry]) => {
          const visible = !!entry?.isIntersecting;
          this.onScreen.set(visible);
          if (visible && !this.booted()) {
            this.booted.set(true);
            // Let the window glide in, then open the first file.
            view.setTimeout(() => this.active() === null && this.tabs().length === 0 && this.open(0), 520);
          }
        },
        { threshold: 0.2 },
      );
      io.observe(this.host);
      cleanup = () => io.disconnect();
    });

    inject(DestroyRef).onDestroy(() => {
      cleanup();
      cancelAnimationFrame(this.typeFrame);
      clearTimeout(this.termTimer);
    });
  }

  protected slugOf(index: number): string {
    return this.files()[index]?.slug ?? '';
  }

  protected fileOf(index: number): string {
    return this.files()[index]?.file ?? '';
  }

  protected visibleText(token: Token): string {
    const shown = this.typed() - token.start;
    return shown >= token.text.length ? token.text : token.text.slice(0, Math.max(0, shown));
  }

  /** Open a file: add (or focus) its tab, type its README, run its terminal session. */
  protected open(index: number): void {
    if (!this.files()[index]) return;
    if (this.active() === index) return;
    const isNew = !this.tabs().includes(index);
    if (isNew) {
      this.tabs.update((tabs) => {
        const active = this.active();
        const at = active === null ? tabs.length : tabs.indexOf(active) + 1;
        return [...tabs.slice(0, at), index, ...tabs.slice(at)];
      });
    }
    this.active.set(index);
    this.userCaret.set(null);
    this.loading.update((n) => n + 1);
    // A freshly opened file types itself out; switching back to a tab shows it as it was.
    if (isNew) this.typeOut();
    else {
      cancelAnimationFrame(this.typeFrame);
      this.typed.set(this.doc()?.total ?? 0);
    }
    this.runSession(index);
    this.revealStripFile(index);
  }

  protected closeTab(index: number, event?: Event): void {
    event?.stopPropagation();
    const tabs = this.tabs();
    const at = tabs.indexOf(index);
    if (at < 0) return;
    const next = tabs.filter((tab) => tab !== index);
    this.tabs.set(next);
    if (this.active() !== index) return;
    const neighbour = next[Math.min(at, next.length - 1)];
    if (neighbour === undefined) {
      cancelAnimationFrame(this.typeFrame);
      this.active.set(null);
    } else {
      this.active.set(null);
      this.open(neighbour);
    }
  }

  protected onTabAux(index: number, event: MouseEvent): void {
    if (event.button === 1) this.closeTab(index, event);
  }

  protected toggleFolder(kind: ProjectKind): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  protected setCaret(line: number): void {
    const doc = this.doc();
    if (!doc || this.typing()) return;
    this.userCaret.set({ line, col: (doc.lines[line]?.length ?? 0) + 1 });
  }

  protected openPreview(): void {
    const index = this.active();
    if (index === null) return;
    const media = this.host.querySelector<HTMLElement>(`.preview [data-project="${index}"] app-project-media`);
    this.openCase.emit({ index, media });
  }

  protected toggleTerminal(): void {
    this.terminalOpen.update((open) => !open);
    if (this.terminalOpen()) this.scrollTerminal();
  }

  /* ---------- keyboard ---------- */

  protected onKey(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && (key === 'k' || key === 'p')) {
      event.preventDefault();
      if (this.paletteOpen()) this.closePalette();
      else this.openPalette();
    }
  }

  protected onExplorerKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...this.host.querySelectorAll<HTMLElement>('.explorer .tree-row')].filter((el) => el.offsetParent);
    const at = items.indexOf(this.document.activeElement as HTMLElement);
    const next = items[at + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  /* ---------- command palette ---------- */

  protected openPalette(): void {
    this.returnFocus = this.document.activeElement as HTMLElement | null;
    this.query.set('');
    this.cursor.set(0);
    this.paletteOpen.set(true);
    queueMicrotask(() => setTimeout(() => this.paletteInput()?.nativeElement.focus({ preventScroll: true })));
  }

  protected closePalette(restore = true): void {
    this.paletteOpen.set(false);
    if (restore) this.returnFocus?.focus({ preventScroll: true });
    this.returnFocus = null;
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    this.cursor.set(0);
  }

  protected onPaletteKey(event: KeyboardEvent): void {
    const hits = this.hits();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!hits.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.cursor.set((this.cursor() + step + hits.length) % hits.length);
      this.host.querySelector(`#ide-opt-${hits[this.cursor()].index}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[this.cursor()];
      if (hit) this.pick(hit.index);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closePalette();
    } else if (event.key === 'Tab') {
      event.preventDefault();
    }
  }

  protected pick(index: number): void {
    this.closePalette(false);
    this.open(index);
    queueMicrotask(() =>
      setTimeout(() => this.host.querySelector<HTMLElement>(`.tab.is-active .tab-label`)?.focus({ preventScroll: true })),
    );
  }

  /* ---------- animation drivers ---------- */

  private typeOut(): void {
    cancelAnimationFrame(this.typeFrame);
    const total = this.doc()?.total ?? 0;
    if (this.reduced) {
      this.typed.set(total);
      return;
    }
    this.typed.set(0);
    const duration = 560;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      // Ease-out: bursts in, settles at the end like fast typing.
      const eased = 1 - Math.pow(1 - p, 2.2);
      this.typed.set(Math.round(eased * total));
      if (p < 1) this.typeFrame = requestAnimationFrame(tick);
    };
    this.typeFrame = requestAnimationFrame(tick);
  }

  private runSession(index: number): void {
    const project = this.files()[index]?.project;
    if (!project) return;
    clearTimeout(this.termTimer);
    const out: TermLine[] = [];
    if (project.liveUrl) out.push({ label: 'Live', value: project.liveUrl, href: project.liveUrl });
    if (project.demoUrl) out.push({ label: 'Demo', value: project.demoUrl, href: project.demoUrl });
    if (project.repoUrl) out.push({ label: 'Source', value: project.repoUrl, href: project.repoUrl });
    out.push({ label: 'Stack', value: project.technologies.join(' · ') });
    if (project.status) out.push({ label: 'Status', value: project.status });

    const command = `open ${slugify(project.name)}`;
    const id = ++this.sessionId;
    const session: Session = { id, command, out, typed: this.reduced ? command.length : 0, shown: this.reduced ? out.length : 0 };
    // Finish any session still typing, keep a short scrollback.
    this.sessions.update((list) =>
      [...list.map((s) => ({ ...s, typed: s.command.length, shown: s.out.length })), session].slice(-4),
    );
    this.scrollTerminal();
    if (this.reduced) return;

    const update = (patch: Partial<Session>) =>
      this.sessions.update((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    let typed = 0;
    let shown = 0;
    const step = () => {
      if (typed < command.length) {
        typed++;
        update({ typed });
        this.termTimer = window.setTimeout(step, typed === command.length ? 220 : 22 + Math.random() * 26);
      } else if (shown < out.length) {
        shown++;
        update({ shown });
        this.scrollTerminal();
        this.termTimer = window.setTimeout(step, 90);
      }
    };
    this.termTimer = window.setTimeout(step, 260);
  }

  /** Mobile: keep the open file's chip in view inside the horizontal strip (without scrolling the page). */
  private revealStripFile(index: number): void {
    requestAnimationFrame(() => {
      const strip = this.host.querySelector<HTMLElement>('.file-strip');
      const chip = strip?.querySelectorAll<HTMLElement>('.strip-file')[index];
      if (!strip || !chip || !strip.offsetParent) return;
      const left = chip.offsetLeft - strip.offsetLeft;
      if (left < strip.scrollLeft || left + chip.offsetWidth > strip.scrollLeft + strip.clientWidth) {
        strip.scrollTo({ left: left - 8, behavior: this.reduced ? 'auto' : 'smooth' });
      }
    });
  }

  private scrollTerminal(): void {
    requestAnimationFrame(() => {
      const body = this.termBody()?.nativeElement;
      if (body) body.scrollTop = body.scrollHeight;
    });
  }
}
