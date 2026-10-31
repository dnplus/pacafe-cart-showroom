import { Apple, BookOpen, CookingPot, Gamepad2, Mountain, Package, Shirt, Smartphone, Sofa, Sparkles, type LucideIcon } from 'lucide-react';
import type { CartCategory } from '../../shared/cart';
import { t } from '../i18n';
import type { TextKey } from '../i18n/messages';

const kinds: Record<CartCategory, { label: TextKey; icon: LucideIcon; hue: number }> = {
  fashion: { label: 'Fashion', icon: Shirt, hue: 18 },
  beauty: { label: 'Beauty', icon: Sparkles, hue: 340 },
  electronics: { label: 'Electronics', icon: Smartphone, hue: 215 },
  home: { label: 'Home', icon: Sofa, hue: 38 },
  kitchen: { label: 'Kitchen', icon: CookingPot, hue: 8 },
  food: { label: 'Food and drink', icon: Apple, hue: 95 },
  books: { label: 'Books and stationery', icon: BookOpen, hue: 262 },
  hobby: { label: 'Toys and hobbies', icon: Gamepad2, hue: 285 },
  outdoor: { label: 'Sports and outdoor', icon: Mountain, hue: 165 },
  other: { label: 'Other', icon: Package, hue: 45 },
};

export const categoryLabel = (category: CartCategory) => t(kinds[category].label);
export const categoryIcon = (category: CartCategory | null): LucideIcon => kinds[category ?? 'other'].icon;
export const categoryHue = (category: CartCategory | null) => kinds[category ?? 'other'].hue;
