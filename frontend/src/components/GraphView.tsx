import type { View } from '../types';

interface Cluster { name: string; color: string; center: [number, number]; nodes: string[]; }

const CLUSTERS: Cluster[] = [
  { name: 'TTC',    color: 'var(--kind-concept)', center: [0.30, 0.40], nodes: ['Test-time compute','Process reward models','MCTS','Self-consistency','Best-of-N','Verifier gap'] },
  { name: 'RL+LLM', color: 'var(--kind-synth)',   center: [0.65, 0.35], nodes: ['RL + LLMs','DPO','RLHF','Reward hacking','o-series','AlphaProof'] },
  { name: 'World',  color: 'var(--kind-entity)',  center: [0.70, 0.72], nodes: ['World models','Predictive coding','Genie','Sora','JEPA'] },
  { name: 'People', color: 'var(--kind-source)',  center: [0.28, 0.75], nodes: ['Karpathy','Sutton','LeCun','Hassabis','Altman'] },
];

interface NodeDef { label: string; color: string; cluster: number; x: number; y: number; size: number; }

export function GraphView(_: { onNavigate: (view: View, id?: string) => void }) {
  const allNodes: NodeDef[] = [];
  CLUSTERS.forEach((c, ci) => c.nodes.forEach((n, ni) => {
    const angle = (ni / c.nodes.length) * Math.PI * 2 + ci;
    const r = ni === 0 ? 0 : 8 + (ni % 3) * 3;
    allNodes.push({
      label: n, color: c.color, cluster: ci,
      x: c.center[0] * 100 + Math.cos(angle) * r,
      y: c.center[1] * 100 + Math.sin(angle) * r,
      size: ni === 0 ? 34 : 12 + (6 - ni) * 1.4,
    });
  }));
  const edges: [number, number][] = [];
  CLUSTERS.forEach((c, ci) => {
    const start = allNodes.findIndex((n) => n.cluster === ci);
    for (let i = start + 1; i < start + c.nodes.length; i++) edges.push([start, i]);
  });
  edges.push([0, 6], [6, 11], [0, 17], [10, 16], [11, 1]);

  return (
    <div>
      <div style={{padding:'24px 32px 16px',display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
        <div>
          <div className="view-h">System · Graph</div>
          <div style={{fontFamily:'var(--serif)',fontSize:28,fontWeight:500,lineHeight:1.1}}>522 pages · 1,847 connections</div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:6,flexWrap:'wrap'}}>
          {CLUSTERS.map((c, i) => (
            <div key={i} style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'var(--fg-mute)',fontFamily:'var(--mono)',padding:'4px 10px',background:'var(--bg-elev)',borderRadius:14,border:'1px solid var(--line-soft)'}}>
              <span style={{width:8,height:8,borderRadius:'50%',background:c.color}}/>{c.name}
            </div>
          ))}
        </div>
      </div>
      <div className="graph-canvas">
        <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>
          {edges.map(([a, b], i) => (
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
        {allNodes.filter((n) => n.size > 24).map((n, i) => (
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
