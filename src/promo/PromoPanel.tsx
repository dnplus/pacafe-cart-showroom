import { Clapperboard, Download, RotateCcw, X } from 'lucide-react';
import { isFinished, type PromoJob } from '../../shared/promo';
import type { PromoStatus } from '../../shared/runner';
import { t } from '../i18n';
import type { TextKey } from '../i18n/messages';
import { usePromo } from './usePromo';
import '../share/share.css';
import './promo.css';

const statusText: Record<PromoStatus, TextKey> = { queued: 'In line', storyboard: 'Storyboard', voice: 'Voice-over', rendering: 'Rendering', done: 'Done', failed: 'Failed' };
const stages: readonly PromoStatus[] = ['queued', 'storyboard', 'voice', 'rendering', 'done'];

function Progress({ job }: { job: PromoJob }) {
  const percent = Math.round(job.progress * 100);
  return <div className="promo-progress" data-testid="promo-progress">
    <ol className="promo-stages" aria-label={t('Intro video')}>
      {stages.map(stage => <li key={stage} data-state={stage === job.status ? 'now' : stages.indexOf(stage) < stages.indexOf(job.status) ? 'past' : 'next'} aria-current={stage === job.status ? 'step' : undefined}>{t(statusText[stage])}</li>)}
    </ol>
    {job.status !== 'queued' && <span className="promo-bar" role="progressbar" aria-label={t('Video progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></span>}
  </div>;
}

/** The owner's one-button video: queues a job for the cart as it stands and shows it through to the finished file. The runner that makes it is the owner's own (`npm run runner`). */
export function PromoPanel({ count, close }: { count: number; close?: () => void }) {
  const { job, offline, queueing, queueFailed, queue } = usePromo();
  const making = job != null && !isFinished(job), empty = count === 0;
  return <section className="promo-panel" id="promo-panel" aria-labelledby="promo-title" data-testid="promo-panel" data-status={job?.status ?? 'none'}>
    <header className="promo-head">
      <h2 id="promo-title"><Clapperboard size={15} aria-hidden="true" />{t('Intro video')}</h2>
      {close && <button type="button" className="share-icon-button" onClick={close} aria-label={t('Close')} title={t('Close')}><X size={18} /></button>}
    </header>
    {job && <p className="promo-state" data-testid="promo-status" data-status={job.status} role="status">{t(statusText[job.status])}{!isFinished(job) && job.status !== 'queued' && <small>{Math.round(job.progress * 100)}%</small>}</p>}
    {job && !isFinished(job) && <Progress job={job} />}
    {job?.status === 'done' && job.output && <div className="promo-result">
      <video controls preload="metadata" playsInline poster={job.output.thumbnailUrl} src={job.output.videoUrl} data-testid="promo-video" />
      <a className="promo-download" href={job.output.videoUrl} download="intro.mp4" data-testid="promo-download"><Download size={15} aria-hidden="true" />{t('Download the video')}</a>
    </div>}
    {job?.status === 'failed' && <p className="promo-problem" data-testid="promo-error">{job.error}</p>}
    {!making && <button type="button" className="promo-start" onClick={() => void queue()} disabled={empty || queueing || job === undefined} data-testid="promo-start">
      {job?.status === 'failed' ? <><RotateCcw size={15} aria-hidden="true" />{t('Retry')}</> : <><Clapperboard size={15} aria-hidden="true" />{t(job?.status === 'done' ? 'Make another' : 'Make the intro video')}</>}
    </button>}
    {empty && !making && <p className="cart-note" data-testid="promo-empty">{t('Add something to the cart first: the video is made from what is on the shelf.')}</p>}
    {queueFailed && <p className="promo-problem" role="alert" data-testid="promo-queue-failed">{t('Could not queue the video. Try again.')}</p>}
    {offline && <p className="cart-note cart-offline" role="status">{t('Cannot check the video right now. Trying again.')}</p>}
    <p className="promo-hint">{t('The video is made on the owner\'s own computer by the runner (npm run runner). With no runner running, it waits in line.')}</p>
  </section>;
}
