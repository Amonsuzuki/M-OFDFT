import mermaid from "mermaid";
import { useEffect, useRef } from "react";

export function MermaidView({ text }: { text: string }) {
	const divRef = useRef<HTMLDivElement>(null);
	const renderSeq = useRef(0);

	useEffect(() => {
		if (!divRef.current) return;

		if (!text.trim()) {
			divRef.current.innerHTML = "";
			return;
		}

		let cancelled = false;
		const mySeq = ++renderSeq.current;

		(async () => {
			try {
				const id = `mmd-${mySeq}`;
				const { svg } = await mermaid.render(id, text);

				if (cancelled) return;
				if (mySeq !== renderSeq.current) return;

				divRef.current!.innerHTML = svg;
			} catch (e) {
				if (!cancelled) {
					divRef.current!.innerText = `Mermaid render error: ${String(e)}`;
				}
			}
		})();

		return () => {
			cancelled= true;
		};
	}, [text]);

	return <div ref={divRef} />;
}
