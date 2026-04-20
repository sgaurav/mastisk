import type { Article, AgentInfo, FeedTick, View } from '../types';

interface Props {
  article: Article;
  feed: FeedTick[];
  agents: AgentInfo[];
  onAsk: (prompt: string, selection: string | null) => void;
  onNavigate: (view: View, id?: string) => void;
}

export function RightRail({ article, feed, agents, onNavigate }: Props) {
  return (
    <aside className="rail">
      <div className="rail-section">
        <div className="rail-h">Concept map</div>
        <MiniGraph article={article} onNavigate={onNavigate}/>
      </div>

      <div className="rail-section">
        <div className="rail-h">Related <span className="count">{article.related.length}</span></div>
        {article.related.map((r) => (
          <div key={r.id} className="rel-row" onClick={() => onNavigate('article', r.id)}>
            <span className="rel-label">{r.label}</span>
            <span className="rel-bar"><span className="fill" style={{ width: `${r.weight*100}%` }}/></span>
            <span className="rel-w">{r.weight.toFixed(2)}</span>
          </div>
        ))}
      </div>

      <div className="rail-section">
        <div className="rail-h">Backlinks <span className="count">{article.backlinks}</span></div>
        {[
          { t: 'RL + LLMs', s: '…the strongest empirical case for [[Test-time compute]] is the o-series…' },
          { t: 'Process reward models', s: '…PRMs let you prune the search tree during [[Test-time compute]]…' },
        ].map((b, i) => (
          <div key={i} className="backlink">
            <div className="bl-title">{b.t}</div>
            <div className="bl-snip">{b.s}</div>
          </div>
        ))}
      </div>

      <div className="rail-section">
        <div className="rail-h">Live feed
          <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:9,color:'var(--accent)'}}>
            <span style={{width:5,height:5,borderRadius:'50%',background:'var(--accent)',animation:'pulse 1.6s infinite'}}/>
            LIVE
          </span>
        </div>
        {feed.slice(0, 6).map((f, i) => (
          <div key={i} className="tick-row">
            <div className="tick-time">{f.t}</div>
            <div className="tick-body">
              <span className={`tick-agent ${agents.find((a) => a.id === f.agent)?.color || ''}`}>{f.agent}</span>
              <span className="tick-verb"> {f.verb}</span>{' '}
              <span className="tick-obj">{f.obj}</span>
              {f.touched > 0 && <div style={{fontSize:10,color:'var(--fg-faint)',fontFamily:'var(--mono)',marginTop:2}}>touched {f.touched} pages</div>}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function MiniGraph({ article, onNavigate }: { article: Article; onNavigate: (v: View, id?: string) => void }) {
  const rels = article.related.slice(0, 6);
  return (
    <div className="mini-graph">
      {rels.map((r, i) => {
        const angle = (i / rels.length) * Math.PI * 2 - Math.PI/2;
        const dist = 60 + (1 - r.weight) * 18;
        const x = 50 + Math.cos(angle) * (dist/180*100);
        const y = 50 + Math.sin(angle) * (dist/180*100);
        return (
          <div key={r.id}>
            <div className="graph-edge" style={{
              width: dist,
              transform: `rotate(${angle}rad)`,
              opacity: 0.3 + r.weight * 0.5,
            }}/>
            <div className="node-rel" style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)' }}
                 onClick={() => onNavigate('article', r.id)}
                 title={r.label}>
              {r.label.split(' ').map((w) => w[0]).join('').slice(0, 2)}
            </div>
          </div>
        );
      })}
      <div className="node-center">{article.title.split(' ').map((w) => w[0]).join('').slice(0, 3)}</div>
    </div>
  );
}
