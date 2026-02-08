"use client";

// React hooks for lifecycle and DOM reference
import { useEffect, useRef, useState } from "react";

// import child functions
import type { CodeBlockModel, Vec2 } from "./infinite_canvas/types";
import { useCamera } from "./infinite_canvas/camera";
import { drawGridPoints } from "./infinite_canvas/gridRenderer";
import { attachPinchZoom, attachSafariGestureBlock, attachWheelZoom } from "./infinite_canvas/gestures";
import { startDrag } from "./infinite_canvas/drag";


// Now I render canvas and code block separately, but Isn't it should be a static one component?
// browser default zooming is not deactivated except on canvas

export default function InfiniteCanvas() {
	// Reference to the <canvas> DOM element
	const canvasRef = useRef<HTMLCanvasElement>(null);

	// hover
	const hoverRef = useRef(false);

	const { camera, worldToScreen, zoomAt } = useCamera({
		scale: 1,
		offset: { x: 0, y: 0 },
	});

	// useState persists across renders, but trigers re-render. so use for UI state like texts.
	const [blocks, setBlocks] = useState<CodeBlockModel[]>([]);
	const blocksRef = useRef(blocks);
	useEffect(() => { blocksRef.current = blocks; }, [blocks]);

	// Paste code block
	const AddBlock = (p: Vec2) => {
		setBlocks((prev) => [
			...prev,
			{ id: crypto.randomUUID(), pos: p, size: { x: 260, y: 160 }, text: "#include <bits/stdc++.h>" },
		]);
	};

	const RemoveBlock = (id: string) => {
		setBlocks(prev => prev.filter(b => b.id !== id));
	};

	useEffect(() => {
		// GEt canvas and 2D rendering context
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// device pixel ratio for HiDPI / Retina displays
		const dpr = window.devicePixelRatio || 1;

		// Grid spacing in world coordinates before scale. and size.
		const gridOptions = { gridSize: 50, pointRadius: 1.2 };

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

		const draw = () => {
			drawGridPoints({
				ctx,
				dpr,
				camera,
				viewportCss: { w: window.innerWidth, h: window.innerHeight },
				options: gridOptions,
			});
		};


		const onEnter = () => { hoverRef.current = true; };
		const onLeave = () => { hoverRef.current = false; };

		canvas.addEventListener("pointerenter", onEnter);
		canvas.addEventListener("pointerleave", onLeave);


		const cleanupWheel = attachWheelZoom({
			canvas,
			camera,
			zoomAt,
			scheduleDraw,
			isActive: () => hoverRef.current,
		});

		const cleanupPinch = attachPinchZoom({
			canvas,
			zoomAt,
			scheduleDraw,
			getScale: () => camera.scaleRef.current,
		});

		const cleanupSafari = attachSafariGestureBlock({ activeRef: hoverRef });

		// Handle window resize
		window.addEventListener("resize", resize);
		resize();

		// Cleanup all event listeners on unmount
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", resize);
			canvas.removeEventListener("pointerenter", onEnter);
			canvas.removeEventListener("pointerleave", onLeave);
			cleanupWheel();
			cleanupPinch();
			cleanupSafari();
		};
	}, [camera, zoomAt]);

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
		onClick={() => AddBlock({x: 12, y: 40})}
		style={{ position: "fixed", top: 12, left: 12, zIndex: 10 }}
		>
			Add code block
		</button>

		{/* DOM overlay */}
		{blocks.map((b) => {
			const p = worldToScreen(b.pos);
			const s = camera.scaleRef.current;
			return (
				<div
				key={b.id}
				onPointerDown={(e) =>
					startDrag({
						id: b.id,
						e,
						getBlocks: () => blocksRef.current,
						setBlocks,
						getScale: () => camera.scaleRef.current,
					})
				}
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

