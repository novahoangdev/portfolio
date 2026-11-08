import { describe, expect, it } from 'vitest';
import { sideProjects } from './projects';

describe('sideProjects', () => {
  it('has unique slugs', () => {
    const slugs = sideProjects.map((project) => project.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('links to HTTPS repos and live sites', () => {
    for (const project of sideProjects) {
      expect(project.repo).toMatch(/^https:\/\/github\.com\/novahoangdev\//);
      if (project.live) expect(project.live).toMatch(/^https:\/\//);
    }
  });
});
