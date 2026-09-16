import { Component, HostListener, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { contact } from './data/profile';

type Theme = 'light' | 'dark';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly router = inject(Router);
  protected readonly contact = contact;
  protected readonly theme = signal<Theme>(this.initialTheme());
  protected readonly headerHidden = signal<boolean>(false);

  private lastScrollY = 0;
  private scrollThreshold = 10;

  constructor() {
    effect(() => {
      const theme = this.theme();
      document.documentElement.dataset['theme'] = theme;
      localStorage.setItem('portfolio-theme', theme);
    });

    // Reset header state on navigation
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.headerHidden.set(false);
        this.lastScrollY = 0;
      }
    });
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
    const saved = localStorage.getItem('portfolio-theme');
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    return 'light';
  }
}
