import {DataAdapter} from "obsidian";

export async function ensureAdapterDirectory(adapter: DataAdapter, path: string): Promise<void> {
	if (!path.length) {
		return;
	}
	const parts = path.split("/").filter((part) => part.length);
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		const exists = await adapter.exists(current);
		if (!exists) {
			await adapter.mkdir(current);
		}
	}
}
