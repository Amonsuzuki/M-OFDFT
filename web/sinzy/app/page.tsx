"use client";

// React hooks for lifecycle and DOM reference
import { useEffect, useRef, useState } from "react";

export type Vec2 = { x: number; y: number };

export type CodeBlockModel = {
	id: string;
	// world coordinates
	pos: Vec2;
	size: Vec2;
};

// Now I render canvas and code block separately, but Isn't it should be a static one component?

export default function InfiniteCanvas() {
	// Reference to the <canvas> DOM element
	const canvasRef = useRef<HTMLCanvasElement>(null);

	// Camera zoom scale and translation offsets in CSS pixels 
	// should be useRef for preventing reset when re-rendering
	const scaleRef = useRef(1);
	const offsetRef = useRef<Vec2>({ x: 0, y: 0 });

	// useState persists across renders, but trigers re-render. so use for UI state like texts.
	const [blocks, setBlocks] = useState<CodeBlockModel[]>([]);

	// update camera state version to render code blocks moving properly
	const [cameraVersion, setCameraVersion] = useState(0);
	const bumpCamera = () => setCameraVersion((v) => v + 1);

	useEffect(() => {
		// GEt canvas and 2D rendering context
		const canvas = canvasRef.current!;
		const ctx = canvas.getContext("2d")!;

		// device pixel ratio for HiDPI / Retina displays
		const dpr = window.devicePixelRatio || 1;

		// Grid spacing in world coordinates before scale
		const gridSize = 50;

		// requestAnimationFrame handle for draw throttling
		// request-response style. raf is a flag
		let raf = 0;

		// Schedule a single redraw using requestAnimationFrame
		const scheduleDraw = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(draw);
		};

		// Resize canvas to match window size and device pixel ratio
		const resize = () => {
			const w = window.innerWidth;
			const h = window.innerHeight;

			// set internal resolution in physical pixels
			canvas.width = Math.floor(w * dpr);
			canvas.height = Math.floor(h * dpr);

			// set displayed size in CSS pixels
			canvas.style.width = `${w}px`;
			canvas.style.height = `${h}px`;

			scheduleDraw();
		};

		// Draw visible portion of the infinite grid
		const draw = () => {
			const w = window.innerWidth;
			const h = window.innerHeight;

			const scale = scaleRef.current
			const { x: offsetX, y: offsetY } = offsetRef.current;

			// Reset transform to CSS pixel coordinates and clear screen
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, w, h);

			ctx.save();

			// Apply camera transform and zoom
			ctx.translate(offsetX, offsetY);
			ctx.scale(scale, scale);

			// compute visible bounds in world coordinates
			const x0 = (-offsetX) / scale;
			const y0 = (-offsetY) / scale;
			const x1 = x0 + w / scale;
			const y1 = y0 + h / scale;

			// draw grid lines over visible range
			// Snap grid start/end to gridSize
			const startX = Math.floor(x0 / gridSize) * gridSize;
			const endX = Math.ceil(x1 / gridSize) * gridSize;
			const startY = Math.floor(y0 / gridSize) * gridSize;
			const endY = Math.ceil(y1 / gridSize) * gridSize;

			// Grid point appearance
			ctx.fillStyle = "#888";

			// Draw grid points at intersections
			for (let x = startX; x <= endX; x += gridSize) {
				for (let y = startY; y <= endY; y += gridSize) {
					ctx.beginPath();
					ctx.arc(x, y, 1.2, 0, Math.PI * 2);
					ctx.fill();
				}
			}

			ctx.restore();
		};

		// convert screen (CSS px) to world coordinates
		const screenToWorld = (sx: number, sy: number) => {
			const scale = scaleRef.current
			const { x: offsetX, y: offsetY } = offsetRef.current;

			return {
				x: (sx - offsetX) / scale,
				y: (sy - offsetY) / scale,
			};
		};

		// zoom around a fixed screen point (cursor-centered zoom)
		const zoomAt = (sx: number, sy: number, zoomFactor: number) => {
			const before = screenToWorld(sx, sy);

			// Update zoom level
			scaleRef.current *= zoomFactor;

			// Clamp zoom scale
			scaleRef.current = Math.max(0.1, Math.min(scaleRef.current, 10));

			const after = screenToWorld(sx, sy);

			// Adjust offset so that world point under cursor stays fixed
			offsetRef.current.x += (after.x - before.x) * scaleRef.current;
			offsetRef.current.y += (after.y - before.y) * scaleRef.current;

			scheduleDraw();
			bumpCamera();
		};

		// Track whether pointer is over canvas
		let hover = false;
		const onEnter = () => (hover = true);
		const onLeave = () => (hover = false);

		// Mouse wheel zoom handler
		const onWheel = (e: WheelEvent) => {
			if (!hover) return;

			// Prevent page scroll + browser zoom
			e.preventDefault();

			const zoomFactor = Math.exp(-e.deltaY * 0.001);
			zoomAt(e.clientX, e.clientY, zoomFactor);
		};

		// Register hover and wheel events
		canvas.addEventListener("pointerenter", onEnter);
		canvas.addEventListener("pointerleave", onLeave);
		canvas.addEventListener("wheel", onWheel, { passive: false });

		// Active pointers for pinch zoom tracking
		// for smartphone
		const pointers = new Map<number, { x: number; y: number }>();
		let pinchStartDist = 0;
		let pinchStartScale = 1;
		let pinchCenter = { x: 0, y: 0 };

		// Compute distance between two points
		const dist = (a: { x: number; y: number }, b: {x: number; y: numnber }) => {
			const dx = a.x - b.x;
			const dy = a.y - b.y;
			return Math.hypot(dx, dy);
		};

		// Compute midpoint between two points
		const midpoint = (a: { x: number; y: number }, b: {x: number; y: numnber }) => ({
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
				pinchStartScale = scaleRef.current;
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
					const factor = nextScale / scaleRef.current;
					zoomAt(pinchCenter.x, pinchCenter.y, factor);
				}
			}
		};

		// Stop pinch tracking when pointer ends
		const onPointerUpOrCancel = (e: PointerEvent) => {
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

		// Block safari gesture-based page zoom
		const blockGesture = (ev: Event) => {
			if (hover) ev.preventDefault();
		};

		window.addEventListener("gesturestart", blockGesture as any, { passive: false });
		window.addEventListener("gestureschange", blockGesture as any, { passive: false });
		window.addEventListener("gestureend", blockGesture as any, { passive: false });

		// Handle window resize
		window.addEventListener("resize", resize);
		resize();

		// Cleanup all event listeners on unmount
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", resize);

			canvas.removeEventListener("pointerenter", onEnter);
			canvas.removeEventListener("pointerleave", onLeave);
			canvas.removeEventListener("wheel", onWheel as any);

			canvas.removeEventListener("pointerdown", onPointerDown);
			canvas.removeEventListener("pointermove", onPointerMove);
			canvas.removeEventListener("pointerup", onPointerUpOrCancel);
			canvas.removeEventListener("pointercancel", onPointerUpOrCancel);


			window.removeEventListener("gesturestart", blockGesture as any);
			window.removeEventListener("gestureschange", blockGesture as any);
			window.removeEventListener("gestureend", blockGesture as any);
		};
	}, []);

	// World to screen
	const worldToScreen = (p: Vec2): Vec2 => {
		const s = scaleRef.current;
		const o = offsetRef.current;
		return { x: p.x * s + o.x, y: p.y * s + o.y };
	};

	// Paste code block
	const pasteBlock = () => {
		setBlocks((prev) => [
			...prev,
			{ id: crypto.randomUUID(), pos: { x: 100, y: 100 }, size: { x: 260, y: 160 } },
		]);
	};

	// The canvas occupies the entire viewpoint and that all touch input is handled exclusively by JS, not by the browser.
	// paste block added.
	return (
		<div style={{ position: "fixed", inset: 0 }}>
		<canvas
		ref={canvasRef}
		style={{ position: "absolute", inset: 0, display: "block", touchAction: "none" }}
		/>
		
		{/* paste action */}
		<button
		onClick={pasteBlock}
		style={{ position: "fixed", top: 12, left: 12, zIndex: 10 }}
		>
			Paste code block
		</button>

		{/* DOM overlay */}
		{blocks.map((b) => {
			const p = worldToScreen(b.pos);
			const s = scaleRef.current;
			return (
				<div
				key={b.id}
				style={{
					position: "absolute",
					left: p.x,
					top: p.y,

					// base size in world units
					width: b.size.x,
					height: b.size.y,

					// scale with camera
					transform: `scale(${s})`,
					transformOrigin: "top left",

					background: "rgba(255,255,200,0.95)",
					border: "1px solid rgba(0,0,0,0.25)",
					borderRadius: 10,
					boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
					zIndex: 5,
				}}
				/>
			);
		})}
		</div>
	);
}

