import { isSafeJobType } from "@/lib/ai/jobs/validation";
import { transcribeAssetHandler } from "@/lib/ai/handlers/transcribe-asset";
import { analyzeAssetImageHandler } from "@/lib/ai/handlers/analyze-asset-image";
import { suggestEventMetadataHandler } from "@/lib/ai/handlers/suggest-event-metadata";
import { suggestInboxItemHandler } from "@/lib/ai/handlers/suggest-inbox-item";
import type { AiJobHandler } from "./types";

export {
  AiJobHandlerError,
  type AiJobCommit,
  type AiJobHandler,
  type AiJobHandlerContext,
  type AiJobHandlerResult,
} from "./types";

export class AiJobRegistry {
  readonly #handlers = new Map<string, AiJobHandler>();

  register(jobType: string, handler: AiJobHandler): this {
    if (!isSafeJobType(jobType)) throw new Error("invalid AI job type");
    if (this.#handlers.has(jobType)) {
      throw new Error(`AI job handler already registered: ${jobType}`);
    }
    this.#handlers.set(jobType, handler);
    return this;
  }

  get(jobType: string): AiJobHandler | undefined {
    return this.#handlers.get(jobType);
  }
}

/** Organizer slices register handlers here as their normalized tables land. */
export function createProductionAiJobRegistry(): AiJobRegistry {
  return new AiJobRegistry()
    .register("transcribe.asset.v1", transcribeAssetHandler)
    .register("analyze.asset_image.v1", analyzeAssetImageHandler)
    .register("suggest.event_metadata.v1", suggestEventMetadataHandler)
    .register("suggest.inbox_item.v1", suggestInboxItemHandler);
}
