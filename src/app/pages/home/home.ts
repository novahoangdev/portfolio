import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { contact, education, experiences, profile, skillGroups } from '../../data/profile';
import { HeartReactionService } from '../../services/heart-reaction';

type Market = 'vietnam' | 'international';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  protected readonly contact = contact;
  protected readonly education = education;
  protected readonly experiences = experiences;
  protected readonly profile = profile;
  protected readonly skillGroups = skillGroups;
  protected readonly market = signal<Market>('vietnam');
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

  protected selectMarket(market: Market): void {
    this.market.set(market);
  }

  protected projectSeparator(index: number, total: number): string {
    if (index !== total - 2) {
      return ', ';
    }
    return total === 2 ? ' and ' : ', and ';
  }

  protected handleTabKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    this.market.update((market) => (market === 'vietnam' ? 'international' : 'vietnam'));
    const targetId = this.market() === 'vietnam' ? 'tab-vietnam' : 'tab-international';
    document.getElementById(targetId)?.focus();
  }

  protected onDownloadPdf(event: MouseEvent): void {
    const isVn = this.market() === 'vietnam';
    const fileUrl = isVn
      ? '/documents/hoang-van-hoa-cv-vietnam.pdf'
      : '/documents/nova-hoang-cv-international.pdf';
    const fileName = isVn
      ? 'hoang-van-hoa-cv-vietnam.pdf'
      : 'nova-hoang-cv-international.pdf';

    // Fetch and trigger blob download to bypass iframe download restrictions and ensure clean binary transfer
    fetch(fileUrl)
      .then((res) => {
        if (!res.ok) throw new Error('File download failed');
        return res.blob();
      })
      .then((blob) => {
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(pdfBlob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(blobUrl);
        }, 2000);
      })
      .catch(() => {
        // Fallback: open directly in a new tab if blob download is blocked
        window.open(fileUrl, '_blank');
      });
  }
}

