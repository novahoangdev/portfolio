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

/** Run a DOM update inside a view transition when supported and motion is allowed. */
export function withViewTransition(
  document: Document,
  update: () => void,
): ViewTransition | null {
  if (prefersReducedMotion(document.defaultView) || typeof document.startViewTransition !== 'function') {
    update();
    return null;
  }
  return document.startViewTransition(update);
}
