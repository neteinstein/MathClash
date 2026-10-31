export interface PlayerColor {
  name: string;
  main: string;
  dark: string;
  light: string;
}

export const COLORS: PlayerColor[] = [
  { name: 'Azul', main: '#3b82f6', dark: '#1e40af', light: '#93c5fd' },
  { name: 'Vermelho', main: '#ef4444', dark: '#991b1b', light: '#fca5a5' },
  { name: 'Verde', main: '#22c55e', dark: '#166534', light: '#86efac' },
  { name: 'Amarelo', main: '#facc15', dark: '#a16207', light: '#fef08a' },
  { name: 'Roxo', main: '#a855f7', dark: '#6b21a8', light: '#d8b4fe' },
  { name: 'Laranja', main: '#f97316', dark: '#9a3412', light: '#fdba74' },
  { name: 'Rosa', main: '#ec4899', dark: '#9d174d', light: '#f9a8d4' },
  { name: 'Ciano', main: '#06b6d4', dark: '#155e75', light: '#67e8f9' },
];

export function applyColorVars(el: HTMLElement, c: PlayerColor): void {
  el.style.setProperty('--c', c.main);
  el.style.setProperty('--cd', c.dark);
  el.style.setProperty('--cl', c.light);
}
