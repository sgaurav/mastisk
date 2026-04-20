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
        <div style={{border:'1px solid var(--line)',borderRadius:8,overflow:'hidden'}}>
          {jobs.map((j) => (
            <div key={j.id} style={{display:'grid',gridTemplateColumns:'60px 100px 80px 1fr auto',gap:12,padding:'12px 16px',borderTop:'1px solid var(--line-soft)',alignItems:'center',fontFamily:'var(--mono)',fontSize:12}}>
              <span style={{color:'var(--fg-faint)'}}>#{j.id}</span>
              <span style={{color:'var(--fg)'}}>{j.agent}</span>
              <span style={{color:'var(--fg-mute)'}}>{j.kind}</span>
              <span style={{color: statusColor(j.status)}}>
                {j.status}{j.attempts > 1 ? ` · retry ${j.attempts}` : ''}
                {j.error && <span style={{display:'block',color:'var(--fg-faint)',fontSize:11,marginTop:2}} title={j.error}>{j.error.slice(0, 120)}</span>}
              </span>
              <span style={{color:'var(--fg-faint)',fontSize:11}}>{relativeTs(j.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
