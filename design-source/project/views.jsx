/* global React, MASTISK_DATA, Icon */

// ─── Digest view ─────────────────────────────────
function DigestView({ digest, onNavigate, onAsk }) {
  return (
    <div className="view">
      <div className="view-h">{digest.date} · Daily Digest</div>
      <h1 className="view-title">What your agents read while you slept.</h1>
      <p className="view-sub">{digest.summary}</p>

      <div className="counters">
        {digest.counters.map((c,i) => (
          <div key={i} className="counter">
            <div className="v">{c.value}</div>
            <div className="l">{c.label}</div>
          </div>
        ))}
      </div>

      <div style={{fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--fg-faint)', marginBottom:4}}>Threads</div>

      {digest.threads.map((t, i) => (
        <div key={i} className="thread">
          <div className="thread-meta">
            <span>thread #{i+1}</span>
            <span>{t.sources} sources</span>
          </div>
          <h2 className="thread-title" onClick={() => onNavigate('article', 'ttc')}>{t.title}</h2>
          <p className="thread-body">{t.body}</p>
          <div className="thread-links">
            {t.links.map(l => <span key={l} className="chip" onClick={() => onAsk(`Tell me about ${l}`, l)}>{l}</span>)}
          </div>
        </div>
      ))}

      <div className="queue-block">
        <div style={{fontFamily:'var(--mono)', fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--fg-faint)', marginBottom:10}}>In progress · agents are working</div>
        {digest.queue.map((q, i) => (
          <div key={i} className={`queue-row ${i===1 ? 'now' : ''}`}>
            <div className="q-status"/>
            <span>{q}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Agents view ─────────────────────────────────
function AgentsView({ agents, feed }) {
  return (
    <div className="view">
      <div className="view-h">System · Agents</div>
      <h1 className="view-title">Five agents, always on.</h1>
      <p className="view-sub">Your agents read, transcribe, summarize, and connect 24/7. Each is a narrow specialist that hands off to the next. Together they maintain a wiki you almost never need to edit.</p>

      <div className="agent-grid">
        {agents.map(a => (
          <div key={a.id} className="agent-card">
            <div className={`agent-status ${a.status}`}>
              <span className="s-dot"/>{a.status}
            </div>
            <div className="a-name">{a.name}</div>
            <div className="a-role">{a.role}</div>
            <div className="agent-load">
              <div className="label"><span>load</span><span>{Math.round(a.load*100)}%</span></div>
              <div className="bar"><div className="fill" style={{width:`${a.load*100}%`}}/></div>
            </div>
          </div>
        ))}
      </div>

      <div style={{marginTop:48}}>
        <div className="view-h">Recent operations</div>
        <div style={{borderTop:'1px solid var(--line)'}}>
          {feed.map((f, i) => (
            <div key={i} style={{display:'flex', gap:14, padding:'12px 0', borderBottom:'1px solid var(--line-soft)', alignItems:'center'}}>
              <div style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--fg-faint)', width:40}}>{f.t}</div>
              <span className={`tick-agent ${MASTISK_DATA.agents.find(a=>a.id===f.agent)?.color || ''}`} style={{width:80, textAlign:'center'}}>{f.agent}</span>
              <span style={{color:'var(--fg-mute)', width:90, fontFamily:'var(--mono)', fontSize:11}}>{f.verb}</span>
              <span style={{flex:1, color:'var(--fg)', fontSize:13}}>{f.obj}</span>
              {f.touched > 0 && <span style={{fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-faint)'}}>+{f.touched} pages</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Graph view (full) ─────────────────────────────────
function GraphView({ onNavigate }) {
  const clusters = [
    { name: "TTC", color: "var(--kind-concept)", center: [0.3, 0.4], nodes: ["Test-time compute","Process reward models","MCTS","Self-consistency","Best-of-N","Verifier gap"] },
    { name: "RL+LLM", color: "var(--kind-synth)", center: [0.65, 0.35], nodes: ["RL + LLMs","DPO","RLHF","Reward hacking","o-series","AlphaProof"] },
    { name: "World", color: "var(--kind-entity)", center: [0.7, 0.72], nodes: ["World models","Predictive coding","Genie","Sora","JEPA"] },
    { name: "People", color: "var(--kind-source)", center: [0.28, 0.75], nodes: ["Karpathy","Sutton","LeCun","Hassabis","Altman"] },
  ];
  const allNodes = [];
  clusters.forEach((c, ci) => c.nodes.forEach((n, ni) => {
    const angle = (ni / c.nodes.length) * Math.PI * 2 + ci;
    const r = ni === 0 ? 0 : 8 + (ni % 3) * 3;
    allNodes.push({
      label: n, color: c.color, cluster: ci,
      x: c.center[0] * 100 + Math.cos(angle) * r,
      y: c.center[1] * 100 + Math.sin(angle) * r,
      size: ni === 0 ? 34 : 12 + (6-ni) * 1.4,
    });
  }));
  const edges = [];
  clusters.forEach((c, ci) => {
    const start = allNodes.findIndex(n => n.cluster === ci);
    for (let i = start+1; i < start + c.nodes.length; i++) edges.push([start, i]);
  });
  edges.push([0, 6], [6, 11], [0, 17], [10, 16], [11, 1]);

  return (
    <div>
      <div style={{padding:'24px 32px 16px', display:'flex', alignItems:'center', gap:16}}>
        <div>
          <div className="view-h">System · Graph</div>
          <div style={{fontFamily:'var(--serif)', fontSize:28, fontWeight:500, lineHeight:1.1}}>522 pages · 1,847 connections</div>
        </div>
        <div style={{marginLeft:'auto', display:'flex', gap:6}}>
          {clusters.map((c,i) => (
            <div key={i} style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--fg-mute)',fontFamily:'var(--mono)',padding:'4px 10px',background:'var(--bg-elev)',borderRadius:14,border:'1px solid var(--line-soft)'}}>
              <span style={{width:8,height:8,borderRadius:'50%',background:c.color}}/>{c.name}
            </div>
          ))}
        </div>
      </div>
      <div className="graph-canvas">
        <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>
          {edges.map(([a,b], i) => (
            <line key={i}
              x1={`${allNodes[a].x}%`} y1={`${allNodes[a].y}%`}
              x2={`${allNodes[b].x}%`} y2={`${allNodes[b].y}%`}
              stroke="var(--line)" strokeWidth="1" opacity="0.7"/>
          ))}
        </svg>
        {allNodes.map((n, i) => (
          <div key={i} style={{
            position:'absolute', left:`${n.x}%`, top:`${n.y}%`,
            transform:'translate(-50%,-50%)',
            width:n.size, height:n.size, borderRadius:'50%',
            background: n.size > 24 ? n.color : 'var(--bg-card)',
            border: `1.5px solid ${n.color}`,
            cursor:'pointer',
            boxShadow: n.size > 24 ? '0 0 0 4px var(--bg)' : 'none',
          }} title={n.label}/>
        ))}
        {allNodes.filter(n => n.size > 24).map((n, i) => (
          <div key={`l-${i}`} style={{
            position:'absolute', left:`${n.x}%`, top:`calc(${n.y}% + ${n.size/2 + 8}px)`,
            transform:'translateX(-50%)',
            fontFamily:'var(--mono)', fontSize:10, color:'var(--fg-mute)',
            whiteSpace:'nowrap', pointerEvents:'none',
          }}>{n.label}</div>
        ))}
      </div>
    </div>
  );
}

// ─── Ask Drawer ─────────────────────────────────
function AskDrawer({ open, ctx, onClose }) {
  const [msgs, setMsgs] = React.useState([]);
  const [input, setInput] = React.useState("");

  React.useEffect(() => {
    if (open && ctx?.prompt) {
      setMsgs([
        { role: "user", text: ctx.prompt },
        { role: "assistant",
          text: `Based on what's already in your wiki, "${ctx.selection || ctx.prompt}" most directly maps to <span class="link">test-time compute</span> — specifically the family of methods that scale inference rather than training. The o-series and AlphaProof are the cleanest empirical demos. There are open questions in your vault about whether this generalizes beyond verifiable domains.`,
          cites: ["Test-time compute", "AlphaProof", "Snell 2024", "Latent Space ep 184"],
        },
      ]);
    } else if (open) {
      setMsgs([]);
    }
  }, [open, ctx]);

  const send = (text) => {
    const t = text || input;
    if (!t.trim()) return;
    setMsgs(m => [...m, { role: "user", text: t }, {
      role: "assistant",
      text: `Pulled 4 pages from your wiki. The clearest answer lives in your <span class="link">RL + LLMs</span> synthesis page: process reward models trained on reasoning traces let test-time search prune unproductive branches. The bottleneck is the verifier — see <span class="link">Verifier-generator gap</span>.`,
      cites: ["RL + LLMs", "Process reward models", "Verifier-generator gap"],
    }]);
    setInput("");
  };

  const suggestions = ctx?.selection ? [
    `Add "${ctx.selection}" as a new concept`,
    `Show everything that mentions "${ctx.selection}"`,
    `What's the opposite view?`,
  ] : [
    "Summarize today's digest in 3 bullets",
    "What should I read first?",
    "Any contradictions in my wiki?",
  ];

  return (
    <div className={`ask-drawer ${open ? 'open' : ''}`}>
      <div className="ask-head">
        <div className="ctx">
          {Icon.spark}
          <span>{ctx?.selection ? `selection · "${ctx.selection.slice(0, 40)}${ctx.selection.length > 40 ? '…' : ''}"` : 'Ask your wiki'}</span>
        </div>
        <button className="tb-btn" onClick={onClose}>{Icon.close}</button>
      </div>
      <div className="ask-body">
        {msgs.length === 0 && (
          <div style={{color:'var(--fg-mute)', fontFamily:'var(--serif)', fontSize:15, fontStyle:'italic'}}>
            Ask anything grounded in your 522 pages and 1,247 sources. Answers cite the pages they're drawn from; follow any citation to open that page.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ask-msg ${m.role}`}>
            {m.role === 'user' ? (
              <div className="ask-bubble">{m.text}</div>
            ) : (
              <>
                <div className="ask-text" dangerouslySetInnerHTML={{__html: m.text}}/>
                {m.cites && (
                  <div className="ask-cites">
                    {m.cites.map(c => <span key={c} className="ask-cite">◊ {c}</span>)}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        <div className="ask-suggestions">
          {suggestions.map((s,i) => <button key={i} onClick={() => send(s)}>{s}</button>)}
        </div>
      </div>
      <div className="ask-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask, expand, link…"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }}}
        />
        <button className="ask-send" onClick={() => send()}>{Icon.arrow}</button>
      </div>
    </div>
  );
}

Object.assign(window, { DigestView, AgentsView, GraphView, AskDrawer });
