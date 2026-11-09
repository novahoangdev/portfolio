import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ProjectMedia, SideProject } from '../../data/projects';
import { PlayInView } from '../../directives/play-in-view';

/**
 * A project's demo media: one video (or image), or a main demo with a phone
 * demo floating over its corner. `play` = 'in-view' plays while on screen;
 * 'on' / 'off' let a layout drive playback (e.g. only the front card plays).
 */
@Component({
  selector: 'app-project-media',
  imports: [PlayInView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'project-media',
    '[class.has-phone]': 'items().length > 1',
    '[style.--accent]': 'project().accent',
  },
  template: `
    @for (media of items(); track media.image; let i = $index) {
      <span class="pm" [class.pm-main]="i === 0" [class.pm-phone]="i > 0">
        @if (media.video) {
          @if (play() === 'in-view') {
            <video
              appPlayInView
              [src]="media.video"
              [poster]="media.image"
              [attr.aria-label]="labelled() ? media.alt : null"
              [attr.aria-hidden]="labelled() ? null : 'true'"
              muted
              loop
              playsinline
              preload="none"
              disablepictureinpicture
              tabindex="-1"
            ></video>
          } @else {
            <video
              [src]="media.video"
              [poster]="media.image"
              [attr.aria-label]="labelled() ? media.alt : null"
              [attr.aria-hidden]="labelled() ? null : 'true'"
              muted
              loop
              playsinline
              preload="none"
              disablepictureinpicture
              tabindex="-1"
            ></video>
          }
        } @else {
          <img [src]="media.image" [alt]="labelled() ? media.alt : ''" loading="lazy" decoding="async" />
        }
        @if (labelled() && media.label) {
          <span class="pm-label">{{ media.label }}</span>
        }
      </span>
    }
  `,
  styleUrl: './project-media.css',
})
export class ProjectMediaView {
  readonly project = input.required<SideProject>();
  readonly play = input<'in-view' | 'on' | 'off'>('in-view');
  /** Expose alt text / labels (case view) or stay decorative (tiles). */
  readonly labelled = input(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly reduced =
    inject(DOCUMENT).defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;

  protected items(): readonly ProjectMedia[] {
    const project = this.project();
    return [project.media, ...(project.extraMedia ?? [])];
  }

  constructor() {
    effect(() => {
      const mode = this.play();
      if (mode === 'in-view') return;
      // Wait for the template to render the <video> elements.
      queueMicrotask(() => {
        this.host.querySelectorAll('video').forEach((video) => {
          if (mode === 'on' && !this.reduced) {
            video.muted = true;
            video.play().catch(() => {
              // Autoplay can be blocked (e.g. Low Power Mode); the poster stays visible.
            });
          } else {
            video.pause();
          }
        });
      });
    });
  }
}
