import { useEffect } from 'react';
import type { Clinic } from './types';

// Convert a hex color (#rrggbb) to an HSL string for CSS variables.
function hexToHsl(hex: string): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return '199 89% 48%'; // fallback sky-500
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hue = 0;
  let sat = 0;
  const light = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = light > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = (g - b) / d + (g < b ? 6 : 0); break;
      case g: hue = (b - r) / d + 2; break;
      case b: hue = (r - g) / d + 4; break;
    }
    hue /= 6;
  }
  return `${Math.round(hue * 360)} ${Math.round(sat * 100)}% ${Math.round(light * 100)}%`;
}

export function useClinicTheme(clinic: Pick<Clinic, 'primary_color'> | null | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    if (clinic?.primary_color) {
      root.style.setProperty('--brand', hexToHsl(clinic.primary_color));
    } else {
      root.style.setProperty('--brand', '199 89% 48%');
    }
  }, [clinic?.primary_color]);
}
