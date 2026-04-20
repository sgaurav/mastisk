/* global React, MASTISK_DATA, Icon */
const { useState: useStateA, useRef: useRefA, useEffect: useEffectA } = React;

// ─── Article view ───────────────────────────────────────────────
function ArticleView({ article, onAsk, onNavigate }) {
  const bodyRef = useRefA(null);
  const [pop, setPop] = useStateA(null); // {x, y, text}

  useEffectA(() => {
    const onUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || !bodyRef.current?.contains(sel.anchorNode)) {
        setPop(null); return;
      }
      const range = sel.getRangeAt(0);
      const r = range.getBoundingClientRect();
      const main = document.querySelector('.main');
      const m = main.getBoundingClientRect();
      setPop({
        x: r.left + r.width/2 - m.left + main.scrollLeft,
        y: r.top - m.top + main.scrollTop,
        text,
      });
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, []);

  return (
    <div className="main-inner">
      <div className="art-meta">
        <span className={`art-kind ${article.kind.toLowerCase()}`}>
          <span className="k-glyph"/>{article.kind}
        </span>
        <span className="sep">·</span>
        <span>updated {article.updated}</span>
        <span className="sep">·</span>
        <span>{article.readingTime} read</span>
        <span className="sep">·</span>
        <span className="conf">conf
          <span className="conf-bar"><span className="fill" style={{width:`${article.confidence*100}%`}}/></span>
          {Math.round(article.confidence*100)}%
        </span>
      </div>

      <h1 className="art-title">{article.title}</h1>
      {article.aka?.length > 0 && (
        <div className="art-aka">
          <span className="label">also known as</span>
          {article.aka.map((a,i) => <span key={i} className="alias">{a}{i < article.aka.length-1 ? ' ·' : ''}</span>)}
        </div>
      )}

      <p className="art-summary">{article.summary}</p>

      <div className="art-stats">
        <div className="art-stat"><div className="v">{article.sources}</div><div className="l">Sources</div></div>
        <div className="art-stat"><div className="v">{article.backlinks}</div><div className="l">Backlinks</div></div>
        <div className="art-stat"><div className="v">{article.forwardlinks}</div><div className="l">Forward links</div></div>
        <div className="art-stat"><div className="v">{article.related?.length || 0}</div><div className="l">Related concepts</div></div>
      </div>

      <div className="art-body" ref={bodyRef}>
        {article.sections.map((s, i) => {
          if (s.kind === 'callout') return (
            <div key={i} className="callout">
              <h2>{s.h}</h2>
              <p dangerouslySetInnerHTML={{__html: s.body}}/>
            </div>
          );
          if (s.kind === 'open') return (
            <div key={i} className="open">
              <h2>{s.h}</h2>
              <p dangerouslySetInnerHTML={{__html: s.body}}/>
            </div>
          );
          return (
            <div key={i}>
              <h2>{s.h}</h2>
              <p dangerouslySetInnerHTML={{__html: s.body}}/>
            </div>
          );
        })}
      </div>

      <div className="art-sources">
        <h3>Sources used in this page</h3>
        {article.sourceList.map((s, i) => (
          <div key={i} className="src-row">
            <div className="src-kind">{s.kind}</div>
            <div className="src-title">{s.title}</div>
            <div className="src-date">{s.date}</div>
          </div>
        ))}
      </div>

      {pop && (
        <div className="ask-pop" style={{left: pop.x, top: pop.y}} onMouseDown={(e)=>e.preventDefault()}>
          <button onClick={() => { onAsk(`What does "${pop.text}" mean here?`, pop.text); setPop(null); }}>
            {Icon.ask} Ask
          </button>
          <div className="sep"/>
          <button onClick={() => { onAsk(`Expand on: ${pop.text}`, pop.text); setPop(null); }}>
            {Icon.expand} Expand
          </button>
          <div className="sep"/>
          <button onClick={() => { setPop(null); }}>
            {Icon.link} Find related
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Right rail (for article view) ───────────────────────────────────────────────
function RightRail({ article, feed, onAsk, onNavigate }) {
  return (
    <aside className="rail">
      <div className="rail-section">
        <div className="rail-h">Concept map</div>
        <MiniGraph article={article} onNavigate={onNavigate}/>
      </div>

      <div className="rail-section">
        <div className="rail-h">Related <span className="count">{article.related.length}</span></div>
        {article.related.map(r => (
          <div key={r.id} className="rel-row" onClick={() => onNavigate('article', r.id)}>
            <span className="rel-label">{r.label}</span>
            <span className="rel-bar"><span className="fill" style={{width:`${r.weight*100}%`}}/></span>
            <span className="rel-w">{r.weight.toFixed(2)}</span>
          </div>
        ))}
      </div>

      <div className="rail-section">
        <div className="rail-h">Backlinks <span className="count">{article.backlinks}</span></div>
        {[
          { t: "RL + LLMs", s: "...the strongest empirical case for [[Test-time compute]] is the o-series, which..." },
          { t: "Process reward models", s: "...PRMs let you prune the search tree during [[Test-time compute]]..." },
          { t: "Daily Digest · Apr 12", s: "Three papers and two podcasts converge on [[Test-time compute]] as the new..." },
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
              <span className={`tick-agent ${MASTISK_DATA.agents.find(a=>a.id===f.agent)?.color || ''}`}>{f.agent}</span>
              <span className="tick-verb">{f.verb}</span>{' '}
              <span className="tick-obj">{f.obj}</span>
              {f.touched > 0 && <div style={{fontSize:10,color:'var(--fg-faint)',fontFamily:'var(--mono)',marginTop:2}}>touched {f.touched} pages</div>}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function MiniGraph({ article, onNavigate }) {
  const rels = article.related.slice(0, 6);
  return (
    <div className="mini-graph">
      {rels.map((r, i) => {
        const angle = (i / rels.length) * Math.PI * 2 - Math.PI/2;
        const dist = 60 + (1 - r.weight) * 18;
        const x = 50 + Math.cos(angle) * (dist/180*100);
        const y = 50 + Math.sin(angle) * (dist/180*100);
        const len = dist;
        return (
          <React.Fragment key={r.id}>
            <div className="graph-edge" style={{
              width: len,
              transform: `rotate(${angle}rad)`,
              opacity: 0.3 + r.weight * 0.5,
            }}/>
            <div className="node-rel" style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%,-50%)' }}
                 onClick={() => onNavigate('article', r.id)}
                 title={r.label}>
              {r.label.split(' ').map(w => w[0]).join('').slice(0,2)}
            </div>
          </React.Fragment>
        );
      })}
      <div className="node-center">{article.title.split(' ').map(w => w[0]).join('').slice(0,3)}</div>
    </div>
  );
}

Object.assign(window, { ArticleView, RightRail, MiniGraph });
