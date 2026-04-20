import type { Digest, View } from '../types';

interface Props {
  digest: Digest;
  onNavigate: (view: View, id?: string) => void;
  onAsk: (prompt: string, selection: string | null) => void;
}

export function DigestView({ digest, onNavigate, onAsk }: Props) {
  const empty = digest.counters.every((c) => c.value === 0);
  if (empty && digest.threads.length === 0) {
    return <EmptyDigest onAsk={onAsk} />;
  }
  return (
    <div className="view">
      <div className="view-h">{digest.date} · Daily Digest</div>
      <h1 className="view-title">What your agents read while you slept.</h1>
      <p className="view-sub">{digest.summary}</p>

      <div className="counters">
        {digest.counters.map((c, i) => (
          <div key={i} className="counter">
            <div className="v">{c.value}</div>
            <div className="l">{c.label}</div>
          </div>
        ))}
      </div>

      <div style={{fontFamily:'var(--mono)',fontSize:10,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--fg-faint)',marginBottom:4}}>Threads</div>

      {digest.threads.map((t, i) => (
        <div key={i} className="thread">
          <div className="thread-meta">
            <span>thread #{i+1}</span>
            <span>{t.sources} sources</span>
          </div>
          <h2 className="thread-title" onClick={() => t.article_id && onNavigate('article', t.article_id)}>{t.title}</h2>
          <p className="thread-body" dangerouslySetInnerHTML={{ __html: t.body }}/>
          <div className="thread-links">
            {t.links.map((l) => <span key={l} className="chip" onClick={() => onAsk(`Tell me about ${l}`, l)}>{l}</span>)}
          </div>
        </div>
      ))}

      <div className="queue-block">
        <div style={{fontFamily:'var(--mono)',fontSize:10,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--fg-faint)',marginBottom:10}}>In progress · agents are working</div>
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

function EmptyDigest({ onAsk }: { onAsk: Props['onAsk'] }) {
  return (
    <div className="view">
      <div className="view-h">Mastisk · Empty wiki</div>
      <h1 className="view-title">Nothing in your wiki yet.</h1>
      <p className="view-sub">
        Your agents are ready. Subscribe a feed, queue a video, or just ask a question —
        the wiki fills itself from there.
      </p>

      <div className="queue-block" style={{marginTop: 32}}>
        <div style={{fontFamily:'var(--mono)',fontSize:10,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--fg-faint)',marginBottom:14}}>
          Start here — from your Mac terminal
        </div>
        <div style={{fontFamily:'var(--mono)',fontSize:13,lineHeight:1.8,color:'var(--fg)'}}>
          <div><span style={{color:'var(--fg-faint)'}}>$</span> mastisk add-feed <span style={{color:'var(--accent)'}}>https://simonwillison.net/atom/everything/</span></div>
          <div><span style={{color:'var(--fg-faint)'}}>$</span> mastisk add-youtube <span style={{color:'var(--accent)'}}>https://youtube.com/watch?v=…</span></div>
          <div><span style={{color:'var(--fg-faint)'}}>$</span> mastisk seed-demo <span style={{color:'var(--fg-faint)'}}>  # load the Test-time compute sample</span></div>
        </div>
      </div>

      <div className="queue-block" style={{marginTop: 16}}>
        <div style={{fontFamily:'var(--mono)',fontSize:10,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--fg-faint)',marginBottom:10}}>
          Or just ask
        </div>
        <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
          <button className="chip" onClick={() => onAsk('What should I read first?', null)}>
            What should I read first?
          </button>
          <button className="chip" onClick={() => onAsk('Summarize my interests file', null)}>
            Summarize my interests file
          </button>
          <button className="chip" onClick={() => onAsk('What is agent memory?', null)}>
            What is agent memory?
          </button>
        </div>
      </div>

      <div style={{marginTop:32, fontFamily:'var(--serif)', fontStyle:'italic', color:'var(--fg-mute)', fontSize:15}}>
        Edit <code style={{fontFamily:'var(--mono)',fontSize:12,background:'var(--bg-sunk)',padding:'1px 6px',borderRadius:4}}>vault/_self/interests.md</code> to shape what Scout pays attention to.
        It lives in iCloud — editable from your phone too.
      </div>
    </div>
  );
}
