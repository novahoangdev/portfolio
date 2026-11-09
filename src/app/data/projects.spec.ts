import { describe, expect, it } from 'vitest';
import { sideProjects } from './projects';

describe('sideProjects', () => {
  it('has unique names', () => {
    const names = sideProjects.map((project) => project.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('links to HTTPS repos and live sites', () => {
    for (const project of sideProjects) {
      if (project.repoUrl) expect(project.repoUrl).toMatch(/^https:\/\/github\.com\/novahoangdev\//);
      if (project.liveUrl) expect(project.liveUrl).toMatch(/^https:\/\//);
    }
  });
});
