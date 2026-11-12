/**
 * Personal projects shown below the CV. Descriptions are condensed from each
 * repository's README on github.com/novahoangdev — keep them in sync.
 */
export type ProjectKind = 'web' | 'ios' | '3d' | 'tools';

export const projectKinds: readonly { readonly id: ProjectKind; readonly label: string }[] = [
  { id: 'web', label: 'Web' },
  { id: 'ios', label: 'iOS' },
  { id: '3d', label: '3D & WebGL' },
  { id: 'tools', label: 'Tools' },
];

export interface SideProject {
  readonly name: string;
  /** One line shown on the wall tile. */
  readonly tagline: string;
  readonly kinds: readonly ProjectKind[];
  readonly summary: string;
  readonly technologies: readonly string[];
  /** Omitted while the repository is private. */
  readonly repoUrl?: string;
  readonly liveUrl?: string;
  readonly demoUrl?: string;
  /**
   * Card media under `public/images/projects/`: a muted looping MP4 with a WebP
   * poster, or just an image (e.g. a generated banner when no demo exists).
   */
  readonly media: ProjectMedia;
  /** More demos shown beside `media` on a featured card (e.g. web + iOS). */
  readonly extraMedia?: readonly ProjectMedia[];
  readonly status?: string;
  /** Spans the full grid row on wide screens. */
  readonly featured?: boolean;
  /** Ambient glow behind the project's media on the scroll stage. */
  readonly accent: string;
}

export interface ProjectMedia {
  readonly video?: string;
  readonly image: string;
  readonly alt: string;
  /** Frame shape; defaults to the 4:3 card frame. */
  readonly shape?: 'portrait' | 'wide';
  /** Small caption over the media, e.g. "Web app". */
  readonly label?: string;
}

const github = 'https://github.com/novahoangdev';

