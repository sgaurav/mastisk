import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { GraphData, View } from '../types';

interface Props {
  onNavigate: (view: View, id?: string) => void;
}

interface Placed {
  id: string;
  title: string;
  kind: string;
  color: string;
  size: number;
  x: number;  // percent
  y: number;
}

// Deterministic hash so layout is stable per-article.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const CLUSTER_CENTERS: Record<string, [number, number]> = {
  Concept:   [0.32, 0.40],
  Synthesis: [0.68, 0.38],
  Entity:    [0.72, 0.74],
  Source:    [0.30, 0.76],
};

export function GraphView({ onNavigate }: Props) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    api.graph().then(setData).catch((e) => setError(String(e)));
  }, []);

  const placed: Placed[] = useMemo(() => {
    if (!data) return [];
    // Group by kind, place each in its quadrant with a small hash-randomized
    // offset so clusters are readable without a real force layout.
    return data.nodes.map((n) => {
      const center = CLUSTER_CENTERS[n.kind] ?? [0.5, 0.5];
      const h1 = hash(n.id);
      const h2 = hash(n.id + '#2');
      const angle = (h1 % 360) * (Math.PI / 180);
      const radius = 6 + (h2 % 18); // %
      return {
        id: n.id,
        title: n.title,
        kind: n.kind,
        color: n.color,
        size: n.size,
        x: center[0] * 100 + Math.cos(angle) * radius,
        y: center[1] * 100 + Math.sin(angle) * radius,
      };
    });
  }, [data]);

  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);

  if (error) return <div className="view"><div className="view-h">Graph</div><p className="view-sub">Error: {error}</p></div>;
  if (!data) return <div className="view"><div className="view-h">Graph</div><p className="view-sub">loading…</p></div>;

  if (data.stats.pages === 0) {
    return (
      <div className="view">
        <div className="view-h">System · Graph</div>
        <h1 className="view-title">Nothing to graph yet.</h1>
        <p className="view-sub">
          The knowledge graph is built from articles your agents compile. Add a feed, queue a
          video, or load the demo to see it populate. Each node is a page, each edge is a
          wiki-link between pages; clusters group by kind (Concept · Entity · Source · Synthesis).
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{padding:'24px 32px 16px',display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
        <div>
          <div className="view-h">System · Graph</div>
          <div style={{fontFamily:'var(--serif)',fontSize:28,fontWeight:500,lineHeight:1.1}}>
            {data.stats.pages.toLocaleString()} {data.stats.pages === 1 ? 'page' : 'pages'} ·{' '}
            {data.stats.connections.toLocaleString()} {data.stats.connections === 1 ? 'connection' : 'connections'}
          </div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:6,flexWrap:'wrap'}}>
          {data.clusters.filter((c) => c.count > 0).map((c) => (
            <div key={c.kind} style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--fg-mute)',fontFamily:'var(--mono)',padding:'4px 10px',background:'var(--bg-elev)',borderRadius:14,border:'1px solid var(--line-soft)'}}>
              <span style={{width:8,height:8,borderRadius:'50%',background:c.color}}/>{c.kind} · {c.count}
            </div>
          ))}
        </div>
      </div>
      <div className="graph-canvas">
        <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>
          {data.edges.map((e, i) => {
            const a = byId.get(e.from_article);
            const b = byId.get(e.to_article);
            if (!a || !b) return null;
            return (
              <line key={i}
                x1={`${a.x}%`} y1={`${a.y}%`}
                x2={`${b.x}%`} y2={`${b.y}%`}
                stroke="var(--line)" strokeWidth="1"
                opacity={0.25 + 0.5 * e.weight}/>
            );
          })}
        </svg>
        {placed.map((n) => (
          <div key={n.id}
            style={{
              position:'absolute', left:`${n.x}%`, top:`${n.y}%`,
              transform:'translate(-50%,-50%)',
              width:n.size, height:n.size, borderRadius:'50%',
              background: n.size >= 22 ? n.color : 'var(--bg-card)',
              border: `1.5px solid ${n.color}`,
              cursor:'pointer',
              boxShadow: n.size >= 22 ? '0 0 0 4px var(--bg)' : 'none',
              transition: 'transform 0.12s',
              zIndex: hover === n.id ? 10 : 1,
            }}
            title={n.title}
            onMouseEnter={() => setHover(n.id)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onNavigate('article', n.id)}/>
        ))}
        {placed.filter((n) => n.size >= 22 || hover === n.id).map((n) => (
          <div key={`l-${n.id}`} style={{
            position:'absolute', left:`${n.x}%`, top:`calc(${n.y}% + ${n.size/2 + 8}px)`,
            transform:'translateX(-50%)',
            fontFamily:'var(--mono)', fontSize:10, color: hover === n.id ? 'var(--fg)' : 'var(--fg-mute)',
            whiteSpace:'nowrap', pointerEvents:'none',
            background: hover === n.id ? 'var(--bg-elev)' : 'transparent',
            padding: hover === n.id ? '2px 6px' : 0,
            borderRadius: 4,
          }}>{n.title}</div>
        ))}
      </div>
    </div>
  );
}
