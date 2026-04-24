import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import { api } from '../api';
import type { GraphData, View } from '../types';

interface Props {
  onNavigate: (view: View, id?: string) => void;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  title: string;
  kind: string;
  color: string;
  size: number;
  degree: number;
}

type SimLink = SimulationLinkDatum<SimNode> & { weight: number };

const CLUSTER_CENTERS: Record<string, [number, number]> = {
  Concept:   [0.32, 0.40],
  Synthesis: [0.68, 0.38],
  Entity:    [0.72, 0.74],
  Source:    [0.30, 0.76],
};

const WORLD_W = 1400;
const WORLD_H = 900;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 5;
const MINI_W = 180;
const MINI_H = 120;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function GraphView({ onNavigate }: Props) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 800, h: 600 });

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => (t + 1) % 1_000_000), []);
  const [prewarmed, setPrewarmed] = useState(false);
  const [layoutReady, setLayoutReady] = useState(false);

  useEffect(() => {
    api.graph().then(setData).catch((e) => setError(String(e)));
  }, []);

  // Build the simulation and run it to full cooling synchronously, off-screen.
  // 300 iterations matches d3-force's default schedule (alphaMin=0.001, alphaDecay≈0.0228)
  // so nodes arrive at their settled positions before the first paint — the user never
  // sees the simulation cool down in front of them.
  useLayoutEffect(() => {
    if (!data) return;
    const nodes: SimNode[] = data.nodes.map((n) => {
      const c = CLUSTER_CENTERS[n.kind] ?? [0.5, 0.5];
      const ang = (hash(n.id) % 360) * (Math.PI / 180);
      const r = 60 + (hash(n.id + '#r') % 40);
      return {
        id: n.id,
        title: n.title,
        kind: n.kind,
        color: n.color,
        size: n.size,
        degree: n.degree,
        x: c[0] * WORLD_W + Math.cos(ang) * r,
        y: c[1] * WORLD_H + Math.sin(ang) * r,
      };
    });
    const links: SimLink[] = data.edges.map((e) => ({
      source: e.from_article,
      target: e.to_article,
      weight: e.weight,
    }));

    const sim = forceSimulation<SimNode>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(90).strength(0.25),
      )
      .force('charge', forceManyBody<SimNode>().strength(-220))
      .force('collide', forceCollide<SimNode>((d) => d.size / 2 + 6))
      .force(
        'x',
        forceX<SimNode>((d) => (CLUSTER_CENTERS[d.kind] ?? [0.5, 0.5])[0] * WORLD_W).strength(0.06),
      )
      .force(
        'y',
        forceY<SimNode>((d) => (CLUSTER_CENTERS[d.kind] ?? [0.5, 0.5])[1] * WORLD_H).strength(0.06),
      )
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    // Wire React re-renders only AFTER pre-warm, so steady state is idle and
    // only user-driven restarts (node drag) cost reconciliation.
    sim.on('tick', bump);

    nodesRef.current = nodes;
    linksRef.current = links;
    simRef.current = sim;
    setPrewarmed(true);
    return () => {
      sim.stop();
      simRef.current = null;
      setPrewarmed(false);
      setLayoutReady(false);
    };
  }, [data, bump]);

  // Re-runs when the canvas first mounts (after data arrives) so we measure
  // against the real DOM synchronously, before the first paint of the graph.
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setViewport({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const fitToViewport = useCallback(() => {
    const nodes = nodesRef.current;
    if (!nodes.length || !viewport.w || !viewport.h) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (hiddenKinds.has(n.kind)) continue;
      const x = n.x ?? 0, y = n.y ?? 0, r = n.size / 2;
      if (x - r < minX) minX = x - r;
      if (y - r < minY) minY = y - r;
      if (x + r > maxX) maxX = x + r;
      if (y + r > maxY) maxY = y + r;
    }
    if (!isFinite(minX)) return;
    const pad = 48;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const z = clamp(Math.min(viewport.w / w, viewport.h / h), MIN_ZOOM, 1.5);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setZoom(z);
    setPan({ x: viewport.w / 2 - cx * z, y: viewport.h / 2 - cy * z });
  }, [viewport.w, viewport.h, hiddenKinds]);

  // One-shot synchronous fit after pre-warm + viewport measurement. No setTimeout,
  // no observable "snap" — fit lands in the same paint as the first node render.
  // Window resizes afterwards do NOT auto-refit (would yank the user's view).
  const firstFitRef = useRef(false);
  useLayoutEffect(() => {
    if (firstFitRef.current) return;
    if (!prewarmed || !nodesRef.current.length || !viewport.w || !viewport.h) return;
    firstFitRef.current = true;
    fitToViewport();
    setLayoutReady(true);
  }, [prewarmed, viewport.w, viewport.h, fitToViewport]);

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      setZoom((z) => {
        const nz = clamp(z * factor, MIN_ZOOM, MAX_ZOOM);
        setPan((p) => ({ x: cx - (cx - p.x) * (nz / z), y: cy - (cy - p.y) * (nz / z) }));
        return nz;
      });
    },
    [],
  );

  const handleWheel = (e: React.WheelEvent) => {
    if (!canvasRef.current) return;
    const r = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    zoomAt(Math.exp(-e.deltaY * 0.0015), cx, cy);
  };

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '+' || e.key === '=') {
        zoomAt(1.25, viewport.w / 2, viewport.h / 2);
        e.preventDefault();
      } else if (e.key === '-' || e.key === '_') {
        zoomAt(0.8, viewport.w / 2, viewport.h / 2);
        e.preventDefault();
      } else if (e.key === '0') {
        fitToViewport();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        setSearch('');
        setHoverNode(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomAt, fitToViewport, viewport.w, viewport.h]);

  const dragRef = useRef<
    | null
    | {
        mode: 'pan' | 'node-pending' | 'node' | 'minimap';
        sx: number;
        sy: number;
        origPan: { x: number; y: number };
        nodeId?: string;
        nodeStart?: { x: number; y: number };
      }
  >(null);

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = {
      mode: 'pan',
      sx: e.clientX,
      sy: e.clientY,
      origPan: { ...pan },
    };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onNodePointerDown = (e: React.PointerEvent, n: SimNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = {
      mode: 'node-pending',
      sx: e.clientX,
      sy: e.clientY,
      origPan: { ...pan },
      nodeId: n.id,
      nodeStart: { x: n.x ?? 0, y: n.y ?? 0 },
    };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;

    if (d.mode === 'node-pending' && Math.hypot(dx, dy) > 4 && d.nodeId) {
      const n = nodesRef.current.find((x) => x.id === d.nodeId);
      if (n) {
        n.fx = n.x;
        n.fy = n.y;
      }
      simRef.current?.alphaTarget(0.2).restart();
      d.mode = 'node';
    }

    if (d.mode === 'pan') {
      setPan({ x: d.origPan.x + dx, y: d.origPan.y + dy });
    } else if (d.mode === 'node' && d.nodeId && d.nodeStart) {
      const n = nodesRef.current.find((x) => x.id === d.nodeId);
      if (n) {
        n.fx = d.nodeStart.x + dx / zoom;
        n.fy = d.nodeStart.y + dy / zoom;
        bump();
      }
    } else if (d.mode === 'minimap' && canvasRef.current) {
      panToMinimap(e);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (d.mode === 'node-pending' && d.nodeId) {
      onNavigate('article', d.nodeId);
    } else if (d.mode === 'node' && d.nodeId) {
      const n = nodesRef.current.find((x) => x.id === d.nodeId);
      if (n) {
        n.fx = null;
        n.fy = null;
      }
      simRef.current?.alphaTarget(0).alpha(0.3).restart();
    }
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };

  const bboxRef = useMemo(() => {
    const nodes = nodesRef.current;
    if (!nodes.length) return { x: 0, y: 0, w: WORLD_W, h: WORLD_H };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const x = n.x ?? 0, y = n.y ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!isFinite(minX)) return { x: 0, y: 0, w: WORLD_W, h: WORLD_H };
    const pad = 60;
    return {
      x: minX - pad,
      y: minY - pad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
    };
  }, [data, layoutReady, hoverNode]); // recompute once settled positions exist (layoutReady), and on data changes

  const miniScale = Math.min(MINI_W / bboxRef.w, MINI_H / bboxRef.h);
  const miniOx = (MINI_W - bboxRef.w * miniScale) / 2 - bboxRef.x * miniScale;
  const miniOy = (MINI_H - bboxRef.h * miniScale) / 2 - bboxRef.y * miniScale;
  const worldToMini = (x: number, y: number) => ({
    x: x * miniScale + miniOx,
    y: y * miniScale + miniOy,
  });

  function panToMinimap(e: React.PointerEvent) {
    const tgt = e.currentTarget as Element;
    const r = tgt.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const worldX = (mx - miniOx) / miniScale;
    const worldY = (my - miniOy) / miniScale;
    setPan({ x: viewport.w / 2 - worldX * zoom, y: viewport.h / 2 - worldY * zoom });
  }

  const onMinimapPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = {
      mode: 'minimap',
      sx: e.clientX,
      sy: e.clientY,
      origPan: { ...pan },
    };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    panToMinimap(e);
  };

  const neighbors = useMemo(() => {
    const s = new Set<string>();
    if (!hoverNode || !data) return s;
    for (const e of data.edges) {
      if (e.from_article === hoverNode) s.add(e.to_article);
      else if (e.to_article === hoverNode) s.add(e.from_article);
    }
    return s;
  }, [hoverNode, data]);

  const searchLC = search.trim().toLowerCase();
  const hasFocus = !!hoverNode || !!searchLC;

  const isNodeDimmed = (n: SimNode) => {
    if (hoverNode) return !(n.id === hoverNode || neighbors.has(n.id));
    if (searchLC) return !n.title.toLowerCase().includes(searchLC);
    return false;
  };

  const toggleKind = (k: string) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  if (error) {
    return (
      <div className="view">
        <div className="view-h">Graph</div>
        <p className="view-sub">Error: {error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="view">
        <div className="view-h">Graph</div>
        <p className="view-sub">loading…</p>
      </div>
    );
  }
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

  const nodes = nodesRef.current;
  const links = linksRef.current;

  // A label shows when the node's on-screen radius is big enough to anchor it,
  // or when it's actively emphasized (hover, search match, major hub).
  const hoverEdgeData = hoverEdge != null ? links[hoverEdge] : null;

  return (
    <div>
      <div className="graph-header">
        <div>
          <div className="view-h">System · Graph</div>
          <div className="graph-title">
            {data.stats.pages.toLocaleString()} {data.stats.pages === 1 ? 'page' : 'pages'} ·{' '}
            {data.stats.connections.toLocaleString()}{' '}
            {data.stats.connections === 1 ? 'connection' : 'connections'}
          </div>
        </div>
        <div className="graph-toolbar">
          <input
            className="graph-search"
            type="search"
            placeholder="Search pages…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="graph-chips">
            {data.clusters
              .filter((c) => c.count > 0)
              .map((c) => {
                const off = hiddenKinds.has(c.kind);
                return (
                  <button
                    key={c.kind}
                    type="button"
                    className={`graph-chip${off ? ' is-off' : ''}`}
                    onClick={() => toggleKind(c.kind)}
                    aria-pressed={!off}
                    title={`${off ? 'Show' : 'Hide'} ${c.kind}`}
                  >
                    <span className="graph-chip-dot" style={{ background: c.color }} />
                    {c.kind} · {c.count}
                  </button>
                );
              })}
          </div>
        </div>
      </div>

      <div
        ref={canvasRef}
        className={`graph-canvas${layoutReady ? ' is-ready' : ''}`}
        onWheel={handleWheel}
        onPointerDown={onCanvasPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ cursor: dragRef.current?.mode === 'pan' ? 'grabbing' : 'grab' }}
      >
        <svg className="graph-svg">
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {layoutReady && links.map((e, i) => {
              const a = e.source as SimNode;
              const b = e.target as SimNode;
              if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return null;
              if (hiddenKinds.has(a.kind) || hiddenKinds.has(b.kind)) return null;
              const incident =
                hoverNode != null && (a.id === hoverNode || b.id === hoverNode);
              const dim = hasFocus && !incident;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={incident ? 'var(--accent)' : 'var(--line)'}
                  strokeWidth={incident ? 1.6 : 1}
                  opacity={dim ? 0.05 : 0.2 + 0.55 * e.weight}
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: 'stroke' }}
                  onMouseEnter={() => setHoverEdge(i)}
                  onMouseLeave={() => setHoverEdge((v) => (v === i ? null : v))}
                />
              );
            })}
            {layoutReady && nodes.map((n) => {
              if (hiddenKinds.has(n.kind)) return null;
              const dim = isNodeDimmed(n);
              const active = hoverNode === n.id;
              return (
                <circle
                  key={n.id}
                  cx={n.x ?? 0}
                  cy={n.y ?? 0}
                  r={n.size / 2}
                  fill={n.size >= 22 ? n.color : 'var(--bg-card)'}
                  stroke={n.color}
                  strokeWidth={active ? 2.5 : 1.5}
                  opacity={dim ? 0.18 : 1}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: 'pointer', transition: 'opacity 0.12s' }}
                  onPointerDown={(e) => onNodePointerDown(e, n)}
                  onMouseEnter={() => setHoverNode(n.id)}
                  onMouseLeave={() => setHoverNode((v) => (v === n.id ? null : v))}
                />
              );
            })}
          </g>
        </svg>

        <div className="graph-labels">
          {layoutReady && nodes.map((n) => {
            if (hiddenKinds.has(n.kind)) return null;
            const active = hoverNode === n.id;
            const matches = !!searchLC && n.title.toLowerCase().includes(searchLC);
            const majorHub = n.size >= 34;
            // On-screen diameter threshold: a node needs ~16px visual size to earn a label.
            const bigEnough = n.size * zoom >= 16;
            if (!(active || matches || majorHub || bigEnough)) return null;
            const x = (n.x ?? 0) * zoom + pan.x;
            const y = (n.y ?? 0) * zoom + pan.y + (n.size / 2) * zoom + 6;
            return (
              <div
                key={`l-${n.id}`}
                className={`graph-label${active ? ' is-active' : ''}${matches ? ' is-match' : ''}`}
                style={{ left: x, top: y }}
              >
                {n.title}
              </div>
            );
          })}
        </div>

        {hoverEdgeData &&
          (() => {
            const a = hoverEdgeData.source as SimNode;
            const b = hoverEdgeData.target as SimNode;
            if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return null;
            const mx = ((a.x ?? 0) + (b.x ?? 0)) / 2 * zoom + pan.x;
            const my = ((a.y ?? 0) + (b.y ?? 0)) / 2 * zoom + pan.y;
            return (
              <div className="graph-edge-tip" style={{ left: mx, top: my }}>
                {a.title} ↔ {b.title}
                <span className="graph-edge-tip-w">· weight {hoverEdgeData.weight.toFixed(2)}</span>
              </div>
            );
          })()}

        <div className="graph-controls" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="graph-ctrl"
            onClick={() => zoomAt(1.25, viewport.w / 2, viewport.h / 2)}
            title="Zoom in (+)"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="graph-ctrl"
            onClick={() => zoomAt(0.8, viewport.w / 2, viewport.h / 2)}
            title="Zoom out (−)"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="graph-ctrl"
            onClick={() => fitToViewport()}
            title="Fit (0)"
            aria-label="Fit to view"
          >
            ⌂
          </button>
          <div className="graph-zoom-pct">{Math.round(zoom * 100)}%</div>
        </div>

        <svg
          className="graph-minimap"
          width={MINI_W}
          height={MINI_H}
          onPointerDown={onMinimapPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <rect x={0} y={0} width={MINI_W} height={MINI_H} className="graph-minimap-bg" />
          {layoutReady && links.map((e, i) => {
            const a = e.source as SimNode;
            const b = e.target as SimNode;
            if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return null;
            if (hiddenKinds.has(a.kind) || hiddenKinds.has(b.kind)) return null;
            const pA = worldToMini(a.x ?? 0, a.y ?? 0);
            const pB = worldToMini(b.x ?? 0, b.y ?? 0);
            return <line key={i} x1={pA.x} y1={pA.y} x2={pB.x} y2={pB.y} className="graph-minimap-edge" />;
          })}
          {layoutReady && nodes.map((n) => {
            if (hiddenKinds.has(n.kind)) return null;
            const p = worldToMini(n.x ?? 0, n.y ?? 0);
            return <circle key={n.id} cx={p.x} cy={p.y} r={Math.max(1.2, n.size * miniScale / 2)} fill={n.color} />;
          })}
          {layoutReady && (() => {
            const x1 = (-pan.x) / zoom;
            const y1 = (-pan.y) / zoom;
            const w = viewport.w / zoom;
            const h = viewport.h / zoom;
            const p1 = worldToMini(x1, y1);
            const p2 = worldToMini(x1 + w, y1 + h);
            return (
              <rect
                x={p1.x}
                y={p1.y}
                width={p2.x - p1.x}
                height={p2.y - p1.y}
                className="graph-minimap-view"
              />
            );
          })()}
        </svg>

        <div className="graph-hint" aria-hidden>
          scroll = zoom · drag bg = pan · drag node = move · + − 0 = zoom/fit
        </div>
      </div>
    </div>
  );
}
