/** Every way the side projects can be shown. `classic` ones come first in the Layout Lab. */
export type LayoutId =
  | 'wall'
  | 'orbit'
  | 'deck'
  | 'gallery'
  | 'desk'
  | 'pit'
  | 'tv'
  | 'canvas'
  | 'magazine'
  | 'ide'
  | 'metro'
  | 'darkroom'
  | 'retro'
  | 'cards'
  | 'tower';

export interface LayoutOption {
  readonly id: LayoutId;
  readonly label: string;
  readonly hint: string;
  readonly group: 'classic' | 'experimental' | 'playground';
}

export const layoutOptions: readonly LayoutOption[] = [
  { id: 'ide', label: 'Code Editor', hint: 'Open a file from the explorer', group: 'classic' },
  { id: 'wall', label: 'Wall', hint: 'Every project at once — hover a tile, click to open', group: 'classic' },
  { id: 'orbit', label: 'Orbit', hint: 'Drag or swipe the ring — the front project plays', group: 'classic' },
  { id: 'deck', label: 'Deck', hint: 'Pick a card from the hand — it springs to the centre', group: 'classic' },
  // Gallery Hall ('gallery') is hidden until it is reworked; its files and loader stay in place.
  { id: 'desk', label: 'Polaroid Desk', hint: 'Drag and toss the prints, double-click to flip one', group: 'experimental' },
  { id: 'pit', label: 'Ball Pit', hint: 'Grab, throw and nudge the bubbles', group: 'experimental' },
  { id: 'tv', label: 'Channel Surf', hint: 'Turn the dial — every channel is a project', group: 'experimental' },
  { id: 'canvas', label: 'Infinite Canvas', hint: 'Drag to pan, scroll or pinch to zoom', group: 'experimental' },
  { id: 'magazine', label: 'Magazine', hint: 'Turn the pages — one spread per project', group: 'experimental' },
  { id: 'metro', label: 'Metro Map', hint: 'Ride the lines — every station is a project', group: 'playground' },
  { id: 'darkroom', label: 'Darkroom', hint: 'Develop the prints under the safelight', group: 'playground' },
  { id: 'retro', label: 'Retro Desktop', hint: 'Double-click an icon, drag the windows around', group: 'playground' },
  { id: 'cards', label: 'Booster Pack', hint: 'Tear open the pack, tilt the holo cards', group: 'playground' },
  { id: 'tower', label: 'Night Tower', hint: 'Ride the lift floor by floor', group: 'playground' },
];

export function isLayoutId(value: string | null): value is LayoutId {
  return !!value && layoutOptions.some((option) => option.id === value);
}
