import {Notice} from "obsidian";
import type {PluginLogger} from "../infra/logging/pluginLogger";

export type TaskLogContext = {
	scope?: string;
	event: string;
	startMessage?: string;
	successMessage?: string;
	meta?: Record<string, unknown>;
	logStart?: boolean;
	logSuccess?: boolean;
};

type RunLoggedTaskOptions = {
	logger: PluginLogger;
	defaultScope: string;
};

export function runLoggedTask(
	task: () => Promise<void>,
	errorMessage: string,
	options: RunLoggedTaskOptions,
	logContext?: TaskLogContext,
): Promise<boolean> {
	const scope = logContext?.scope ?? options.defaultScope;
	if (logContext?.logStart) {
		options.logger.info(
			scope,
			`${logContext.event}_started`,
			logContext.startMessage ?? "Started action.",
			logContext.meta,
		);
	}
	return task()
		.then(() => {
			if (!logContext || logContext.logSuccess === false) {
				return true;
			}
			options.logger.info(
				scope,
				`${logContext.event}_succeeded`,
				logContext.successMessage ?? "Completed action.",
				logContext.meta,
			);
			return true;
		})
		.catch((error) => {
			options.logger.error(scope, logContext ? `${logContext.event}_failed` : "task_failed", errorMessage, {
				...(logContext?.meta ?? {}),
				error: error instanceof Error ? error.message : String(error),
			});
			new Notice(errorMessage);
			return false;
		});
}
