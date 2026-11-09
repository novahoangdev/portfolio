/** Every way the side projects can be shown. `classic` ones come first in the Layout Lab. */
export type LayoutId =
  | 'wall'
  | 'orbit'
  | 'deck'
  | 'strip'
  | 'index'
  | 'gallery'
  | 'flashlight'
  | 'desk'
  | 'pit'
  | 'tv'
  | 'vinyl'
  | 'canvas'
  | 'magazine'
  | 'ide'
  | 'cinema'
  | 'metro'
  | 'stars'
  | 'darkroom'
  | 'retro'
  | 'type'
  | 'cards'
  | 'kaleido'
  | 'calder'
  | 'gacha'
  | 'tower';

export interface LayoutOption {
  readonly id: LayoutId;
  readonly label: string;
  readonly hint: string;
  readonly group: 'classic' | 'experimental' | 'playground';
}

export const layoutOptions: readonly LayoutOption[] = [
  { id: 'wall', label: 'Wall', hint: 'Every project at once — hover a tile, click to open', group: 'classic' },
  { id: 'orbit', label: 'Orbit', hint: 'Drag or swipe the ring — the front project plays', group: 'classic' },
  { id: 'deck', label: 'Deck', hint: 'Pick a card from the hand — it springs to the centre', group: 'classic' },
  { id: 'strip', label: 'Strip', hint: 'Keep scrolling — the reel glides sideways', group: 'classic' },
  { id: 'index', label: 'Index', hint: 'Hover a name to preview it beside your cursor', group: 'classic' },
  { id: 'gallery', label: 'Gallery Hall', hint: 'Scroll to walk down a lit museum hall', group: 'experimental' },
  { id: 'flashlight', label: 'Flashlight', hint: 'Lights off — your cursor is the torch', group: 'experimental' },
  { id: 'desk', label: 'Polaroid Desk', hint: 'Drag and toss the prints, double-click to flip one', group: 'experimental' },
  { id: 'pit', label: 'Ball Pit', hint: 'Grab, throw and nudge the bubbles', group: 'experimental' },
  { id: 'tv', label: 'Channel Surf', hint: 'Turn the dial — every channel is a project', group: 'experimental' },
  { id: 'vinyl', label: 'Vinyl Crate', hint: 'Dig through the crate and pull a record', group: 'experimental' },
  { id: 'canvas', label: 'Infinite Canvas', hint: 'Drag to pan, scroll or pinch to zoom', group: 'experimental' },
  { id: 'magazine', label: 'Magazine', hint: 'Turn the pages — one spread per project', group: 'experimental' },
  { id: 'ide', label: 'Code Editor', hint: 'Open a file from the explorer', group: 'experimental' },
  { id: 'cinema', label: 'Cinema Stories', hint: 'Sit back — tap the sides to skip', group: 'experimental' },
  { id: 'metro', label: 'Metro Map', hint: 'Ride the lines — every station is a project', group: 'playground' },
  { id: 'stars', label: 'Constellations', hint: 'Trace the night sky through a telescope', group: 'playground' },
  { id: 'darkroom', label: 'Darkroom', hint: 'Develop the prints under the safelight', group: 'playground' },
  { id: 'retro', label: 'Retro Desktop', hint: 'Double-click an icon, drag the windows around', group: 'playground' },
  { id: 'type', label: 'Typemask', hint: 'Scroll — the videos play inside the letters', group: 'playground' },
  { id: 'cards', label: 'Booster Pack', hint: 'Tear open the pack, tilt the holo cards', group: 'playground' },
  { id: 'kaleido', label: 'Kaleidoscope', hint: 'Turn the scope to change the view', group: 'playground' },
  { id: 'calder', label: 'Hanging Mobile', hint: 'Nudge the mobile — it swings and balances', group: 'playground' },
  { id: 'gacha', label: 'Capsule Machine', hint: 'Turn the crank and pop a capsule', group: 'playground' },
  { id: 'tower', label: 'Night Tower', hint: 'Ride the lift floor by floor', group: 'playground' },
];

export function isLayoutId(value: string | null): value is LayoutId {
  return !!value && layoutOptions.some((option) => option.id === value);
}
