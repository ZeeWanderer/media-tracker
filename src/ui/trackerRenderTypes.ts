import type {MediaStatus} from "../domain/media/config";
import type {MediaItem} from "../domain/media/models";

export type SortKey = "title" | "type" | "status" | "progress";
export type SortDirection = "asc" | "desc";

export type MediaItemLike = MediaItem;

export type RenderHandlers = {
	onOpenNote?: (item: MediaItemLike) => void;
	onContextMenu?: (event: MouseEvent, item: MediaItemLike) => void;
	onStatusChange?: (item: MediaItemLike, status: MediaStatus) => void;
	onProgressEdit?: (target: HTMLElement, item: MediaItemLike) => void;
	onProgressAdvance?: (target: HTMLElement, item: MediaItemLike, nextValue: string) => void;
	onLinkOpen?: (url: string) => void;
	getLinkIconUrl?: (value: string) => string | null;
};
