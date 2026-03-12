import type { Camera } from "./camera";

export type GridOptions = {
	// both world units
	gridSize: number;
	pointRadius: number;
};

// Draw visible portion of the infinite grid
export function drawGridPoints(params: {
	ctx: CanvasRenderingContext2D;
	dpr: number;
	camera: Camera;
	viewportCss: { w: number; h: number };
	options: GridOptions;
}) {
	const { ctx, dpr, camera, viewportCss, options } = params;
	const { w, h } = viewportCss;
	const scale = camera.scaleRef.current;
	const { x: offsetX, y: offsetY } = camera.offsetRef.current;

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

	const { gridSize, pointRadius } = options;

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
			ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	ctx.restore();
}
