export function normalizeVaultRelativePath(value: string): string {
	return value
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
}

export function joinVaultRelativePath(base: string, segment: string): string {
	const normalizedBase = normalizeVaultRelativePath(base);
	const normalizedSegment = normalizeVaultRelativePath(segment);
	if (!normalizedBase.length) {
		return normalizedSegment;
	}
	if (!normalizedSegment.length) {
		return normalizedBase;
	}
	return `${normalizedBase}/${normalizedSegment}`;
}

export function normalizeVaultPathForCompare(value: string): string {
	return normalizeVaultRelativePath(value).toLowerCase();
}

export function normalizeVaultFolderOrDefault(value: string | undefined, fallback: string): string {
	const normalized = normalizeVaultRelativePath(value ?? "");
	if (normalized.length) {
		return normalized;
	}
	return normalizeVaultRelativePath(fallback);
}
