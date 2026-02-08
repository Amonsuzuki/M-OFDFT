export type Vec2 = { x: number; y: number };

export type CodeBlockModel = {
	id: string;
	// world coordinates
	pos: Vec2;
	size: Vec2;
	text: string;
};

