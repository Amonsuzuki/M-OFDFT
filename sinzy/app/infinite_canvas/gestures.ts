export function attachWheelZoom(params: {
	canvas: HTMLCanvasElement;
	zoomAt: (sx: number, sy: number, factor: number) => void;
	scheduleDraw: () => void;
	isActive?: () => boolean;
}) {
	const { canvas, zoomAt, scheduleDraw, isActive } = params;

	// Track whether pointer is over canvas
	//let hover = false;

	// Mouse wheel zoom handler
	const onWheel = (e: WheelEvent) => {
		if (isActive && !isActive()) return;

		// Prevent page scroll + browser zoom
		e.preventDefault();

		const zoomFactor = Math.exp(-e.deltaY * 0.001);
		zoomAt(e.clientX, e.clientY, zoomFactor);

		scheduleDraw();
		//bumpCamera();
	};

	// Register hover and wheel events
	canvas.addEventListener("wheel", onWheel, { passive: false });

	return () => {
		canvas.removeEventListener("wheel", onWheel as any);
	};
}

export function attachPinchZoom(params: {
	canvas: HTMLCanvasElement;
	zoomAt: (sx: number, sy: number, factor: number) => void;
	scheduleDraw: () => void;
	getScale: () => number;
}) {
	const { canvas, zoomAt, scheduleDraw, getScale } = params;

	// Active pointers for pinch zoom tracking
	// for smartphone
	const pointers = new Map<number, { x: number; y: number }>();
	let pinchStartDist = 0;
	let pinchStartScale = 1;
	let pinchCenter = { x: 0, y: 0 };

	// Compute distance between two points
	const dist = (a: { x: number; y: number }, b: {x: number; y: number }) => {
		const dx = a.x - b.x;
		const dy = a.y - b.y;
		return Math.hypot(dx, dy);
	};

	// Compute midpoint between two points
	const midpoint = (a: { x: number; y: number }, b: {x: number; y: number }) => ({
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
	});

	// Start tracking pointer for pinch gestures
	const onPointerDown = (e: PointerEvent) => {
		canvas.setPointerCapture(e.pointerId);
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		// Initialize pinch state when two pointers are active
		if (pointers.size === 2) {
			const [p1, p2] = Array.from(pointers.values());
			pinchStartDist = dist(p1, p2);
			pinchStartScale = getScale();
			pinchCenter = midpoint(p1, p2);
		}
	};

	// Update pinch zoom while pointers move
	const onPointerMove = (e: PointerEvent) => {
		if (!pointers.has(e.pointerId)) return;
		pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

		if (pointers.size === 2) {
			const [p1, p2] = Array.from(pointers.values());
			const d = dist(p1, p2);
			if (pinchStartDist > 0) {
				const nextScale = pinchStartScale * (d / pinchStartDist);
				const factor = nextScale / getScale();
				zoomAt(pinchCenter.x, pinchCenter.y, factor);
				scheduleDraw();
				//bumpCamera();
			}
		}
	};

	// Stop pinch tracking when pointer ends
	const onPointerUpOrCancel = (e: PointerEvent) => {
		if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
		pointers.delete(e.pointerId);
		if (pointers.size < 2) {
			pinchStartDist = 0;
		}
	};

	// Register pointer gesture handlers
	canvas.addEventListener("pointerdown", onPointerDown);
	canvas.addEventListener("pointermove", onPointerMove);
	canvas.addEventListener("pointerup", onPointerUpOrCancel);
	canvas.addEventListener("pointercancel", onPointerUpOrCancel);


	return () => {
		canvas.removeEventListener("pointerdown", onPointerDown);
		canvas.removeEventListener("pointermove", onPointerMove);
		canvas.removeEventListener("pointerup", onPointerUpOrCancel);
		canvas.removeEventListener("pointercancel", onPointerUpOrCancel);
	};
}

export function attachSafariGestureBlock(params: { activeRef: { current: boolean } }) {
	const { activeRef } = params;

	// Block safari gesture-based page zoom
	const blockGesture = (ev: Event) => {
		if (activeRef.current) ev.preventDefault();
	};

	// Safari gesture events
	window.addEventListener("gesturestart", blockGesture as any, { passive: false });
	window.addEventListener("gesturechange", blockGesture as any, { passive: false });
	window.addEventListener("gestureend", blockGesture as any, { passive: false });


	return () => {
		window.removeEventListener("gesturestart", blockGesture as any);
		window.removeEventListener("gesturechange", blockGesture as any);
		window.removeEventListener("gestureend", blockGesture as any);
	};
}


