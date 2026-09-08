export type StoryInputSource = { sourceType: "fact" | "contribution" | "transcript" | "memory_event"; sourceId: string };
export function validateStoryInputSources(value: unknown): StoryInputSource[] | null;
export function readStoryInputSources(row: { inputSourcesJson?: string | null }): StoryInputSource[] | null;
