import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { t } from '../i18n';
import './share.css';

/** The owner's side panels: a titled section with a close button. `name` gives the ids and test id (`{name}-panel`, `{name}-title`). */
export function Panel({ name, className, title, busy, close, children }: { name: string; className?: string; title: ReactNode; busy?: boolean; close: () => void; children: ReactNode }) {
  return <section className={className ? `share-panel ${className}` : 'share-panel'} id={`${name}-panel`} aria-labelledby={`${name}-title`} aria-busy={busy} data-testid={`${name}-panel`}>
    <header className="share-panel-head">
      <h2 id={`${name}-title`}>{title}</h2>
      <button type="button" className="share-icon-button" onClick={close} aria-label={t('Close')} title={t('Close')}><X size={18} /></button>
    </header>
    {children}
  </section>;
}
