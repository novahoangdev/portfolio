import { Type } from '@angular/core';
import { LayoutId } from './registry';
import { ProjectsWall } from './wall';

/**
 * Each layout is its own lazy chunk. The parent loads a layout *before* starting
 * the switch transition, so the swap happens in one frame (no placeholder, no
 * page-height jump).
 */
const loaders: Record<LayoutId, () => Promise<Type<unknown>>> = {
  wall: () => Promise.resolve(ProjectsWall),
  orbit: () => import('./orbit').then((m) => m.ProjectsOrbit),
  deck: () => import('./deck').then((m) => m.ProjectsDeck),
  strip: () => import('./strip').then((m) => m.ProjectsStrip),
  index: () => import('./index-list').then((m) => m.ProjectsIndex),
  gallery: () => import('./gallery').then((m) => m.ProjectsGallery),
  flashlight: () => import('./flashlight').then((m) => m.ProjectsFlashlight),
  desk: () => import('./desk').then((m) => m.ProjectsDesk),
  pit: () => import('./pit').then((m) => m.ProjectsPit),
  tv: () => import('./tv').then((m) => m.ProjectsTv),
  vinyl: () => import('./vinyl').then((m) => m.ProjectsVinyl),
  canvas: () => import('./canvas').then((m) => m.ProjectsCanvas),
  magazine: () => import('./magazine').then((m) => m.ProjectsMagazine),
  ide: () => import('./ide').then((m) => m.ProjectsIde),
  cinema: () => import('./cinema').then((m) => m.ProjectsCinema),
  metro: () => import('./metro').then((m) => m.ProjectsMetro),
  stars: () => import('./stars').then((m) => m.ProjectsStars),
  darkroom: () => import('./darkroom').then((m) => m.ProjectsDarkroom),
  retro: () => import('./retro').then((m) => m.ProjectsRetro),
  type: () => import('./type').then((m) => m.ProjectsType),
  cards: () => import('./cards').then((m) => m.ProjectsCards),
  kaleido: () => import('./kaleido').then((m) => m.ProjectsKaleido),
  calder: () => import('./calder').then((m) => m.ProjectsCalder),
  gacha: () => import('./gacha').then((m) => m.ProjectsGacha),
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
