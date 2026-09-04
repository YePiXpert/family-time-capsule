import { describe, expect, it } from "vitest";
import { TAB_ROUTES } from "../src/navigation/types";
import { MOBILE_LOCAL_SCHEMA_SQL } from "../src/storage/schema";
import { dateLabel, inputDateTime } from "../src/utils/format";

describe("native product shell", () => {
  it("keeps exactly five primary destinations with capture in the center", () => {
    expect(TAB_ROUTES).toEqual(["Home", "Timeline", "Capture", "Inbox", "More"]);
    expect(TAB_ROUTES[2]).toBe("Capture");
  });

  it("persists direct audio captures and memory detail without weakening old media", () => {
    expect(MOBILE_LOCAL_SCHEMA_SQL).toContain("'image', 'video', 'audio'");
    expect(MOBILE_LOCAL_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS memory_detail");
    expect(MOBILE_LOCAL_SCHEMA_SQL).toContain("CREATE TABLE IF NOT EXISTS outbox");
  });

  it("keeps server-provided family wall time independent of the device timezone", () => {
    expect(inputDateTime("2026-09-02T00:30")).toBe("2026-09-02T00:30");
    expect(dateLabel("2026-09-01T16:30:00.000Z", "Asia/Shanghai")).toContain("9月2日");
    expect(dateLabel("2026-09-01T16:30:00.000Z", "America/New_York")).toContain("9月1日");
  });
});
