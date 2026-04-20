import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Job } from '../types';

export function QueueView() {
  const [jobs, setJobs] = useState<Job[] | null>(null);

  useEffect(() => {
    const tick = () => api.jobs().then((d) => setJobs(d.jobs)).catch(() => {});
    void tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  if (!jobs) return <div className="view"><p style={{color:'var(--fg-faint)'}}>loading…</p></div>;

  const by: Record<string, Job[]> = { queued: [], running: [], done: [], failed: [] };
  for (const j of jobs) (by[j.status] ?? by.queued).push(j);

  return (
    <div className="view">
      <div className="view-h">Today · Reading queue</div>
      <h1 className="view-title">What the agents are working on.</h1>
      <p className="view-sub">
        Scout clips items into sources; Compiler picks each up and turns it into a wiki page.
        Failed jobs stay here until you clear or retry them.
      </p>

      <div className="counters" style={{gridTemplateColumns:'repeat(4,1fr)'}}>
        <div className="counter"><div className="v">{by.queued.length}</div><div className="l">Queued</div></div>
        <div className="counter"><div className="v">{by.running.length}</div><div className="l">Running</div></div>
        <div className="counter"><div className="v">{by.done.length}</div><div className="l">Done</div></div>
        <div className="counter"><div className="v">{by.failed.length}</div><div className="l">Failed</div></div>
      </div>

      {jobs.length === 0 ? (
        <div style={{padding:'24px',border:'1px dashed var(--line)',borderRadius:8,fontFamily:'var(--serif)',color:'var(--fg-mute)'}}>
          No jobs yet. Subscribe a feed or queue a YouTube URL to give the agents something to do.
        </div>
      ) : (
        <div className="queue-list">
          {jobs.map((j) => <QueueRow key={j.id} job={j}/>)}
        </div>
      )}
    </div>
  );
}

function QueueRow({ job }: { job: Job }) {
  const title = job.detail.title ?? fallbackTitle(job);
  const subtitle = job.detail.subtitle;
  const srcKind = job.detail.source_kind;

  return (
    <div className="queue-row">
      <div className="queue-id">#{job.id}</div>
      <div className="queue-title">
        <div className="queue-title-line" title={title}>{title}</div>
        <div className="queue-meta">
          <span className="queue-agent">{job.agent}</span>
          <span className="queue-sep">·</span>
          <span>{job.kind}</span>
          {srcKind && <><span className="queue-sep">·</span><span>{srcKind}</span></>}
          {subtitle && <><span className="queue-sep">·</span><span className="queue-host">{subtitle}</span></>}
        </div>
      </div>
      <div className="queue-end">
        <span className="queue-status" style={{color: statusColor(job.status)}}>
          {job.status}{job.attempts > 1 ? ` · retry ${job.attempts}` : ''}
        </span>
        <span className="queue-time">{relativeTs(job.created_at)}</span>
      </div>
      {job.error && (
        <div className="queue-error" title={job.error}>
          {job.error.length > 200 ? `${job.error.slice(0, 200)}…` : job.error}
        </div>
      )}
    </div>
  );
}

function fallbackTitle(j: Job): string {
  return j.agent === 'scout' ? 'Polling feeds' : `${j.agent} · ${j.kind}`;
}

function statusColor(s: Job['status']): string {
  return { queued: 'var(--fg-mute)', running: 'var(--accent)', done: 'var(--kind-source)', failed: '#c53030' }[s];
}

function relativeTs(iso: string): string {
  const delta = Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}
