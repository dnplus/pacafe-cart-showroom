export function jsonOrNull(text: string): unknown {
  try { return JSON.parse(text); } catch (error) { if (error instanceof SyntaxError) return null; throw error; }
}
export function atobOrNull(text: string): string | null {
  try { return atob(text); } catch (error) { if (error instanceof Error && error.name === 'InvalidCharacterError') return null; throw error; }
}
export function base64BytesOrNull(text: string): Uint8Array<ArrayBuffer> | null {
  const binary = atobOrNull(text);
  return binary === null ? null : Uint8Array.from(binary, c => c.charCodeAt(0));
}
