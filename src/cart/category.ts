import { Apple, BookOpen, CookingPot, Gamepad2, Mountain, Package, Shirt, Smartphone, Sofa, Sparkles, type LucideIcon } from 'lucide-react';
import type { CartCategory } from '../../shared/cart';

const kinds: Record<CartCategory, { icon: LucideIcon; hue: number }> = {
  fashion: { icon: Shirt, hue: 18 },
  beauty: { icon: Sparkles, hue: 340 },
  electronics: { icon: Smartphone, hue: 215 },
  home: { icon: Sofa, hue: 38 },
  kitchen: { icon: CookingPot, hue: 8 },
  food: { icon: Apple, hue: 95 },
  books: { icon: BookOpen, hue: 262 },
  hobby: { icon: Gamepad2, hue: 285 },
  outdoor: { icon: Mountain, hue: 165 },
  other: { icon: Package, hue: 45 },
};

export const categoryIcon = (category: CartCategory | null): LucideIcon => kinds[category ?? 'other'].icon;
export const categoryHue = (category: CartCategory | null) => kinds[category ?? 'other'].hue;
