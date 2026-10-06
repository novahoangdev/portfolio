import { ButtonHover } from './directives/button-hover';
import { Component, HostListener, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { contact } from './data/profile';
import { DOCUMENT } from '@angular/common';
import { Meta } from '@angular/platform-browser';
import pages from './data/page-metadata.json';

type Theme = 'light' | 'dark';

@Component({
  selector: 'app-root',
  imports: [ButtonHover, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly meta = inject(Meta);
  protected readonly contact = contact;
  protected readonly theme = signal<Theme>(this.initialTheme());
  protected readonly headerHidden = signal<boolean>(false);

  private lastScrollY = 0;
  private scrollThreshold = 10;

  constructor() {
    effect(() => {
      const theme = this.theme();
      document.documentElement.dataset['theme'] = theme;
      try {
        localStorage.setItem('portfolio-theme', theme);
      } catch {
        // Theme switching still works when browser storage is unavailable.
      }
    });

    // Reset header state on navigation
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.updateMetadata(event.urlAfterRedirects);
        this.headerHidden.set(false);
        this.lastScrollY = 0;
      }
    });
  }

  private updateMetadata(url: string): void {
    const path = url.split(/[?#]/)[0].replace(/\/$/, '') || '/';
    const page = pages[path as keyof typeof pages] ?? pages['/'];
    const canonical = `https://novahoangdev.web.app${path}`;
    this.document.querySelector('link[rel="canonical"]')?.setAttribute('href', canonical);
    this.meta.updateTag({ name: 'description', content: page.description });
    this.meta.updateTag({ name: 'robots', content: page.robots });
    this.meta.updateTag({ property: 'og:url', content: canonical });
    this.meta.updateTag({ property: 'og:title', content: page.title });
    this.meta.updateTag({ property: 'og:description', content: page.description });
    this.meta.updateTag({ name: 'twitter:title', content: page.title });
    this.meta.updateTag({ name: 'twitter:description', content: page.description });
  }

  @HostListener('window:scroll', [])
  protected onWindowScroll(): void {
    if (typeof window === 'undefined') return;

    const currentScrollY = Math.max(0, window.scrollY || document.documentElement.scrollTop);
    const diff = currentScrollY - this.lastScrollY;

    // At or near very top, always show header
    if (currentScrollY <= 40) {
      this.headerHidden.set(false);
      this.lastScrollY = currentScrollY;
      return;
    }

    // Ignore tiny scroll jitters (momentum bounces)
    if (Math.abs(diff) < this.scrollThreshold) {
      return;
    }

    // Scrolling down -> hide header on mobile to maximize CV reading area
    // Scrolling up -> reveal header immediately
    if (diff > 0 && currentScrollY > 70) {
      this.headerHidden.set(true);
    } else if (diff < 0) {
      this.headerHidden.set(false);
    }

    this.lastScrollY = currentScrollY;
  }

  protected get printView(): boolean {
    return this.router.url.startsWith('/print/');
  }

  protected toggleTheme(): void {
    this.theme.update((theme) => (theme === 'light' ? 'dark' : 'light'));
  }

  private initialTheme(): Theme {
    try {
      const saved = localStorage.getItem('portfolio-theme');
      if (saved === 'light' || saved === 'dark') {
        return saved;
      }
    } catch {
      // Fall back to the default theme when browser storage is unavailable.
    }
    return 'light';
  }
}
