import { ButtonHover } from '../../directives/button-hover';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Reveal } from '../../directives/reveal';
import { contact, profile, skillGroups } from '../../data/profile';
import { HeartReactionService } from '../../services/heart-reaction';

@Component({
  selector: 'app-about',
  imports: [ButtonHover, RouterLink, Reveal],
  templateUrl: './about.html',
  styleUrl: './about.css',
})
export class About {
  protected readonly contact = contact;
  protected readonly profile = profile;
  protected readonly skillGroups = skillGroups;
  protected readonly heartService = inject(HeartReactionService);

  protected readonly heartCount = this.heartService.heartCount;
  protected readonly floatingHearts = this.heartService.floatingHearts;
  protected readonly celebrationHearts = this.heartService.celebrationHearts;
  protected readonly showCelebration = this.heartService.showCelebration;
  protected readonly hireToast = this.heartService.hireToast;

  protected onAvatarClick(event: MouseEvent | Event): void {
    this.heartService.triggerHeart(event);
  }

  protected onToastMouseEnter(): void {
    this.heartService.onToastMouseEnter();
  }

  protected onToastMouseLeave(): void {
    this.heartService.onToastMouseLeave();
  }

  protected dismissToast(): void {
    this.heartService.dismissToast();
  }
}

