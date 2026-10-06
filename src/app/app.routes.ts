import { Routes } from '@angular/router';
import { Home } from './pages/home/home';

export const routes: Routes = [
  {
    path: '',
    component: Home,
    title: 'Resume — Nova Hoang',
  },
  {
    path: 'about',
    loadComponent: () => import('./pages/about/about').then((component) => component.About),
    title: 'About — Nova Hoang',
  },
  {
    path: 'print/:market',
    loadComponent: () => import('./pages/print-cv/print-cv').then((component) => component.PrintCv),
    title: (route) => route.paramMap.get('market') === 'international'
      ? 'International CV — Nova Hoang'
      : 'Vietnam CV — Nova Hoang',
  },
  { path: '**', redirectTo: '' },
];
