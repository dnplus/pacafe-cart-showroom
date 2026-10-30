export const sheetFormats = {
  four: { width: 2048, height: 1024, cell: 256, cols: 8, rows: 4, facings: ['S', 'W', 'N', 'E'], maxBytes: 3 * 1024 * 1024, seated: false },
  eight: { width: 1024, height: 1664, cell: 128, cols: 8, rows: 13, facings: ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE'], maxBytes: 2 * 1024 * 1024, seated: false },
} as const;
export type SheetFormat = keyof typeof sheetFormats;
export const SHEET_MAX_BYTES = Math.max(...Object.values(sheetFormats).map(format => format.maxBytes));

export function sheetFormatOf(width: number, height: number): SheetFormat | null {
  for (const [name, format] of Object.entries(sheetFormats)) if (format.width === width && format.height === height) return name as SheetFormat;
  return null;
}
