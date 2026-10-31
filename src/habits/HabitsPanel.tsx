import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { Cart } from '../../shared/cart';
import { formatTwd } from '../../shared/cart';
import { habitsReport } from '../../shared/habits';
import { emptyUnbox, unboxStateSchema, type UnboxState } from '../../shared/unbox';
import { getLocale, t } from '../i18n';
import { ownerFetch } from '../owner';
import '../share/share.css';
import './habits.css';

const REFRESH_MS = 5000;

/** Which parcels are opened, read while the panel is open; an unanswered read counts as "none opened yet" only until the first answer. */
function useOpened(revision: number | undefined) {
  const [state, setState] = useState<UnboxState | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await ownerFetch('/api/unbox', { signal: controller.signal });
        if (response.ok) setState(unboxStateSchema.parse(await response.json()));
      } catch { /* the next tick tries again */ }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [revision]);
  return state;
}

interface Bar { label: string; value: number; text: string; detail?: string }

/** Horizontal bars scaled to the largest value; the label and the number are text, so the chart reads without colour. */
function Bars({ rows, name }: { rows: Bar[]; name: string }) {
  const max = Math.max(1, ...rows.map(row => row.value));
  return <ul className="habits-bars" aria-label={name}>
    {rows.map(row => <li key={row.label}>
      <span className="habits-bar-label">{row.label}</span>
      <span className="habits-bar-track"><i style={{ width: `${row.value ? Math.max(3, (row.value / max) * 100) : 0}%` }} /></span>
      <span className="habits-bar-value">{row.text}{row.detail && <small>{row.detail}</small>}</span>
    </li>)}
  </ul>;
}

const COLUMN_W = 300, COLUMN_H = 96, COLUMN_TOP = 16, COLUMN_BASE = COLUMN_H - 20;

/** Vertical columns in a fixed 300-wide box, one per label, with the count above each and the label under it. */
function Columns({ rows, name }: { rows: { label: string; value: number }[]; name: string }) {
  const max = Math.max(1, ...rows.map(row => row.value)), slot = COLUMN_W / rows.length, width = Math.min(26, slot - 10);
  return <svg className="habits-columns" viewBox={`0 0 ${COLUMN_W} ${COLUMN_H}`} role="img" aria-label={`${name}: ${rows.map(row => `${row.label} ${row.value}`).join(', ')}`}>
    <line x1="0" x2={COLUMN_W} y1={COLUMN_BASE} y2={COLUMN_BASE} className="habits-axis" />
    {rows.map((row, index) => {
      const height = row.value ? Math.max(3, (row.value / max) * (COLUMN_BASE - COLUMN_TOP)) : 0, x = slot * index + slot / 2;
      return <g key={row.label}>
        {height > 0 && <rect x={x - width / 2} y={COLUMN_BASE - height} width={width} height={height} rx="4" className="habits-column" />}
        <text x={x} y={COLUMN_BASE - height - 4} textAnchor="middle" className="habits-column-value">{row.value}</text>
        <text x={x} y={COLUMN_H - 5} textAnchor="middle" className="habits-column-label">{row.label}</text>
      </g>;
    })}
  </svg>;
}

/** The owner's shopping habits, drawn from the items in the cart right now (the same report the habits_report MCP tool returns). */
export function HabitsPanel({ cart, close }: { cart: Cart | null; close: () => void }) {
  const opened = useOpened(cart?.revision);
  const report = useMemo(() => habitsReport(cart?.items ?? [], opened ?? emptyUnbox(), new Date().toISOString(), getLocale()), [cart, opened]);
  const { totals, parcels } = report, empty = totals.lines === 0;
  const parcelTotal = Math.max(1, totals.lines);
  return <section className="share-panel habits-panel" id="habits-panel" aria-labelledby="habits-title" data-testid="habits-panel">
    <header className="share-panel-head">
      <h2 id="habits-title">{t('Shopping habits')}</h2>
      <button type="button" className="share-icon-button" onClick={close} aria-label={t('Close')} title={t('Close')}><X size={18} /></button>
    </header>
    {!opened ? <p className="cart-note" role="status">{t('Loading…')}</p> : empty ? <p className="cart-note">{t('Nothing in the cart yet, so there are no habits to show.')}</p> : <>
      <dl className="habits-tiles">
        <div><dt>{t('Average per line')}</dt><dd>{totals.averageTwd === null ? '–' : formatTwd(totals.averageTwd)}</dd></div>
        <div><dt>{t('Biggest line')}</dt><dd>{report.biggest ? formatTwd(report.biggest.amountTwd) : '–'}{report.biggest && <small>{report.biggest.title}</small>}</dd></div>
        <div><dt>{t('No price')}</dt><dd>{totals.unpricedLines}</dd></div>
      </dl>
      {report.observations.length > 0 && <ul className="habits-notes" aria-label={t('What the numbers say')} data-testid="habits-observations">
        {report.observations.map(text => <li key={text}>{text}</li>)}
      </ul>}
      <div className="habits-block">
        <h3>{t('Spend by category')}</h3>
        <Bars name={t('Spend by category')} rows={report.categories.map(row => ({ label: row.label, value: row.spendTwd, text: formatTwd(row.spendTwd), detail: t('{count} lines', { count: row.lines }) }))} />
      </div>
      {report.stores.length > 0 && <div className="habits-block">
        <h3>{t('Stores')}</h3>
        <Bars name={t('Stores')} rows={report.stores.map(row => ({ label: row.store, value: row.spendTwd, text: formatTwd(row.spendTwd), detail: t('{count} lines', { count: row.lines }) }))} />
        {report.withoutStore > 0 && <p className="habits-foot">{t('{count} lines have no store.', { count: report.withoutStore })}</p>}
      </div>}
      <div className="habits-block">
        <h3>{t('Price per line')}</h3>
        <Bars name={t('Price per line')} rows={report.priceBands.map(row => ({ label: row.label, value: row.lines, text: t('{count} lines', { count: row.lines }) }))} />
      </div>
      <div className="habits-block">
        <h3>{t('When things were noted')}</h3>
        <Columns name={t('Noted by weekday')} rows={report.weekdays.map(row => ({ label: row.label, value: row.lines }))} />
        <Columns name={t('Noted by time of day')} rows={report.timeOfDay.map(row => ({ label: `${row.label} ${row.hours}`, value: row.lines }))} />
        <p className="habits-foot">{t('Taiwan time, from when each thing was first noted.')}</p>
      </div>
      <div className="habits-block">
        <h3>{t('Parcels')}</h3>
        <div className="habits-split" role="img" aria-label={t('{opened} opened, {unopened} unopened', { opened: parcels.opened, unopened: parcels.unopened })}>
          {parcels.opened > 0 && <i className="habits-opened" style={{ flexGrow: parcels.opened / parcelTotal }} />}
          {parcels.unopened > 0 && <i className="habits-unopened" style={{ flexGrow: parcels.unopened / parcelTotal }} />}
        </div>
        <p className="habits-legend"><span className="habits-opened">{t('{count} opened', { count: parcels.opened })}</span><span className="habits-unopened">{t('{count} unopened ({amount})', { count: parcels.unopened, amount: formatTwd(parcels.unopenedSpendTwd) })}</span></p>
      </div>
      <p className="habits-foot">{t('Only what is in the cart now is counted. Items you removed are gone from this report.')}</p>
    </>}
  </section>;
}
