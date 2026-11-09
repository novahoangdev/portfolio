import { ProjectKind, projectKinds } from '../../../data/projects';

/** A layout asks the parent to open a project's case, morphing from `media`. */
export interface OpenCase {
  readonly index: number;
  readonly media: HTMLElement | null;
}

export function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function kindLabel(kind: ProjectKind): string {
  return projectKinds.find((k) => k.id === kind)?.label ?? kind;
}

export function prefersReducedMotion(view: Window | null): boolean {
  return view?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function canHover(view: Window | null): boolean {
  return view?.matchMedia('(hover: hover) and (pointer: fine)').matches ?? false;
}

/**
 * Run a DOM update inside a view transition when supported and motion is allowed.
 * `kind` puts `vt-<kind>` on <html> for the transition's lifetime, so only the
 * elements of *that* transition get a view-transition-name (named elements are
 * painted above everything else, e.g. over the case dialog).
 */
export function withViewTransition(
  document: Document,
  update: () => void,
  kind?: 'layout' | 'filter' | 'case',
): ViewTransition | null {
  if (prefersReducedMotion(document.defaultView) || typeof document.startViewTransition !== 'function') {
    update();
    return null;
  }
  const root = document.documentElement;
  const className = kind ? `vt-${kind}` : '';
  if (className) {
    activeKinds.set(className, (activeKinds.get(className) ?? 0) + 1);
    root.classList.add(className);
  }
  const transition = document.startViewTransition(update);
  if (className) {
    transition.finished.finally(() => {
      const left = (activeKinds.get(className) ?? 1) - 1;
      activeKinds.set(className, left);
      if (left === 0) root.classList.remove(className);
    });
  }
  return transition;
}

/** Overlapping transitions of one kind (e.g. fast Next clicks) share its class. */
const activeKinds = new Map<string, number>();
