import { useEffect, useState } from 'react';
import { Icon } from './icons';
import { api } from '../api';

interface Msg { role: 'user' | 'assistant'; text: string; cites?: string[]; }

interface Ctx { prompt: string; selection: string | null; article_id?: string }

interface Props {
  open: boolean;
  ctx: Ctx | null;
  onClose: () => void;
}

export function AskDrawer({ open, ctx, onClose }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (ctx?.prompt) {
      setMsgs([{ role: 'user', text: ctx.prompt }]);
      void send(ctx.prompt);
    } else {
      setMsgs([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ctx?.prompt, ctx?.selection]);

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || sending) return;
    setSending(true);
    if (!text) setMsgs((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    try {
      const resp = await api.ask(q, {
        selection: ctx?.selection ?? undefined,
        article_id: ctx?.article_id,
      });
      setMsgs((m) => [...m, { role: 'assistant', text: resp.answer, cites: resp.cites }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: `_Error: ${(e as Error).message}_`, cites: [] }]);
    } finally {
      setSending(false);
    }
  }

  const suggestions = ctx?.selection ? [
    `Add "${ctx.selection}" as a new concept`,
    `Show everything that mentions "${ctx.selection}"`,
    `What's the opposite view?`,
  ] : [
    "Summarize today's digest in 3 bullets",
    'What should I read first?',
    'Any contradictions in my wiki?',
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
        {msgs.length === 0 && !sending && (
          <div style={{color:'var(--fg-mute)',fontFamily:'var(--serif)',fontSize:15,fontStyle:'italic'}}>
            Ask anything grounded in your wiki. Answers cite the pages they're drawn from; follow any citation to open that page.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ask-msg ${m.role}`}>
            {m.role === 'user' ? (
              <div className="ask-bubble">{m.text}</div>
            ) : (
              <>
                <div className="ask-text" dangerouslySetInnerHTML={{ __html: renderAnswer(m.text) }}/>
                {m.cites && m.cites.length > 0 && (
                  <div className="ask-cites">
                    {m.cites.map((c) => <span key={c} className="ask-cite">◊ {c}</span>)}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {sending && (
          <div className="ask-msg assistant"><div className="ask-text" style={{color:'var(--fg-faint)'}}>thinking…</div></div>
        )}
        <div className="ask-suggestions">
          {suggestions.map((s, i) => <button key={i} onClick={() => send(s)}>{s}</button>)}
        </div>
      </div>
      <div className="ask-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask, expand, link…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
        />
        <button className="ask-send" onClick={() => send()}>{Icon.arrow}</button>
      </div>
    </div>
  );
}

// Convert [[WikiLink]] / inline *emphasis* to spans
function renderAnswer(text: string): string {
  return text
    .replace(/\[\[([^\]]+?)\]\]/g, '<span class="link">$1</span>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}
