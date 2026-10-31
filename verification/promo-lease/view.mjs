// Words for the /statechart chart and report of PromoLease.tla.
const STATUS = { queued: 'Queued', storyboard: 'Storyboard', voice: 'Voice', rendering: 'Rendering', done: 'Done', failed: 'Failed' };

export const title = 'Promo job between the worker and its runners';

export const state = (v) => {
  const lease = v.lease === 0 ? '' : v.live ? `, ${v.holder}'s lease live` : `, ${v.holder}'s lease expired`;
  return `${STATUS[v.status]}${lease}`;
};

export const group = (v) => (v.status === 'done' || v.status === 'failed' ? 'finished' : v.status === 'queued' ? 'waiting' : 'running');
export const colors = { waiting: 'blue', running: 'yellow', finished: 'teal' };

// The runner whose request or plan changed in this step.
const mover = (from, to) => Object.keys(to.req).find((r) => JSON.stringify(from.req[r]) !== JSON.stringify(to.req[r]) || from.plan[r] !== to.plan[r]);

// A report was saved when the runner moves on: a refusal sends it to "fail", or ends a "fail" report with nothing saved.
const saved = (r, from, to) => (from.plan[r] === 'fail' ? to.status === 'failed' && from.status !== 'failed' : to.plan[r] !== 'fail');

export const step = (action, from, to) => {
  const r = mover(from, to);
  const sent = r && to.req[r] && to.req[r].k !== 'none' ? to.req[r] : null;
  switch (action) {
    case 'AskNext': return `runner ${r} asks for work`;
    case 'ReadQueue': return to.claims[r] > from.claims[r] ? `the worker saves claim ${to.lease} for runner ${r}` : `the worker tells runner ${r} nothing waits`;
    case 'DeleteOld': return `the worker deletes claim ${from.req[r].old}'s files and answers runner ${r}`;
    case 'Send': return `runner ${r} sends "${sent.to}" under claim ${sent.claim}`;
    case 'CheckReport': return sent ? `the worker checks runner ${r}'s files` : saved(r, from, to) ? `the worker saves runner ${r}'s "${from.req[r].to}"` : `the worker refuses runner ${r}'s "${from.req[r].to}"`;
    case 'SaveDone': return to.status === 'done' ? `the worker saves runner ${r}'s done` : `the worker refuses runner ${r}'s done`;
    case 'SendVideo': return `runner ${r} uploads its video`;
    case 'CheckRunning': return sent ? `the worker accepts runner ${r}'s upload` : `the worker refuses runner ${r}'s upload`;
    case 'PutVideo': return `runner ${r}'s video lands in storage`;
    case 'Expire': return `${from.holder}'s lease runs out`;
    case 'Over': return 'the runners stop';
    default: return action;
  }
};
