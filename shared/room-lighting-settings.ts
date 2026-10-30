import { z } from 'zod';

export const defaultRoomBrightness = 1;
export const minRoomBrightness = 0.55;
export const maxRoomBrightness = 1.45;
export const roomBrightnessStep = 0.05;
export const roomBrightnessPresets = [
  { label: 'Dim', value: 0.65 },
  { label: 'Soft', value: 1 },
  { label: 'Bright', value: 1.35 },
] as const;
export const roomBrightnessSchema = z.number().finite().min(minRoomBrightness).max(maxRoomBrightness);
