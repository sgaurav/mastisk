import { useEffect, useRef, useState } from 'react';
import type { Article, View } from '../types';
import { Icon } from './icons';
import { api } from '../api';
import { SynthesisFeedback } from './SynthesisFeedback';

interface Props {
  article: Article;
  onAsk: (prompt: string, selection: string | null) => void;
  onNavigate: (view: View, id?: string) => void;
}

interface Pop { x: number; y: number; text: string; }

export function ArticleView({ article, onAsk, onNavigate }: Props) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const readStartRef = useRef<number>(Date.now());

  // Emit "opened" signal on mount; "time_read" on unmount.
  useEffect(() => {
    readStartRef.current = Date.now();
    api.signal('opened', article.id);
    return () => {
      const seconds = Math.round((Date.now() - readStartRef.current) / 1000);
      if (seconds >= 2) api.signal('time_read', article.id, { seconds });
    };
  }, [article.id]);

  // Selection handler: desktop uses mouseup, mobile uses touchend + selectionchange
  useEffect(() => {
    const placePop = (text: string, rect: DOMRect) => {
      const main = document.querySelector('.main') as HTMLElement;
      if (!main) { setPop(null); return; }
      const m = main.getBoundingClientRect();
      setPop({
        x: rect.left + rect.width / 2 - m.left + main.scrollLeft,
        y: rect.top - m.top + main.scrollTop,
        text,
      });
    };
    const check = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || !bodyRef.current?.contains(sel?.anchorNode || null)) {
        setPop(null); return;
      }
      const range = sel!.getRangeAt(0);
      placePop(text, range.getBoundingClientRect());
    };
    const up = () => setTimeout(check, 0);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchend', up);
    return () => {
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchend', up);
    };
  }, []);

  // Wiki-link clicks inside article body (delegate)
  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const linkEl = t.closest('.link') as HTMLElement | null;
      if (!linkEl) return;
      const target = linkEl.getAttribute('data-target');
      if (target) {
        e.preventDefault();
        onNavigate('article', target);
      }
    };
    node.addEventListener('click', onClick);
    return () => node.removeEventListener('click', onClick);
  }, [onNavigate]);

  return (
    <div className="main-inner">
      <div className="art-meta">
        <span className={`art-kind ${article.kind.toLowerCase()}`}>
          <span className="k-glyph"/>{article.kind}
        </span>
        <span className="sep">·</span>
        <span>{article.updated_by ? `updated by ${article.updated_by}` : 'updated'}</span>
        <span className="sep">·</span>
        <span>{article.readingTime} read</span>
        <span className="sep">·</span>
        <span className="conf">conf
          <span className="conf-bar"><span className="fill" style={{width:`${article.confidence*100}%`}}/></span>
          {Math.round(article.confidence*100)}%
        </span>
      </div>

      <h1 className="art-title">{article.title}</h1>
      {article.aka.length > 0 && (
        <div className="art-aka">
          <span className="label">also known as</span>
          {article.aka.map((a, i) => <span key={i} className="alias">{a}{i < article.aka.length-1 ? ' ·' : ''}</span>)}
        </div>
      )}
      {article.sourceList.length === 1 && article.sourceList[0].url && (
        <div className="art-source-pin">
          <span className="label">source</span>
          <a href={article.sourceList[0].url} target="_blank" rel="noopener noreferrer" className="art-source-link">
            {hostOf(article.sourceList[0].url)}
          </a>
        </div>
      )}

      {article.kind === 'Synthesis' && <SynthesisFeedback articleId={article.id}/>}

      <p className="art-summary" dangerouslySetInnerHTML={{ __html: article.summary }}/>

      <div className="art-stats">
        <div className="art-stat"><div className="v">{article.sources}</div><div className="l">Sources</div></div>
        <div className="art-stat"><div className="v">{article.backlinks}</div><div className="l">Backlinks</div></div>
        <div className="art-stat"><div className="v">{article.forwardlinks}</div><div className="l">Forward links</div></div>
        <div className="art-stat"><div className="v">{article.related.length}</div><div className="l">Related concepts</div></div>
      </div>

      <div className="art-body" ref={bodyRef}>
        {article.sections.map((s, i) => {
          if (s.kind === 'callout') return (
            <div key={i} className="callout">
              <h2>{s.h}</h2>
              <p dangerouslySetInnerHTML={{ __html: s.body }}/>
            </div>
          );
          if (s.kind === 'open') return (
            <div key={i} className="open">
              <h2>{s.h}</h2>
              <p dangerouslySetInnerHTML={{ __html: s.body }}/>
            </div>
          );
          return (
            <div key={i}>
              <h2>{s.h}</h2>
              <p dangerouslySetInnerHTML={{ __html: s.body }}/>
            </div>
          );
        })}
      </div>

      {article.sourceList.length > 0 && (
        <div className="art-sources">
          <h3>Sources used in this page</h3>
          {article.sourceList.map((s, i) => (
            <div key={i} className="src-row">
              <div className="src-kind">{s.kind}</div>
              {s.url ? (
                <a className="src-title src-link" href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title || s.url}
                </a>
              ) : (
                <div className="src-title">{s.title}</div>
              )}
              <div className="src-date">{s.date}</div>
            </div>
          ))}
        </div>
      )}

      {pop && (
        <div className="ask-pop" style={{ left: pop.x, top: pop.y }} onMouseDown={(e) => e.preventDefault()}>
          <button onClick={() => { onAsk(`What does "${pop.text}" mean here?`, pop.text); setPop(null); }}>
            {Icon.ask} Ask
          </button>
          <div className="sep"/>
          <button onClick={() => { onAsk(`Expand on: ${pop.text}`, pop.text); setPop(null); }}>
            {Icon.expand} Expand
          </button>
          <div className="sep"/>
          <button onClick={() => setPop(null)}>
            {Icon.link} Find related
          </button>
        </div>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
