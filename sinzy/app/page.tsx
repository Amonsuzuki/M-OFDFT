"use client";

// React hooks for lifecycle and DOM reference
import { useEffect, useRef, useState } from "react";

// import child functions
import type { CodeBlockModel, Vec2 } from "./infinite_canvas/types";
import { useCamera } from "./infinite_canvas/camera";
import { drawGridPoints } from "./infinite_canvas/gridRenderer";
import { attachPinchZoom, attachSafariGestureBlock, attachWheelZoom } from "./infinite_canvas/gestures";
import { startDrag } from "./infinite_canvas/drag";

import styles from "./infinite_canvas/InfiniteCanvas.module.css";

// Now I render canvas and code block separately, but Isn't it should be a static one component?
// browser default zooming is not deactivated except on canvas


const res = await fetch("http://127.0.0.1:8787/hello")
const text = await res.text();
console.log(text);

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

	// read /scratch
	useEffect(() => {
		fetch("http://127.0.0.1:8787/api/scratch")
		.then(res => res.json())
		.then(files => {
			setBlocks(files.map((f: any, i: number) => ({
				id: crypto.randomUUID(),
				pos: { x: i * 300, y: 0 },
				size: { x: 260, y: 160 },
				text: f.text
			})));
		});
	}, []);

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

		<div
		className={styles.worldLayer}
		style={{
			transform: `translate(${camera.offsetRef.current.x}px, ${camera.offsetRef.current.y}px) scale(${camera.scaleRef.current})`,
		}}
		>
		{blocks.map((b) => (
			<div
			key={b.id}
			className={styles.codeBlock}
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
				left: b.pos.x,
				top: b.pos.y,
				// base size in world units
				width: b.size.x,
				height: b.size.y,
				pointerEvents: "auto",
			}}
			>
			<textarea
			value={b.text}
			spellCheck={false}
			className={styles.codeEditor}
			onChange={(e) =>
				setBlocks((prev) =>
					  prev.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x))
					 )
			}
			onPointerDown={(e) => e.stopPropagation()}
			/>
			<button
			className={styles.deleteBtn}
			onPointerDown={(e) => e.stopPropagation()}
			onClick={() => RemoveBlock(b.id)}
			aria-label="Delete block"
			type="button"
			>
			×
			</button>
		</div>
		))}
		</div>
		</div>
	);
}

