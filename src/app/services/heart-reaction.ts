import { Injectable, signal } from '@angular/core';

export interface FloatingHeart {
  id: number;
  x: number;
  y: number;
  size: number;
  rotation: number;
  duration: number;
}

export interface BurstHeart {
  id: number;
  char: string;
  tx: number;
  ty: number;
  rot: number;
  scale: number;
  color: string;
  delay: number;
}

export interface HireToastData {
  visible: boolean;
  message: string;
  subtext: string;
}

@Injectable({
  providedIn: 'root',
})
export class HeartReactionService {
  public readonly heartCount = signal<number>(0);
  public readonly floatingHearts = signal<FloatingHeart[]>([]);
  public readonly celebrationHearts = signal<BurstHeart[]>([]);
  public readonly showCelebration = signal<boolean>(false);
  public readonly hireToast = signal<HireToastData>({
    visible: false,
    message: '',
    subtext: '',
  });

  private nextHeartId = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private celebrationTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly toastDuration = 8000;
  private toastStartTime = 0;
  private toastRemainingTime = 8000;
  private isToastHovered = false;

  public triggerHeart(event: MouseEvent | Event): void {
    const count = this.heartCount() + 1;
    this.heartCount.set(count);

    // Calculate click or touch coordinates inside avatar frame
    let x = 100;
    let y = 120;
    if (typeof window !== 'undefined' && 'touches' in event && (event as TouchEvent).touches && (event as TouchEvent).touches.length > 0) {
      const touch = (event as TouchEvent).touches[0];
      const target = event.currentTarget as HTMLElement | null;
      if (target) {
        const rect = target.getBoundingClientRect();
        x = touch.clientX - rect.left;
        y = touch.clientY - rect.top;
      }
    } else if (event instanceof MouseEvent && (event.clientX !== 0 || event.clientY !== 0)) {
      const target = event.currentTarget as HTMLElement | null;
      if (target) {
        const rect = target.getBoundingClientRect();
        x = event.clientX - rect.left;
        y = event.clientY - rect.top;
      }
    }

    // Spawn floating heart on click
    const heartId = ++this.nextHeartId;
    const newHeart: FloatingHeart = {
      id: heartId,
      x: x + (Math.random() * 24 - 12),
      y: y + (Math.random() * 10 - 5),
      size: 1.2 + Math.random() * 0.7,
      rotation: Math.random() * 40 - 20,
      duration: 900 + Math.random() * 300,
    };

    this.floatingHearts.update((hearts) => [...hearts.slice(-12), newHeart]);

    // Clean up single floating heart
    setTimeout(() => {
      this.floatingHearts.update((hearts) => hearts.filter((h) => h.id !== heartId));
    }, 1300);

    // Check for fireworks burst trigger on every 2 clicks (2, 4, 6, 8, ...)
    if (count % 2 === 0) {
      this.triggerFireworksBurst(count);
    }

    // Check for Toast Banner message: show at initial 2 clicks, and then on every 5 clicks (5, 10, 15, 20, 25, 30, ...)
    if (count === 2 || count % 5 === 0) {
      this.triggerHireToast(count);
    }
  }

  private triggerFireworksBurst(count: number): void {
    const heartChars = ['❤️', '💖', '💻', '✨', '⚡', '🚀', '🔥', '🥰', '⭐', '👨‍💻', '💕', '👾'];
    const colors = ['#2f7e7c', '#78bbb5', '#8accc6', '#38bdf8', '#fb7185', '#f43f5e', '#a855f7', '#fbbf24'];

    const bursts: BurstHeart[] = [];
    const countParticles = count >= 30 ? 48 : 32;

    for (let i = 0; i < countParticles; i++) {
      const angle = (Math.PI * 2 * i) / countParticles + (Math.random() * 0.4 - 0.2);
      const distance = (count >= 30 ? 140 : 100) + Math.random() * (count >= 30 ? 200 : 160);
      const tx = Math.cos(angle) * distance;
      const ty = Math.sin(angle) * distance - (35 + Math.random() * 55);

      bursts.push({
        id: ++this.nextHeartId,
        char: heartChars[Math.floor(Math.random() * heartChars.length)],
        tx: Math.round(tx),
        ty: Math.round(ty),
        rot: Math.round(Math.random() * 90 - 45),
        scale: 0.85 + Math.random() * 1.15,
        color: colors[Math.floor(Math.random() * colors.length)],
        delay: Math.round(Math.random() * 160),
      });
    }

    this.celebrationHearts.set(bursts);
    this.showCelebration.set(true);

    if (this.celebrationTimer) clearTimeout(this.celebrationTimer);
    this.celebrationTimer = setTimeout(() => {
      this.showCelebration.set(false);
      this.celebrationHearts.set([]);
    }, 2800);
  }