export const sideProjects: readonly SideProject[] = [
  {
    name: 'Pastel Studio',
    tagline: 'Any photo, painted stroke by stroke in 16 real media.',
    kinds: ['web'],
    accent: '#e5a36e',
    summary:
      'Turn any photo into a hand-made painting, stroke by stroke. Pick one of 16 real media — oil pastel, watercolor, charcoal, ink wash, anime and more — and watch the tool work through sketch, underpainting, layers and detail, then sign the corner. Everything runs in the browser, with no AI, no cloud and no account: a vanilla JavaScript app with a Canvas 2D painting engine, stroke planning in a Web Worker and a live Three.js frame on the home page.',
    technologies: ['JavaScript', 'Canvas 2D', 'Web Workers', 'Three.js'],
    liveUrl: 'https://pastel-studio.web.app',
    media: {
      video: '/images/projects/pastel-studio-web.mp4',
      image: '/images/projects/pastel-studio-web.webp',
      alt: 'Pastel Studio web app: from the home page, a sample photo of a man sitting in a movie poster is painted in oil pastel through sketch, underpainting, form, blend, color and details',
      shape: 'wide',
    },
    featured: true,
  },
  {
    name: 'Pastel Studio for iOS',
    tagline: 'The painting studio, native on iPhone.',
    kinds: ['ios'],
    accent: '#5b7fd1',
    summary:
      'The native iOS version of Pastel Studio: the same 16 real media and stroke-by-stroke painting, opening with a flight into a moving Van Gogh Starry Night. Every screen is a native component drawn with React Native Skia and animated with Reanimated, with a WebGPU background and a Skia fallback. Everything is painted on the device, with no AI, no cloud and no account.',
    technologies: ['Expo', 'React Native', 'Skia', 'Reanimated', 'WebGPU', 'Blender'],
    media: {
      video: '/images/projects/pastel-studio.mp4',
      image: '/images/projects/pastel-studio.webp',
      alt: 'Pastel Studio iOS promo: flying into a moving Van Gogh Starry Night, then any photo painted stroke by stroke',
      shape: 'portrait',
    },
  },
  {
    name: 'Interactive Workspace',
    tagline: 'A 3D desk you can explore — and a kart you can drive.',
    kinds: ['web', '3d'],
    accent: '#2dd4bf',
    summary:
      'An interactive 3D WebGL portfolio: explore the desk setup, open the CV, or drive a kart around the circuit. Procedural Three.js models with no external 3D assets, plus Web Audio sound.',
    technologies: ['React 19', 'TypeScript', 'Three.js', 'Tailwind CSS', 'Vite'],
    repoUrl: `${github}/interactive-workspace`,
    liveUrl: 'https://interactive-workspace-nova.web.app',
    media: {
      video: '/images/projects/interactive-workspace.mp4',
      image: '/images/projects/interactive-workspace.webp',
      alt: 'Interactive Workspace: the camera sweeps around a 3D desk setup on a kart circuit',
    },
    status: 'In progress',
  },
  {
    name: 'Soap Bubbles',
    tagline: 'Blow into the mic; real thin-film colour in a shader.',
    kinds: ['ios', '3d'],
    accent: '#a3c97a',
    summary:
      'Blow into the iPhone microphone and soap bubbles swell out of a wand. Real thin-film colour is computed per pixel in a Skia runtime shader; bubbles stick into clusters and pop into droplets. A second mode drifts through a 3D daisy meadow with three.js on WebGPU.',
    technologies: ['Expo', 'React Native', 'Skia', 'Reanimated', 'three.js WebGPU', 'Blender'],
    repoUrl: `${github}/soap-bubbles`,
    demoUrl: `${github}/soap-bubbles/blob/HEAD/docs/garden3d.mp4`,
    media: {
      video: '/images/projects/soap-bubbles.mp4',
      image: '/images/projects/soap-bubbles.webp',
      alt: 'Soap Bubbles 3D garden: the camera follows a big bubble over a daisy meadow until it pops',
    },
  },
  {
    name: 'Neon Sign',
    tagline: 'Finger-drawn neon lighting a rainy alley in real time.',
    kinds: ['ios'],
    accent: '#ff4fa3',
    summary:
      'Draw neon signs with your finger on a rainy alley wall. Strokes freeze into glass tubes that flicker on and light every brick in real time: a Skia shader lights a Blender-rendered normal map, with wet reflections and puddle ripples.',
    technologies: ['Expo', 'React Native', 'Skia Graphite', 'Reanimated', 'Blender'],
    repoUrl: `${github}/neon-sign`,
    demoUrl: `${github}/neon-sign/blob/HEAD/docs/demo.mp4`,
    media: {
      video: '/images/projects/neon-sign.mp4',
      image: '/images/projects/neon-sign.webp',
      alt: 'Neon Sign demo: drawing a glowing heart and the word hello on a brick wall',
    },
  },
  {
    name: 'Pumpkin Carve',
    tagline: 'Candlelight through exactly the strokes you carved.',
    kinds: ['ios'],
    accent: '#f28c28',
    summary:
      'Carve a face into a pumpkin with your finger, then light the candle: the light shines through exactly the strokes you carved. Blender pre-renders 2.5D layers that Skia shaders composite in real time, with gyro parallax, fog light shafts and haptics.',
    technologies: ['Expo', 'React Native', 'Skia', 'Reanimated', 'Blender'],
    repoUrl: `${github}/pumpkin-carve`,
    demoUrl: `${github}/pumpkin-carve/blob/HEAD/render/promo/pumpkin-carve-final-v2.mp4`,
    media: {
      video: '/images/projects/pumpkin-carve.mp4',
      image: '/images/projects/pumpkin-carve.webp',
      alt: 'Pumpkin Carve demo: a carved pumpkin glowing on a porch at night',
    },
  },
  {
    name: 'Saiyan Awakening',
    tagline: 'A just-for-fun Super Saiyan cinematic on iPhone.',
    kinds: ['ios', '3d'],
    accent: '#f5c242',
    summary:
      'A just-for-fun Goku vs Frieza iPhone cinematic: hold to charge your Ki, go Super Saiyan, dodge the Death Beam and finish with a Kamehameha. Blender renders the 3D passes into one video; Skia draws aura, lightning, beams and explosions on top in real time.',
    technologies: ['Expo', 'React Native', 'Skia', 'Reanimated', 'WebGPU', 'Blender'],
    repoUrl: `${github}/goku-vs-frieza`,
    demoUrl: `${github}/goku-vs-frieza/blob/HEAD/render/promo/saiyan-awakening-demo.mp4`,
    media: {
      video: '/images/projects/goku-vs-frieza.mp4',
      image: '/images/projects/goku-vs-frieza.webp',
      alt: 'Saiyan Awakening demo: chibi Goku transforms into a Super Saiyan',
    },
    status: 'Fan art',
  },
  {
    name: 'Mac Dev Setup',
    tagline: 'One Brewfile and a step-by-step guide for vibe coding on a Mac.',
    kinds: ['tools'],
    accent: '#3fb98f',
    summary:
      'An Apple Silicon Mac setup for vibe coding with many AI agents: one Brewfile, a bilingual step-by-step guide, and scripts to back up and restore macOS settings.',
    technologies: ['Homebrew', 'Shell', 'Claude Code', 'Firebase Hosting'],
    repoUrl: `${github}/mac-dev-setup`,
    liveUrl: 'https://setup-dev-mac.web.app',
    media: {
      video: '/images/projects/mac-dev-setup.mp4',
      image: '/images/projects/mac-dev-setup.webp',
      alt: 'Mac Dev Setup guide site: quick-start steps, Zsh config and AI agent sections for Apple Silicon Macs',
    },
  },
  {
    name: 'Dev Workspace',
    tagline: 'Rules, skills and safety rails for AI-assisted coding.',
    kinds: ['tools'],
    accent: '#78bbb5',
    summary:
      'A multi-repository workspace for AI-assisted coding: portable agent rules, reusable Agent Skills, explicit Git safety boundaries and verification workflows for Codex, Claude Code and GitHub Copilot.',
    technologies: ['Agent Skills', 'Claude Code', 'Codex', 'Shell'],
    repoUrl: `${github}/dev-workspace`,
    media: {
      image: '/images/projects/dev-workspace.webp',
      alt: 'Illustration of a terminal connected to repositories, agents, a safety shield and a checklist',
    },
    status: 'In progress',
  },
];
