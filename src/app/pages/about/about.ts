import { ButtonHover } from '../../directives/button-hover';
import { Component, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Reveal } from '../../directives/reveal';
import { contact, profile } from '../../data/profile';

/** About content rendered below the CV on the single portfolio page. */
@Component({
  selector: 'app-about',
  imports: [ButtonHover, Reveal],
  templateUrl: './about.html',
  styleUrl: './about.css',
})
export class About {
  private readonly document = inject(DOCUMENT);
  protected readonly contact = contact;
  protected readonly profile = profile;

  protected scrollToResume(): void {
    this.document.getElementById('cv')?.scrollIntoView({ block: 'start' });
  }
}
