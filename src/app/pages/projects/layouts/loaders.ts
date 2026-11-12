import { Type } from '@angular/core';
import { LayoutId } from './registry';
import { ProjectsIde } from './ide';

/**
 * Each layout is its own lazy chunk. The parent loads a layout *before* starting
 * the switch transition, so the swap happens in one frame (no placeholder, no
 * page-height jump).
 */
const loaders: Record<LayoutId, () => Promise<Type<unknown>>> = {
  wall: () => import('./wall').then((m) => m.ProjectsWall),
  orbit: () => import('./orbit').then((m) => m.ProjectsOrbit),
  deck: () => import('./deck').then((m) => m.ProjectsDeck),
  gallery: () => import('./gallery').then((m) => m.ProjectsGallery),
  desk: () => import('./desk').then((m) => m.ProjectsDesk),
  pit: () => import('./pit').then((m) => m.ProjectsPit),
  tv: () => import('./tv').then((m) => m.ProjectsTv),
  canvas: () => import('./canvas').then((m) => m.ProjectsCanvas),
  magazine: () => import('./magazine').then((m) => m.ProjectsMagazine),
  // The default layout ships with the page.
  ide: () => Promise.resolve(ProjectsIde),
  metro: () => import('./metro').then((m) => m.ProjectsMetro),
  darkroom: () => import('./darkroom').then((m) => m.ProjectsDarkroom),
  retro: () => import('./retro').then((m) => m.ProjectsRetro),
  cards: () => import('./cards').then((m) => m.ProjectsCards),
  tower: () => import('./tower').then((m) => m.ProjectsTower),
};

const cache = new Map<LayoutId, Promise<Type<unknown>>>();

/** Load (once) the component of a layout. Failed loads are retried next time. */
export function loadLayout(id: LayoutId): Promise<Type<unknown>> {
  let pending = cache.get(id);
  if (!pending) {
    pending = loaders[id]();
    pending.catch(() => cache.delete(id));
    cache.set(id, pending);
  }
  return pending;
}
