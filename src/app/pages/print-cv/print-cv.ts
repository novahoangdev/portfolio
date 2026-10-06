import { ButtonHover } from '../../directives/button-hover';
import {
  Component,
  HostListener,
  PLATFORM_ID,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { contact, education, experiences, profile, skillGroups } from '../../data/profile';

type Market = 'vietnam' | 'international';

@Component({
  selector: 'app-print-cv',
  imports: [ButtonHover, RouterLink],
  templateUrl: './print-cv.html',
  styleUrl: './print-cv.css',
})
export class PrintCv {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly contact = contact;
  protected readonly education = education;
  protected readonly experiences = experiences;
  protected readonly profile = profile;
  protected readonly skillGroups = skillGroups;

  protected readonly market = signal<Market>(
    this.route.snapshot.paramMap.get('market') === 'international'
      ? 'international'
      : 'vietnam'
  );

  protected readonly previewScale = signal<number>(1);
  protected readonly isMobile = signal<boolean>(false);

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.market.set(params.get('market') === 'international' ? 'international' : 'vietnam');
    });
    afterNextRender(() => {
      this.updateScale();
    });
  }

  @HostListener('window:resize')
  protected onResize(): void {
    this.updateScale();
  }

  private updateScale(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const winWidth = window.innerWidth;
    // 210mm at standard 96 DPI is approx 793.7px (794px)
    const a4BaseWidth = 794;

    if (winWidth < 840) {
      this.isMobile.set(true);
      const padding = winWidth < 480 ? 20 : 32;
      const availableWidth = Math.max(260, winWidth - padding);
      const scale = Math.min(1, Math.round((availableWidth / a4BaseWidth) * 1000) / 1000);
      this.previewScale.set(scale);
    } else {
      this.isMobile.set(false);
      this.previewScale.set(1);
    }
  }

  protected setMarket(m: Market): void {
    void this.router.navigate(['/print', m], { replaceUrl: true });
  }

  protected handleTabKey(event: KeyboardEvent): void {
    let market: Market;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        market = this.market() === 'vietnam' ? 'international' : 'vietnam';
        break;
      case 'Home':
        market = 'vietnam';
        break;
      case 'End':
        market = 'international';
        break;
      default:
        return;
    }
    event.preventDefault();
    this.setMarket(market);
    document.getElementById(`print-tab-${market}`)?.focus();
  }

  protected triggerPrint(): void {
    window.print();
  }

  protected onDownloadPdf(event: MouseEvent): void {
    event.preventDefault();
    const isVn = this.market() === 'vietnam';
    const fileUrl = isVn
      ? '/documents/hoang-van-hoa-cv-vietnam.pdf'
      : '/documents/nova-hoang-cv-international.pdf';
    const fileName = isVn
      ? 'hoang-van-hoa-cv-vietnam.pdf'
      : 'nova-hoang-cv-international.pdf';

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
        window.open(fileUrl, '_blank');
      });
  }

  protected projectSeparator(index: number, total: number): string {
    if (index !== total - 2) {
      return ', ';
    }
    return total === 2 ? ' and ' : ', and ';
  }
}
