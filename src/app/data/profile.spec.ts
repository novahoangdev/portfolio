import { describe, expect, it } from 'vitest';
import { contact, education, experiences, profile } from './profile';

describe('profile data', () => {
  it('keeps the current role first in reverse chronological order', () => {
    expect(experiences[0].company).toBe('SJ Group');
    expect(experiences[0].companyUrl).toBe('https://www.sjgroup.com/');
    expect(experiences[0].dates).toContain('Present');
    expect(experiences[0].projects).toHaveLength(2);
    expect(experiences.at(-1)?.company).toBe('YOONG Vietnam');
    expect(experiences.every((experience) => Boolean(experience.companyUrl))).toBe(true);
    expect(experiences.every((experience) => Boolean(experience.projects?.length))).toBe(true);
  });

  it('contains both market identities and public contact details', () => {
    expect(profile.vietnameseName).toBe('Hoàng Văn Hòa');
    expect(profile.internationalName).toContain('Nova Hoang');
    expect(contact.email).toMatch(/@/);
    expect(contact.phoneHref).toMatch(/^\+84/);
    expect(contact.location).toBe('Ho Chi Minh City, Vietnam');
  });

  it('contains the approved education history', () => {
    expect(education).toHaveLength(2);
    expect(education[0].dates).toBe('2017 — 2019');
  });
});
