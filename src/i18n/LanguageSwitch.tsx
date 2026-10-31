import { Languages } from 'lucide-react';
import { getLocale, setLocale, t } from '.';

export function LanguageSwitch() {
  const other = getLocale() === 'en' ? 'zh-TW' : 'en';
  return <button type="button" className="cart-share cart-lang" lang={other} onClick={() => setLocale(other)} title={t('Switch language')} data-testid="language-switch">
    <Languages size={15} aria-hidden="true" />{other === 'en' ? 'English' : '中文'}
  </button>;
}
