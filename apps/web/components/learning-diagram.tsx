'use client';
import { useId } from 'react';
import type { LearningDiagram } from '@classroom/shared';

const nodeColors: Record<LearningDiagram['nodes'][number]['kind'], { fill: string; stroke: string; label: string }> = {
  start: { fill: '#edf6ee', stroke: '#4f8a61', label: 'Start' },
  process: { fill: '#f4f6f1', stroke: '#71806e', label: 'Process' },
  decision: { fill: '#fff7dc', stroke: '#a47a1f', label: 'Decision' },
  result: { fill: '#eaf4f0', stroke: '#287456', label: 'Result' },
  error: { fill: '#fff0eb', stroke: '#b45e49', label: 'Error path' },
  test: { fill: '#eef1fb', stroke: '#6577a8', label: 'Test' },
};

function layout(diagram: LearningDiagram) {
  const ids = new Set(diagram.nodes.map(node => node.id));
  const indegree = new Map(diagram.nodes.map(node => [node.id, 0]));
  const outgoing = new Map(diagram.nodes.map(node => [node.id, [] as string[]]));
  for (const edge of diagram.edges) if (ids.has(edge.from) && ids.has(edge.to)) { indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1); outgoing.get(edge.from)?.push(edge.to); }
  const levels = new Map<string, number>();
  const queue = diagram.nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id);
  if (!queue.length && diagram.nodes[0]) queue.push(diagram.nodes[0].id);
  for (const id of queue) levels.set(id, 0);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const target of outgoing.get(id) ?? []) {
      levels.set(target, Math.max(levels.get(target) ?? 0, (levels.get(id) ?? 0) + 1));
      indegree.set(target, (indegree.get(target) ?? 1) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  let fallback = Math.max(0, ...levels.values());
  for (const node of diagram.nodes) if (!levels.has(node.id)) levels.set(node.id, ++fallback);
  const groups = new Map<number, typeof diagram.nodes>();
  for (const node of diagram.nodes) { const level = levels.get(node.id) ?? 0; groups.set(level, [...(groups.get(level) ?? []), node]); }
  const width = 920; const yGap = 150; const nodeHeight = 76;
  const maxPerLevel = Math.max(...[...groups.values()].map(group => group.length));
  const nodeWidth = Math.max(120, Math.min(200, (width - 70) / maxPerLevel - 24));
  const positions = new Map<string, { x: number; y: number }>();
  for (const [level, nodes] of groups) nodes.forEach((node, index) => positions.set(node.id, { x: width * (index + 1) / (nodes.length + 1), y: 70 + level * yGap }));
  return { width, height: 140 + Math.max(...groups.keys()) * yGap, nodeWidth, nodeHeight, positions };
}

export default function LearningDiagramView({ diagram }: { diagram: LearningDiagram }) {
  const markerId = `diagram-arrow-${useId().replaceAll(':', '')}`;
  if (!diagram || !Array.isArray(diagram.nodes) || !Array.isArray(diagram.edges)) return <div className="error" role="alert">This flowchart uses an older response format. Restart both services and rebuild it.</div>;
  const { width, height, nodeWidth, nodeHeight, positions } = layout(diagram);
  return <figure className="learning-diagram">
    <figcaption><strong>{diagram.title}</strong><span>{diagram.summary}</span></figcaption>
    <div className="learning-diagram-scroll">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${markerId}-title ${markerId}-description`}>
        <title id={`${markerId}-title`}>{diagram.title}</title><desc id={`${markerId}-description`}>{diagram.summary}</desc>
        <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#7a897d"/></marker></defs>
        <g className="diagram-edges">{diagram.edges.map((edge, index) => { const from = positions.get(edge.from); const to = positions.get(edge.to); if (!from || !to) return null; const startY = from.y + nodeHeight / 2; const endY = to.y - nodeHeight / 2; const middleY = startY + (endY - startY) / 2; return <g key={`${edge.from}-${edge.to}-${index}`}><path d={`M ${from.x} ${startY} C ${from.x} ${middleY}, ${to.x} ${middleY}, ${to.x} ${endY}`} markerEnd={`url(#${markerId})`}/>{edge.label && <text x={(from.x + to.x) / 2} y={middleY - 7}>{edge.label}</text>}</g>; })}</g>
        <g className="diagram-nodes">{diagram.nodes.map(node => { const point = positions.get(node.id)!; const colors = nodeColors[node.kind]; const x = point.x - nodeWidth / 2; const y = point.y - nodeHeight / 2; return <g key={node.id}>{node.kind === 'decision' ? <polygon points={`${point.x},${y - 5} ${x + nodeWidth + 9},${point.y} ${point.x},${y + nodeHeight + 5} ${x - 9},${point.y}`} fill={colors.fill} stroke={colors.stroke}/> : <rect x={x} y={y} width={nodeWidth} height={nodeHeight} rx={node.kind === 'start' || node.kind === 'result' ? 30 : 12} fill={colors.fill} stroke={colors.stroke}/>}<foreignObject x={x + 8} y={y + 8} width={nodeWidth - 16} height={nodeHeight - 16}><div className="diagram-node-copy"><small>{colors.label}</small><span>{node.label}</span></div></foreignObject></g>; })}</g>
      </svg>
    </div>
  </figure>;
}
