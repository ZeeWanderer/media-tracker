export function setAttrSafe(el: HTMLElement, name: string, value: string) {
	const maybe = (el as HTMLElement & {setAttr?: (key: string, val: string) => void}).setAttr;
	if (maybe) {
		maybe.call(el, name, value);
	} else {
		el.setAttribute(name, value);
	}
}
