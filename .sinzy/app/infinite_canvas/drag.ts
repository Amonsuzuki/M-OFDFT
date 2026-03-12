import type { Vec2, CodeBlockModel } from "./types";

export function startDrag(params: {
	id: string;
	e: React.PointerEvent;
	getBlocks: () => CodeBlockModel[];
	setBlocks: React.Dispatch<React.StateAction<CodeBlockModel[]>>;
	getScale: () => number;
}) {
	const { id, e, getBlocks, setBlocks, getScale } = params;

	e.stopPropagation();
	const el = e.currentTarget as HTMLElement;
	el.setPointerCapture(e.pointerId);

	const startScreen = { x: e.clientX, y: e.clientY };

	const start = getBlocks().find((b) => b.id === id);
	if (!start) return;

	const startPos: Vec2 = start.pos;
	const startScale = getScale();

	const onMove = (ev: PointerEvent) => {
		const dx = (ev.clientX - startScreen.x) / startScale;
		const dy = (ev.clientY - startScreen.y) / startScale;

		setBlocks((prev) =>
			  prev.map((b) => (b.id === id ? { ...b, pos: { x: startPos.x + dx, y: startPos.y + dy } } : b))
			 );
	};
	
	const cleanup = (ev: PointerEvent) => {
		window.removeEventListener("pointermove", onMove);
		window.removeEventListener("pointerup", cleanup);
		window.removeEventListener("pointercancel", cleanup);

		if (el.hasPointerCapture(ev.pointerId)) {
			el.releasePointerCapture(ev.pointerId);
		}
	};

	window.addEventListener("pointermove", onMove);
	window.addEventListener("pointerup", cleanup);
	window.addEventListener("pointercancel", cleanup);
};

