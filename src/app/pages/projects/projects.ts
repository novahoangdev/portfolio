import { Component } from '@angular/core';
import { ProjectMedia, SideProject, sideProjects } from '../../data/projects';
import { contact } from '../../data/profile';
import { PlayInView } from '../../directives/play-in-view';
import { Reveal } from '../../directives/reveal';

/** Side projects rendered below the CV on the single portfolio page. */
@Component({
  selector: 'app-projects',
  imports: [PlayInView, Reveal],
  templateUrl: './projects.html',
  styleUrl: './projects.css',
})
export class Projects {
  protected readonly projects = sideProjects;
  protected readonly githubUrl = contact.github;

  protected mediaOf(project: SideProject): readonly ProjectMedia[] {
    return [project.media, ...(project.extraMedia ?? [])];
  }
}
