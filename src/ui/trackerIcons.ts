function createSvg(viewBox = "0 0 24 24"): SVGSVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", viewBox);
	svg.setAttribute("aria-hidden", "true");
	return svg;
}

export function createRefreshIcon(): SVGSVGElement {
	const svg = createSvg();
	svg.classList.add("media-tracker__refresh-icon");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute(
		"d",
		"M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 .34-.03.67-.08 1h2.02c.04-.33.06-.66.06-1 0-4.42-3.58-8-8-8zm-6 6c0-.34.03-.67.08-1H4.06c-.04.33-.06.66-.06 1 0 4.42 3.58 8 8 8v3l4-4-4-4v3c-3.31 0-6-2.69-6-6z",
	);
	path.setAttribute("fill", "currentColor");
	svg.appendChild(path);
	return svg;
}

export function createUpdateLogIcon(): SVGSVGElement {
	const svg = createSvg();
	svg.classList.add("media-tracker__update-log-icon");

	const top = document.createElementNS("http://www.w3.org/2000/svg", "line");
	top.setAttribute("x1", "6");
	top.setAttribute("y1", "7");
	top.setAttribute("x2", "18");
	top.setAttribute("y2", "7");
	top.setAttribute("stroke", "currentColor");
	top.setAttribute("stroke-width", "2");
	top.setAttribute("stroke-linecap", "round");
	svg.appendChild(top);

	const middle = document.createElementNS("http://www.w3.org/2000/svg", "line");
	middle.setAttribute("x1", "6");
	middle.setAttribute("y1", "12");
	middle.setAttribute("x2", "18");
	middle.setAttribute("y2", "12");
	middle.setAttribute("stroke", "currentColor");
	middle.setAttribute("stroke-width", "2");
	middle.setAttribute("stroke-linecap", "round");
	svg.appendChild(middle);

	const bottom = document.createElementNS("http://www.w3.org/2000/svg", "line");
	bottom.setAttribute("x1", "6");
	bottom.setAttribute("y1", "17");
	bottom.setAttribute("x2", "18");
	bottom.setAttribute("y2", "17");
	bottom.setAttribute("stroke", "currentColor");
	bottom.setAttribute("stroke-width", "2");
	bottom.setAttribute("stroke-linecap", "round");
	svg.appendChild(bottom);

	return svg;
}

export function createCleanupIcon(): SVGSVGElement {
	const svg = createSvg();
	svg.classList.add("media-tracker__cleanup-icon");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute(
		"d",
		"m19.36 2.72l1.42 1.42l-5.72 5.71c1.07 1.54 1.22 3.39.32 4.59L9.06 8.12c1.2-.9 3.05-.75 4.59.32zM5.93 17.57c-2.01-2.01-3.24-4.41-3.58-6.65l4.88-2.09l7.44 7.44l-2.09 4.88c-2.24-.34-4.64-1.57-6.65-3.58",
	);
	path.setAttribute("fill", "currentColor");
	svg.appendChild(path);
	return svg;
}

export function createGitCommitIcon(): SVGSVGElement {
	const svg = createSvg();
	svg.classList.add("media-tracker__commit-icon");

	const center = document.createElementNS("http://www.w3.org/2000/svg", "circle");
	center.setAttribute("cx", "12");
	center.setAttribute("cy", "12");
	center.setAttribute("r", "4");
	center.setAttribute("fill", "none");
	center.setAttribute("stroke", "currentColor");
	center.setAttribute("stroke-width", "2");
	svg.appendChild(center);

	const left = document.createElementNS("http://www.w3.org/2000/svg", "line");
	left.setAttribute("x1", "3");
	left.setAttribute("y1", "12");
	left.setAttribute("x2", "8");
	left.setAttribute("y2", "12");
	left.setAttribute("stroke", "currentColor");
	left.setAttribute("stroke-width", "2");
	left.setAttribute("stroke-linecap", "round");
	svg.appendChild(left);

	const right = document.createElementNS("http://www.w3.org/2000/svg", "line");
	right.setAttribute("x1", "16");
	right.setAttribute("y1", "12");
	right.setAttribute("x2", "21");
	right.setAttribute("y2", "12");
	right.setAttribute("stroke", "currentColor");
	right.setAttribute("stroke-width", "2");
	right.setAttribute("stroke-linecap", "round");
	svg.appendChild(right);

	return svg;
}
