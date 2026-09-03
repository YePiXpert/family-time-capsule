import { describe, expect, it } from "vitest";
import {
  mergeTimelineEvents,
  toLocalTimelineEvent,
} from "../src/storage/local-timeline";
import type { LocalTimelineEvent } from "../src/types";

describe("local-first timeline", () => {
  it("turns a pending local photo into a durable timeline card", () => {
    expect(
      toLocalTimelineEvent({
        id: "capture-1",
        kind: "media_capture",
        title: "first-step.jpg",
        occurred_at: "2026-09-03T21:00:00.000Z",
        local_uri: "file:///captures/capture-1.jpg",
        media_type: "image",
        sync_state: "pending",
      }),
    ).toMatchObject({
      id: "local:capture-1",
      source: "local",
      syncState: "pending",
      localCoverUri: "file:///captures/capture-1.jpg",
      assetCount: 1,
    });
  });

  it("keeps local records alongside the downloaded server timeline", () => {
    const serverEvent: LocalTimelineEvent = {
      id: "server-1",
      title: "昨天",
      occurredAt: "2026-09-02T21:00:00.000Z",
      occurredAtPrecision: "exact",
      locationText: null,
      childPersonId: "child-1",
      ageDays: null,
      updatedAt: "2026-09-02T21:00:00.000Z",
      assetCount: 0,
      participantNames: [],
      cover: null,
      localCoverUri: null,
      source: "server",
      syncState: null,
    };

    const result = mergeTimelineEvents([serverEvent], [
      {
        id: "local-1",
        kind: "text_capture",
        title: "今天",
        occurred_at: "2026-09-03T21:00:00.000Z",
        local_uri: null,
        media_type: null,
        sync_state: "synced",
      },
    ]);

    expect(result.map((event) => event.id)).toEqual(["local:local-1", "server-1"]);
    expect(result[0]).toMatchObject({ source: "local", syncState: "synced" });
  });
});
