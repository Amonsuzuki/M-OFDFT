"use client";

// React hooks for lifecycle and DOM reference
import { useEffect, useMemo, useRef, useState } from "react";

import { openRunEvents, startRun, stopRun, type RunEvent } from "../backend/backend";

// mermaid flowchart
import mermaid from "mermaid";
import { createGraph, addTraceSequenceStep, toMermaidFlowchart } from "./types";
import { MermaidView } from "./MermaidView";


// import child functions
import type { CodeBlockModel, Vec2 } from "./types";
import { useCamera } from "./infinite_canvas/camera";
import { drawGridPoints } from "./infinite_canvas/gridRenderer";
import { attachPinchZoom, attachSafariGestureBlock, attachWheelPanZoom } from "./infinite_canvas/gestures";
import { startDrag } from "./infinite_canvas/drag";

import styles from "./infinite_canvas/InfiniteCanvas.module.css";

// Now I render canvas and code block separately, but Isn't it should be a static one component?
// browser default zooming is not deactivated except on canvas


const BASE_URL = "http://127.0.0.1:8787";

type RunState = {
	runId: string,
	blockId: string,
	logs: RunEvent[];
};

export default function InfiniteCanvas() {
	const [runState, setRunState] = useState<RunState | null>(null);
	const esRef = useRef<EventSource | null>(null);

	const appendEvent = (evt: RunEvent) => {
		setRunState((prev) => {
			if (!prev) return prev;
			return { ...prev, logs: [...prev.logs, evt] };
		});
	};

	const onRunBlock = async (blockId: string, fileName: string) => {
		try {
			console.log("[onRunBlock] starting", { blockId, fileName });

			esRef.current?.close();
			esRef.current = null;
			setRunState(null);

			const out = await startRun(BASE_URL, fileName);
			console.log("[onRunBlock] startRun response", out);

			const run_id = (out as any).run_id ?? (out as any).runId;
			if (!run_id) throw new Error("stateRun returned no run_id/runId");

			// create new graph per run
			graphRef.current = createGraph(run_id);
			setGraphVersion((v) => v + 1);

			setRunState({ runId: run_id, blockId, logs: [] });

			const es = openRunEvents(
				BASE_URL,
				run_id,
				(evt) => {
					console.log("[SSE event]", evt);
					appendEvent(evt);
					appendTraceToGraph(evt);

					if (evt.type == "exit") {
						esRef.current?.close();
						esRef.current = null;
					}
				},
				(err) => {
					console.error("[SSE error]", err);
					appendEvent({ type: "error", message: String(err) } as any);
				}
			);

			esRef.current = es;
			console.log("[onRunBlock] SSE opened");
		} catch (e: any) {
			console.error("[onRunBlock] failed", e);
			setRunState({ runId: "error", blockId, logs: [{ type: "error", message: String(e?.message ?? e) } as any] });
		}
	};

	const onStop = async () => {
		if (!runState) return;
		await stopRun(BASE_URL, runState.runId);
		esRef.current?.close();
		esRef.current = null;
	};

	// ensure SSE is closed on mount
	useEffect(() => {
		return () => {
			esRef.current?.close();
			esRef.current = null;
		};
	}, []);


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
			{
				id: crypto.randomUUID(),
				pos: p,
				size: { x: 260, y: 160 },
				text: 'print("hello")\n',
				fileName: "hello.py", // if it is undefined, onRunBlock doesn't work
			},
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
				fileName: f.name,
				pos: { x: i * 300, y: 0 },
				size: { x: 260, y: 160 },
				text: f.text
			})));
		});
	}, []);

	const graphRef = useRef<ReturnType<typeof createGraph> | null>(null);
	const [graphVersion, setGraphVersion] = useState(0);

	useEffect(() => {
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "strict",
		});
	}, []);

	const mermaidText = useMemo(() => {
		if (!graphRef.current) return "";
		return toMermaidFlowchart(graphRef.current);
	}, [graphVersion]);

	const appendTraceToGraph = (evt: RunEvent) => {
		if (evt.type !== "trace") return;
		if (!graphRef.current) return;

		const anyEvt = evt as any;
		const cmd = anyEvt.locals?.cmd as string | undefined;

		const label = (cmd ?? `${anyEvt.fn_name}:${anyEvt.line}`)
			.replace(/\s+/g, " ")
			.slice(0, 80)

		addTraceSequenceStep(graphRef.current, {
			fn_name: label,
			file: "shell",
			line: 0,
			event: "op",
		});

		requestGraphRender();
	};

	const pendingRef = useRef(false);

	const requestGraphRender = () => {
		if (pendingRef.current) return;
		pendingRef.current = true;
		requestAnimationFrame(() => {
			pendingRef.current = false;
			setGraphVersion((v) => v + 1);
		});
	};

	const appendTrace = (evt: RunEvent) => {
		if (evt.type !== "trace") return;
		if (!graphRef.current) return;
		addTraceSequenceStep(graphRef.current, { /* ... */ });
		requestGraphRender();
	};

	const [cameraVersion, setCameraVersion] = useState(0);
	const bumpCamera = () => setCameraVersion((v) => v + 1);

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

		const panBy = (dx: number, dy: number) => {
			camera.offsetRef.current.x += dx;
			camera.offsetRef.current.y += dy;
		};

		const cleanupWheel = attachWheelPanZoom({
			canvas,
			zoomAt,
			panBy,
			scheduleDraw,
			bumpCamera,
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
		data-camver={cameraVersion}
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
			<button
			type="button"
			onPointerDown={(e) => e.stopPropagation()}
			onClick={() => {
				console.log("[Run click]", { id: b.id, fileName: b.fileName });
				if (!b.fileName) {
					appendEvent({ type: "error", message: "This block has no file name. not loaded from /scratch." } as any);
					return;
				}
				onRunBlock(b.id, b.fileName);
			}}
			style={{ position: "absolute", right: 28, top: 6, zIndex: 2 }}
			>
			Run
			</button>
		</div>
		))}
		<div style={{ position: "fixed", right: 1, top: 240, zIndex: 20, width: 4200, height: 320, overflow: "auto", background: "white" }}>
		<MermaidView text={mermaidText} />
		</div>
		</div>

		</div>
	);
}

