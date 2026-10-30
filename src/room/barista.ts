import type { BaristaAppearance, Character } from '../../shared/domain';
import { baristaCell, baristaDuration, type BaristaAction } from '../../shared/barista-sprites';
import { residentArt } from './residentArt';
import type { Look } from './looks';

interface BaristaArt { label: string; portrait: string; standee: string; service?: string }
interface DeliveryPoint { x: number; y: number; z: number }
export function baristaDeliveryTarget(surfaces: readonly DeliveryPoint[], from: DeliveryPoint, resultSlot?: number): DeliveryPoint | null {
  const target = (resultSlot === undefined ? undefined : surfaces[resultSlot]) ?? [...surfaces].sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0];
  return target ? { x: target.x, y: target.y, z: target.z } : null;
}
export const baristaArt: Readonly<Record<Character, BaristaArt>> = {
  gpt: { label: residentArt.gpt.label, portrait: residentArt.gpt.portrait, standee: residentArt.gpt.standee, service: '/art/barista/dots-service.png' },
  grok: { label: residentArt.grok.label, portrait: residentArt.grok.portrait, standee: residentArt.grok.standee },
  gemini: { label: residentArt.gemini.label, portrait: residentArt.gemini.portrait, standee: residentArt.gemini.standee },
  claude: { label: residentArt.claude.label, portrait: residentArt.claude.portrait, standee: residentArt.claude.standee },
};

export function baristaFaces(character: Character, appearance?: BaristaAppearance): Look[] {
  const art = baristaArt[character];
  return [...(appearance?.portrait ? [{ kind: 'portrait' as const, src: `/media/${appearance.portrait.key}` }] : []), { kind: 'portrait', src: art.portrait }, { kind: 'standee', src: art.standee }];
}
export function baristaGuestLooks(character: Character, appearance?: BaristaAppearance): Look[] {
  return [
    ...(appearance?.locomotion ? [{ kind: 'sheet' as const, src: `/media/${appearance.locomotion.key}` }] : []),
    ...(appearance?.standee ? [{ kind: 'standee' as const, src: `/media/${appearance.standee.key}` }] : []),
    { kind: 'standee', src: baristaArt[character].standee },
  ];
}

interface BaristaBody { kind: 'sheet' | 'standee' | 'locomotion'; src: string; anchored: boolean }
export function baristaBodies(character: Character, appearance?: BaristaAppearance, roaming = false): BaristaBody[] {
  const art = baristaArt[character];
  return [
    ...(roaming && appearance?.locomotion ? [{ kind: 'locomotion' as const, src: `/media/${appearance.locomotion.key}`, anchored: false }] : []),
    ...(appearance?.sheet ? [{ kind: 'sheet' as const, src: `/media/${appearance.sheet.key}`, anchored: false }] : []),
    ...(appearance?.standee ? [{ kind: 'standee' as const, src: `/media/${appearance.standee.key}`, anchored: false }] : []),
    ...(art.service ? [{ kind: 'sheet' as const, src: art.service, anchored: true }] : []),
    { kind: 'standee', src: art.standee, anchored: false },
  ];
}

export class BaristaSequence {
  private active: { action: BaristaAction; since: number; key: number } | null = null;
  private queued: BaristaAction[] = [];
  private key = 0;
  /** When the last action ended; the idle loop counts from here and settles, so a room loaded idle starts still. */
  private idleSince = -Infinity;
  cue(action: Exclude<BaristaAction, 'idle'>, now: number) {
    if (action === 'wipe') { this.queued = []; this.active = { action, since: now, key: ++this.key }; return; }
    if (!this.active) this.active = { action, since: now, key: ++this.key };
    else if (this.active.action !== action && !this.queued.includes(action) && this.queued.length < 4) this.queued.push(action);
  }
  deliveryPending() { return this.active?.action === 'brew' || this.active?.action === 'serve' || this.queued.some(action => action === 'brew' || action === 'serve'); }
  frame(now: number, calm = false) {
    while (this.active && now - this.active.since >= baristaDuration(this.active.action)) {
      const since = this.active.since + baristaDuration(this.active.action), action = this.queued.shift();
      this.active = action ? { action, since, key: ++this.key } : null;
      if (!this.active) this.idleSince = since;
    }
    const action = this.active?.action ?? 'idle';
    return { action, key: this.active?.key ?? 0, since: this.active?.since ?? 0, ...baristaCell(action, now - (this.active?.since ?? this.idleSince), calm) };
  }
}
