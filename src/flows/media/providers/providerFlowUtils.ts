export function providerDelay(ms: number): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function sameNumberArray(a: number[] | undefined, b: number[] | undefined): boolean {
	const left = a ?? [];
	const right = b ?? [];
	if (left.length !== right.length) {
		return false;
	}
	return left.every((value, index) => value === right[index]);
}

export function sameNumberRecord(
	a: Record<string, number> | undefined,
	b: Record<string, number> | undefined,
): boolean {
	const leftEntries = Object.entries(a ?? {}).sort((x, y) => Number(x[0]) - Number(y[0]));
	const rightEntries = Object.entries(b ?? {}).sort((x, y) => Number(x[0]) - Number(y[0]));
	if (leftEntries.length !== rightEntries.length) {
		return false;
	}
	return leftEntries.every(([leftKey, leftVal], index) => {
		const [rightKey, rightVal] = rightEntries[index] ?? [];
		return leftKey === rightKey && leftVal === rightVal;
	});
}
