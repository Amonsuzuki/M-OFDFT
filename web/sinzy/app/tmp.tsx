"use client";

import React, { useEffect, useRef, useState } from "react";

/** 1) Shared types */
export type Vec2 = { x: number; y: number };

export type CodeBlockModel = {
  id: string;
  pos: Vec2; // world coords
};

/** 2) Child component: ONLY renders one block (DOM) */
function CodeBlock(props: {
  left: number; // screen coords (CSS px)
  top: number;  // screen coords (CSS px)
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: props.left,
        top: props.top,
        width: 260,
        height: 160,
        background: "rgba(255,255,200,0.95)",
        border: "1px solid rgba(0,0,0,0.25)",
        borderRadius: 10,
        boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
      }}
    />
  );
}

/** 3) Parent component: canvas + camera + block list */
export default function InfiniteCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Camera (kept as refs for simplicity)
  const scaleRef = useRef(1);
  const offsetRef = useRef<Vec2>({ x: 0, y: 0 });

  const [blocks, setBlocks] = useState<CodeBlockModel[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      draw();
    };

    const draw = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;

      const scale = scaleRef.current;
      const { x: ox, y: oy } = offsetRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);

      const gridSize = 50;
      const x0 = -ox / scale;
      const y0 = -oy / scale;
      const x1 = x0 + w / scale;
      const y1 = y0 + h / scale;

      const startX = Math.floor(x0 / gridSize) * gridSize;
      const endX = Math.ceil(x1 / gridSize) * gridSize;
      const startY = Math.floor(y0 / gridSize) * gridSize;
      const endY = Math.ceil(y1 / gridSize) * gridSize;

      ctx.fillStyle = "#888";
      for (let x = startX; x <= endX; x += gridSize) {
        for (let y = startY; y <= endY; y += gridSize) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    };

    window.addEventListener("resize", resize);
    resize();
    return () => window.removeEventListener("resize", resize);
  }, []);

  /** world -> screen (for DOM overlay) */
  const worldToScreen = (p: Vec2): Vec2 => {
    const s = scaleRef.current;
    const o = offsetRef.current;
    return { x: p.x * s + o.x, y: p.y * s + o.y };
  };

  const pasteBlock = () => {
    setBlocks((prev) => [
      ...prev,
      { id: crypto.randomUUID(), pos: { x: 100, y: 100 } },
    ]);
  };

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, display: "block" }}
      />

      <button
        onClick={pasteBlock}
        style={{ position: "fixed", top: 12, left: 12, zIndex: 10 }}
      >
        Paste code block
      </button>

      {/* DOM overlay blocks */}
      {blocks.map((b) => {
        const s = worldToScreen(b.pos);
        return <CodeBlock key={b.id} left={s.x} top={s.y} />;
      })}
    </div>
  );
}

