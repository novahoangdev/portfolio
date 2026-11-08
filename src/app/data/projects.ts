/**
 * Side projects shown on the About page. Descriptions follow each project's own README / repo description;
 * demo clips and posters live in public/projects/<slug>.{mp4,jpg}.
 */
export interface SideProject {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  repo: string;
  live?: string;
}

export const sideProjects: SideProject[] = [
  {
    slug: 'soap-bubbles',
    title: 'Soap Bubbles',
    description:
      'Blow into the iPhone microphone and soap bubbles swell out of a wand. Real thin-film colour is computed per pixel in a Skia runtime shader; bubbles stick into clusters and pop into droplets. A second mode drifts through a 3D daisy meadow with three.js on WebGPU.',
    tags: ['Expo', 'React Native', 'Skia', 'Reanimated', 'three.js', 'Blender'],
    repo: 'https://github.com/novahoangdev/soap-bubbles',
  },
  {
    slug: 'interactive-workspace',
    title: 'Interactive Workspace',
    description:
      'An interactive 3D WebGL portfolio: explore my desk setup from different camera angles, open the CV, and drive a kart around the circuit.',
    tags: ['React', 'three.js', 'WebGL', 'TypeScript', 'Vite'],
    repo: 'https://github.com/novahoangdev/interactive-workspace',
    live: 'https://interactive-workspace-nova.web.app',
  },
  {
    slug: 'neon-sign',
    title: 'Neon Sign',
    description:
      'Draw your own neon sign on a rainy alley wall. Strokes freeze into glass tubes; flip the switch and coloured light flickers across every brick, the mortar and the puddle, lit in real time with Skia shaders over a wall rendered in Blender.',
    tags: ['Expo', 'React Native', 'Skia', 'Reanimated', 'Blender'],
    repo: 'https://github.com/novahoangdev/neon-sign',
  },
  {
    slug: 'mac-dev-setup',
    title: 'Mac Dev Setup',
    description:
      'An Apple Silicon Mac setup for vibe coding with many AI agents: one Brewfile, a bilingual step-by-step guide, and scripts to back up and restore macOS settings.',
    tags: ['Homebrew', 'Shell', 'Claude Code', 'Firebase Hosting'],
    repo: 'https://github.com/novahoangdev/mac-dev-setup',
    live: 'https://setup-dev-mac.web.app',
  },
  {
    slug: 'pumpkin-carve',
    title: 'Pumpkin Carve',
    description:
      'A Halloween demo: carve a jack-o’-lantern with your finger, drop a match into its mouth, and watch the candlelight shine through exactly the face you carved, rendered in real time with Skia shaders.',
    tags: ['Expo', 'React Native', 'Skia', 'Reanimated', 'Blender'],
    repo: 'https://github.com/novahoangdev/pumpkin-carve',
  },
  {
    slug: 'dev-workspace',
    title: 'Dev Workspace',
    description:
      'My development workspace for projects, shared context and AI-assisted coding: one AGENTS.md rule set and shared skills used by Claude Code, Codex and GitHub Copilot.',
    tags: ['AI agents', 'Claude Code', 'Codex', 'Shell'],
    repo: 'https://github.com/novahoangdev/dev-workspace',
  },
  {
    slug: 'saiyan-awakening',
    title: 'Saiyan Awakening',
    description:
      'A just-for-fun iPhone cinematic: hold to charge your Ki, then chibi Goku goes Super Saiyan, dodges Frieza’s Death Beam and fires a Kamehameha. The 3D is pre-rendered in Blender; aura, lightning, beams and explosions are drawn live with Skia shaders.',
    tags: ['Expo', 'React Native', 'Skia', 'Reanimated', 'Blender'],
    repo: 'https://github.com/novahoangdev/goku-vs-frieza',
  },
];
