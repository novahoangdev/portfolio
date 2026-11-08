import { Routes } from '@angular/router';
import { Home } from './pages/home/home';

export const routes: Routes = [
  {
    path: '',
    component: Home,
    title: 'Nova Hoang (Hoàng Văn Hòa) — Senior Frontend Developer',
  },
  // About now lives below the CV on the home page.
  { path: 'about', redirectTo: '' },
  {
    path: 'print/:market',
    loadComponent: () => import('./pages/print-cv/print-cv').then((component) => component.PrintCv),
    title: (route) => route.paramMap.get('market') === 'international'
      ? 'International CV — Nova Hoang'
      : 'Vietnam CV — Nova Hoang',
  },
  { path: '**', redirectTo: '' },
];
