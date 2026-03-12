export type RunEvent =
	| { type: "stdout"; data: string }
	| { type: "stderr"; data: string }
	| { type: "trace"; event: string; file: string; fn_name: string; line: number; locals: any }
	| { type: "exit"; code: number }
	| { type: "error"; message: string };


export async function startRun(baseUrl: string, name: string): Promise<{ run_id: string }> {
	const res = await fetch(`${baseUrl}/api/run`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`startRun failed: ${res.status} ${text}`);
	}

	return res.json();
}

export function openRunEvents(
	baseUrl: string,
	run_id: string,
	onEvent: (evt: RunEvent) => void,
	onError?: (err: any) => void
): EventSource {
	const es = new EventSource(`${baseUrl}/api/run/${run_id}/events`);

	es.onmessage = (msg) => {
		try {
			const evt = JSON.parse(msg.data) as RunEvent;
			onEvent(evt);
		} catch (e) {
			onError?.(e);
		}
	};

	es.onerror = (e) => {
		onError?.(e);
		es.close();
	};
	return es;
}

export async function stopRun(baseUrl: string, run_id: string): Promise<void> {
	const res = await fetch(`${baseUrl}/api/run/${run_id}/stop`, { method: "POST" });
	if (!res.ok && res.status !== 204) {
		const text = await res.text().catch(() => "");
		throw new Error(`stopRun failed: ${res.status} ${text}`);
	}
}
