import {requestUrl, type RequestUrlParam, type RequestUrlResponse} from "obsidian";

export async function httpRequest(options: RequestUrlParam): Promise<RequestUrlResponse> {
	return requestUrl(options);
}

export async function httpRequestJson<T>(options: RequestUrlParam): Promise<T> {
	const response = await httpRequest(options);
	return response.json as T;
}