  private triggerHireToast(count: number): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);

    let message = '';
    let subtext = '';

    if (count === 2) {
      message = 'Enjoying my portfolio? Let’s make it official — Hire me! 😉';
      subtext = '2 hearts sent! Open for Senior Frontend Engineering & Technical Leadership.';
    } else if (count === 5) {
      message = 'Crushing on my work? Let’s make it official — Hire me! 😉';
      subtext = '5 hearts received! Open for senior frontend & technical leadership.';
    } else if (count === 10) {
      message = '10 hearts already? That’s genuine love for clean architecture! 💻✨';
      subtext = 'Let’s turn this chemistry into production-grade code. Reach out!';
    } else if (count === 15) {
      message = 'Hold on... you clicked 15 times! Are we starting sprint planning yet? 🚀';
      subtext = 'Ready to boost your frontend engineering team anytime.';
    } else if (count === 20) {
      message = '20 hearts?! You definitely need a Senior Frontend Engineer on your team! 🔥';
      subtext = 'TypeScript, Angular, React, Architecture & High-perf web apps ready to deploy.';
    } else if (count === 25) {
      message = 'Warning: Heart overflow detected! 🤯 (25 hearts & counting)';
      subtext = 'Your mouse deserves a break — let’s jump straight on an intro call!';
    } else if (count === 30) {
      message = '🚨 MAXIMUM LEVEL ADMIRATION UNLOCKED! 🏆💻👑';
      subtext = `You gave ${count} hearts! At this point, sending a contract is mandatory 😉`;
    } else if (count === 50) {
      message = '🎉 50 HEARTS LEGEND! You just broke the Easter Egg record! 🚀💎';
      subtext = 'Coffee is on me if we work together. Let’s talk!';
    } else {
      const milestoneLevel = Math.floor(count / 5);
      const highTierQuotes = [
        `Level ${milestoneLevel} fan detected! Your dedication is higher than my test coverage! 💯`,
        `Still clicking (${count} hearts)? We are basically best coworkers already! ☕`,
        `${count} clicks! If only fixing CSS bugs was this fun and satisfying! 😂`,
        `Achievement Unlocked: "${count} Hearts Super-Recruiter". Let’s build the future! 🌟`,
      ];
      message = highTierQuotes[(milestoneLevel - 7) % highTierQuotes.length];
      subtext = `${count} hearts sent. Let’s create amazing digital experiences together!`;
    }

    this.toastRemainingTime = this.toastDuration;
    this.toastStartTime = Date.now();
    this.isToastHovered = false;

    this.hireToast.set({
      visible: true,
      message,
      subtext,
    });

    this.toastTimer = setTimeout(() => {
      this.dismissToast();
    }, this.toastRemainingTime);
  }

  public onToastMouseEnter(): void {
    this.isToastHovered = true;
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    const elapsed = Date.now() - this.toastStartTime;
    this.toastRemainingTime = Math.max(1200, this.toastRemainingTime - elapsed);
  }

  public onToastMouseLeave(): void {
    if (!this.isToastHovered || !this.hireToast().visible) return;
    this.isToastHovered = false;
    this.toastStartTime = Date.now();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.dismissToast();
    }, this.toastRemainingTime);
  }

  public dismissToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.isToastHovered = false;
    this.hireToast.set({ visible: false, message: '', subtext: '' });
  }

  public resetOnDestroy(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (this.celebrationTimer) clearTimeout(this.celebrationTimer);
  }
}
