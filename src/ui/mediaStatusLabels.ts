import {MediaStatus} from "../types";

export const MEDIA_STATUS_LABELS: Record<MediaStatus, string> = {
	planned: "Planned",
	active: "Active",
	completed: "Completed",
	"on-hold": "On hold",
	dropped: "Dropped",
};
