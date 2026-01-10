import {MediaType, NewMediaDraft} from "../types";

export type NewMediaFieldConfig = {
	key: keyof NewMediaDraft;
	label: string;
	placeholder?: string;
	description?: string;
	inputType?: "text" | "number";
};

export const NEW_MEDIA_BASE_FIELDS: NewMediaFieldConfig[] = [
	{
		key: "title",
		label: "Title",
		placeholder: "Title",
	},
];

export const NEW_MEDIA_TYPE_FIELDS: Record<MediaType, NewMediaFieldConfig[]> = {
	novel: [
		{
			key: "author",
			label: "Author",
			placeholder: "Author",
		},
		{
			key: "progress",
			label: "Progress",
			description: "Chapter, volume, or other progress note.",
			placeholder: "1",
		},
	],
	series: [
		{
			key: "season",
			label: "Season",
			placeholder: "2",
			inputType: "number",
		},
		{
			key: "episode",
			label: "Episode",
			placeholder: "5",
			inputType: "number",
		},
	],
	movie: [
		{
			key: "year",
			label: "Year",
			placeholder: "2024",
			inputType: "number",
		},
	],
};
