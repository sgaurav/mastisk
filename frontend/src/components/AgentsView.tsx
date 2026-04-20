import type { AgentInfo, FeedTick } from '../types';

interface Props {
  agents: AgentInfo[];
  feed: FeedTick[];
}

export function AgentsView({ agents, feed }: Props) {
  return (
    <div className="view">
      <div className="view-h">System · Agents</div>
      <h1 className="view-title">Five agents, always on.</h1>
      <p className="view-sub">Your agents read, transcribe, summarize, and connect 24/7. Each is a narrow specialist that hands off to the next. Together they maintain a wiki you almost never need to edit.</p>

      <div className="agent-grid">
        {agents.map((a) => (
          <div key={a.id} className={`agent-card ${a.implemented ? '' : 'disabled'}`}>
            <div className={`agent-status ${a.status}`}>
              <span className="s-dot"/>{a.status === 'disabled' ? 'not wired' : a.status}
            </div>
            <div className="a-name">{a.name}</div>
            <div className="a-role">{a.role}</div>
            {a.implemented ? (
              <>
                <div className="agent-load">
                  <div className="label">
                    <span>queue</span>
                    <span>{a.queued} queued · {a.running} running</span>
                  </div>
                  <div className="bar"><div className="fill" style={{ width: `${Math.min(1, a.load)*100}%` }}/></div>
                </div>
              </>
            ) : (
              <div className="agent-load">
                <div className="label" style={{color:'var(--fg-faint)'}}>
                  <span>status</span><span>no implementation</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{marginTop:48}}>
        <div className="view-h">Recent operations</div>
        <div style={{borderTop:'1px solid var(--line)'}}>
          {feed.map((f, i) => (
            <div key={i} style={{display:'flex',gap:14,padding:'12px 0',borderBottom:'1px solid var(--line-soft)',alignItems:'center'}}>
              <div style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--fg-faint)',width:40}}>{f.t}</div>
              <span className={`tick-agent ${agents.find((a) => a.id === f.agent)?.color || ''}`} style={{width:80,textAlign:'center'}}>{f.agent}</span>
              <span style={{color:'var(--fg-mute)',width:90,fontFamily:'var(--mono)',fontSize:11}}>{f.verb}</span>
              <span style={{flex:1,color:'var(--fg)',fontSize:13}}>{f.obj}</span>
              {f.touched > 0 && <span style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--fg-faint)'}}>+{f.touched} pages</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
