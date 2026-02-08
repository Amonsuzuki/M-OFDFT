import { useCallback, useMemo, useRef, useState } from "react";
import type { Vec2 } from "./types";

export type Camera = {
	scaleRef: React.MutableRefObject<number>;
	offsetRef: React.MutableRefObject<Vec2>;
};

export function useCamera(initial?: { scale?: number; offset?: Vec2 }) {
	const scaleRef = useRef(initial?.scale ?? 1);
	const offsetRef = useRef<Vec2>(initial?.offset ?? { x: 0, y: 0 });

	const [cameraSnapshot, setCameraSnapshot] = useState(() => ({
		scale: scaleRef.current,
		offset: offsetRef.current,
	}));

	const syncSnapshot = () => {
		setCameraSnapshot({ scale: scaleRef.current, offset: offsetRef.current });
	};

	// convert screen (CSS px) to world coordinates
	const screenToWorld = useCallback((sx: number, sy: number) => {
		const scale = scaleRef.current
		const { x: offsetX, y: offsetY } = offsetRef.current;

		return {
			x: (sx - offsetX) / scale,
			y: (sy - offsetY) / scale,
		};
	}, []);

	// World to screen
	const worldToScreen = useCallback((p: Vec2): Vec2 => {
		const s = scaleRef.current;
		const o = offsetRef.current;
		return { x: p.x * s + o.x, y: p.y * s + o.y };
	}, []);

	// zoom around a fixed screen point (cursor-centered zoom)
	const zoomAt = useCallback((sx: number, sy: number, zoomFactor: number) => {
		const before = screenToWorld(sx, sy);

		// Clamp zoom scale
		const nextScale = Math.max(0.1, Math.min(scaleRef.current * zoomFactor, 10));

		// Update zoom level
		scaleRef.current = nextScale;

		//const after = screenToWorld(sx, sy);

		// Adjust offset so that world point under cursor stays fixed
		offsetRef.current = {
			x: sx - before.x * nextScale,
			y: sy - before.y * nextScale,
		};

		syncSnapshot();

	}, [screenToWorld]);

	const api: Camera = useMemo(() => ({ scaleRef, offsetRef }), []);

	return { camera: api, screenToWorld, worldToScreen, zoomAt };
}


