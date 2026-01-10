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
		{
			key: "patreon",
			label: "Patreon URL",
			placeholder: "https://www.patreon.com/creator",
		},
		{
			key: "kemono",
			label: "Kemono URL",
			placeholder: "https://kemono.su/creator",
		},
		{
			key: "royalroad",
			label: "RoyalRoad URL",
			placeholder: "https://www.royalroad.com/fiction/12345",
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
		{
			key: "imdb",
			label: "IMDB ID or URL",
			placeholder: "tt1234567",
		},
	],
	movie: [
		{
			key: "year",
			label: "Year",
			placeholder: "2024",
			inputType: "number",
		},
		{
			key: "imdb",
			label: "IMDB ID or URL",
			placeholder: "tt1234567",
		},
	],
};
