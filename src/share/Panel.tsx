import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { t } from '../i18n';
import './share.css';

const HANDS_ON = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * The owner's side panels: a titled section with a close button. `name` gives the ids and test id (`{name}-panel`, `{name}-title`).
 * It opens below the list, so it scrolls itself into the HUD's view as it appears, and again as loaded content grows it, until the owner scrolls or taps.
 */
export function Panel({ name, className, title, busy, status, close, children }: { name: string; className?: string; title: ReactNode; busy?: boolean; /** Mirrored to `data-status` for styling. */ status?: string; close: () => void; children: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const panel = root.current, hud = panel?.closest('.cart-hud');
    if (!panel || !hud) return;
    const follow = new ResizeObserver(() => panel.scrollIntoView({ block: 'nearest' }));
    const stop = () => { follow.disconnect(); for (const type of HANDS_ON) hud.removeEventListener(type, stop); };
    follow.observe(panel);
    for (const type of HANDS_ON) hud.addEventListener(type, stop, { passive: true });
    return stop;
  }, []);
  return <section ref={root} className={className ? `share-panel ${className}` : 'share-panel'} id={`${name}-panel`} aria-labelledby={`${name}-title`} aria-busy={busy} data-status={status} data-testid={`${name}-panel`}>
    <header className="share-panel-head">
      <h2 id={`${name}-title`}>{title}</h2>
      <button type="button" className="share-icon-button" onClick={close} aria-label={t('Close')} title={t('Close')}><X size={18} /></button>
    </header>
    {children}
  </section>;
}
