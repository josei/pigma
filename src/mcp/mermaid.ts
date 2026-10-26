/**
 * Mermaid flowchart subset → Pigma diagram.
 *
 * Supports `graph`/`flowchart` with direction TD/TB/LR/RL, node shapes
 * `A[Label]`, `A(Label)`, `A{Label}`, `A((Label))`, and edges
 * `A --> B`, `A --- B`, `A -.-> B`, `A ==> B`, with optional `|label|` text.
 * Anything else (sequence/state/ER/gantt/architecture, subgraphs, styling
 * directives) is reported as unsupported rather than approximated.
 */
export interface MermaidNode {
  id: string;
  label: string;
  shape: 'RECT' | 'ROUND' | 'DIAMOND' | 'ELLIPSE';
}

export interface MermaidEdge {
  from: string;
  to: string;
  label?: string;
}

export interface MermaidDiagram {
  direction: 'TD' | 'LR' | 'RL' | 'BT';
  nodes: MermaidNode[];
  edges: MermaidEdge[];
  unsupported: string[];
}

const DIRECTIONS: Record<string, MermaidDiagram['direction']> = {
  TD: 'TD',
  TB: 'TD',
  BT: 'BT',
  LR: 'LR',
  RL: 'RL',
};

const SHAPES: Array<{ open: string; close: string; shape: MermaidNode['shape'] }> = [
  { open: '((', close: '))', shape: 'ELLIPSE' },
  { open: '{{', close: '}}', shape: 'DIAMOND' },
  { open: '[', close: ']', shape: 'RECT' },
  { open: '(', close: ')', shape: 'ROUND' },
  { open: '{', close: '}', shape: 'DIAMOND' },
];

function parseNodeToken(token: string, nodes: Map<string, MermaidNode>): string {
  const trimmed = token.trim();
  const match = /^([A-Za-z0-9_:-]+)\s*(.*)$/.exec(trimmed);
  if (!match) return trimmed;
  const id = match[1] as string;
  const rest = (match[2] ?? '').trim();
  if (rest.length === 0) {
    if (!nodes.has(id)) nodes.set(id, { id, label: id, shape: 'RECT' });
    return id;
  }
  for (const candidate of SHAPES) {
    if (rest.startsWith(candidate.open) && rest.endsWith(candidate.close)) {
      const label = rest.slice(candidate.open.length, rest.length - candidate.close.length).replace(/^"|"$/g, '');
      nodes.set(id, { id, label, shape: candidate.shape });
      return id;
    }
  }
  if (!nodes.has(id)) nodes.set(id, { id, label: id, shape: 'RECT' });
  return id;
}

export function parseMermaidFlowchart(source: string): MermaidDiagram {
  const diagram: MermaidDiagram = { direction: 'TD', nodes: [], edges: [], unsupported: [] };
  const nodes = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];
  const lines = source.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.replace(/%%!.*$/, '').trim();
    if (line.length === 0) continue;
    const header = /^(?:graph|flowchart)\s+([A-Za-z]{2})?\s*$/i.exec(line);
    if (header) {
      const key = (header[1] ?? 'TD').toUpperCase();
      diagram.direction = DIRECTIONS[key] ?? 'TD';
      if (!(key in DIRECTIONS)) diagram.unsupported.push(`direction ${key}`);
      continue;
    }
    if (/^(subgraph|end|classDef|class|style|linkStyle|click|direction)\b/i.test(line)) {
      diagram.unsupported.push(line.split(/\s+/)[0] as string);
      continue;
    }
    if (/^(sequenceDiagram|stateDiagram|erDiagram|gantt|journey|pie|classDiagram|mindmap|timeline|gitGraph)\b/i.test(line)) {
      // A different diagram family: stop parsing so the caller reports it
      // explicitly instead of building a bogus flowchart from its syntax.
      diagram.unsupported.push(line.split(/\s+/)[0] as string);
      diagram.nodes = [];
      diagram.edges = [];
      return diagram;
    }

    const edge = /^(.*?)\s*(-->|---|-.->|==>|-\.-)\s*(\|[^|]*\|)?\s*(.*)$/.exec(line);
    if (edge && edge[4] && edge[4].trim().length > 0) {
      const from = parseNodeToken(edge[1] ?? '', nodes);
      const to = parseNodeToken(edge[4] ?? '', nodes);
      const label = edge[3] ? edge[3].slice(1, -1).trim() : undefined;
      const entry: MermaidEdge = { from, to };
      if (label) entry.label = label;
      edges.push(entry);
      continue;
    }
    parseNodeToken(line, nodes);
  }

  diagram.nodes = [...nodes.values()];
  diagram.edges = edges;
  return diagram;
}

export interface DiagramPlacement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Lay nodes out in ranks along the flow direction. */
export function layoutDiagram(
  diagram: MermaidDiagram,
  options: { nodeWidth?: number; nodeHeight?: number; gap?: number } = {},
): { placements: Map<string, DiagramPlacement>; width: number; height: number } {
  const nodeWidth = options.nodeWidth ?? 160;
  const nodeHeight = options.nodeHeight ?? 64;
  const gap = options.gap ?? 60;

  const rank = new Map<string, number>();
  for (const node of diagram.nodes) rank.set(node.id, 0);
  // Longest-path ranking (bounded by node count so cycles terminate).
  for (let pass = 0; pass < diagram.nodes.length; pass++) {
    let changed = false;
    for (const edge of diagram.edges) {
      const from = rank.get(edge.from) ?? 0;
      const to = rank.get(edge.to) ?? 0;
      if (to < from + 1) {
        rank.set(edge.to, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byRank = new Map<number, string[]>();
  for (const node of diagram.nodes) {
    const level = rank.get(node.id) ?? 0;
    const bucket = byRank.get(level);
    if (bucket) bucket.push(node.id);
    else byRank.set(level, [node.id]);
  }

  const vertical = diagram.direction === 'TD' || diagram.direction === 'BT';
  const placements = new Map<string, DiagramPlacement>();
  const levels = [...byRank.keys()].sort((a, b) => a - b);
  let cross = 0;
  let main = 0;
  for (const level of levels) {
    const ids = byRank.get(level) ?? [];
    ids.forEach((id, index) => {
      const crossOffset = index * (nodeWidth + gap);
      const mainOffset = level * (nodeHeight + gap);
      const x = vertical ? crossOffset : mainOffset;
      const y = vertical ? mainOffset : crossOffset;
      placements.set(id, { id, x, y, width: nodeWidth, height: nodeHeight });
      cross = Math.max(cross, crossOffset + nodeWidth);
      main = Math.max(main, mainOffset + nodeHeight);
    });
  }
  return { placements, width: cross, height: main };
}
