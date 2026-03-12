export type Vec2 = { x: number; y: number };

export type CodeBlockModel = {
	id: string;
	// world coordinates
	pos: Vec2;
	size: Vec2;
	text: string;
	fileName?: string;
};

export type GraphNode = {
	id: string; // stable mermaid-safe-id
	label: string; // display label
};

export type GraphEdge = {
	from: string;
	to: string;
	label?: string;
};

export type TraceGraph = {
	nodes: Map<string, GraphNode>;
	edges: GraphEdge[];
	lastNodeId?: string;
};

const mermaidSafeId = (s: string) =>
	s.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "_$1");

export function createGraph(runId: string): TraceGraph {
	const g: TraceGraph = { nodes: new Map(), edges: [], lastNodeId: undefined };
	const startId = mermaidSafeId(`start_${runId}`);
	g.nodes.set(startId, { id: startId, label: `Start (${runId})` });
	g.lastNodeId = startId;
	return g;
}

export function addTraceSequenceStep(
	g: TraceGraph,
	step: { fn_name: string; file: string; line: number; event?: string }
) {
	const key = `${step.fn_name}`;
	const nodeId = mermaidSafeId(`fn_${key}`);

	if (!g.nodes.has(nodeId)) {
		g.nodes.set(nodeId, {
			id: nodeId,
			label: `${step.fn_name}\\n${basename(step.file)}:${step.line}`,
		});
	}

	const from = g.lastNodeId;
	const to = nodeId;

	const lastEdge = g.edges[g.edges.length - 1];
	if (!lastEdge || lastEdge.from != from || lastEdge.to !== to) {
		g.edges.push({
			from,
			to,
			label: step.event ? step.event : undefined,
		});
	}
	g.lastNodeId = to;
}

function basename(p: string) {
	const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
	return idx >= 0 ? p.slice(idx + 1) : p;
}

export function toMermaidFlowchart(g: TraceGraph): string {
	const lines: string[] = [];
	lines.push("flowchart LR");

	for (const n of g.nodes.values()) {
		lines.push(`	${n.id}["${escapeMermaidLabel(n.label)}"]`);
	}

	for (const e of g.edges) {
		if (e.label) {
			lines.push(`	${e.from} -->|${escapeMermaidLabel(e.label)}| ${e.to}`);
		} else {
			lines.push(`	${e.from} --> ${e.to}`);
		}
	}
	return lines.join("\n");
}

function escapeMermaidLabel(s: string) {
	return s.replace(/"/g, '\\"').replace(/\|/g, "\\|");
}

