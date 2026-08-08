import type {MediaStatus} from "../domain/media/config";
import type {MediaRecord} from "../domain/media/models";

export type SortKey = "title" | "type" | "status" | "progress";
export type SortDirection = "asc" | "desc";

export type MediaItemLike = MediaRecord;

export type RenderHandlers<TItem extends MediaItemLike = MediaItemLike> = {
	onOpenNote?: (item: TItem) => void;
	onCopyTitle?: (item: TItem) => void;
	onContextMenu?: (event: MouseEvent, item: TItem) => void;
	onStatusChange?: (item: TItem, status: MediaStatus) => void;
	onProgressEdit?: (target: HTMLElement, item: TItem) => void;
	onProgressAdvance?: (target: HTMLElement, item: TItem, nextValue: string) => void;
	onRepeatProgressEdit?: (target: HTMLElement, item: TItem) => void;
	onRepeatProgressAdvance?: (target: HTMLElement, item: TItem, nextValue: string) => void;
	onLinkOpen?: (url: string) => void;
	getLinkIconUrl?: (value: string) => string | null;
};
