import { describe, expect, it, vi } from "vitest";
import { dailyQuestionSource, requestDailyQuestion } from "../src/local/dailyQuestion";
import type { DailyQuestionCache } from "../src/local/model";

function fixture() {
  let cache: DailyQuestionCache | undefined;
  const input = {
    today: "2026-09-21",
    getCache: () => cache,
    save: vi.fn(async (next: DailyQuestionCache) => { cache = next; }),
    getToken: vi.fn(async (): Promise<string | null> => "token"),
    request: vi.fn(async (): Promise<unknown> => ({ question: "她今天说了什么？" })),
  };
  return input;
}
describe("daily question request policy", () => {
  it("marks the day before requesting and caches a valid answer", async () => {
    const input = fixture();
    input.request.mockImplementation(async () => {
      expect(input.getCache()?.requestedDay).toBe(input.today);
      return { question: "她今天说了什么？" };
    });
    await requestDailyQuestion(input);
    expect(input.getCache()).toMatchObject({ day: input.today, question: "她今天说了什么？" });
    expect(dailyQuestionSource(input.getCache(), input.today, false)).toBe("ai");
    await requestDailyQuestion(input);
    expect(input.request).toHaveBeenCalledTimes(1);
  });
  it.each(["failure", "invalid"])("falls back after %s and never tries again that day", async (failure) => {
    const input = fixture();
    if (failure === "failure") input.request.mockRejectedValue(new Error("network"));
    else input.request.mockResolvedValue({ question: "问".repeat(31) });
    await requestDailyQuestion(input);
    await requestDailyQuestion(input);
    expect(input.request).toHaveBeenCalledTimes(1);
    expect(dailyQuestionSource(input.getCache(), input.today, false)).toBe("local");
  });
  it("silently uses local prompts on a phone that has not joined", async () => {
    const input = fixture();
    input.getToken.mockResolvedValue(null);
    await requestDailyQuestion(input);
    expect(input.request).not.toHaveBeenCalled();
    expect(input.getCache()?.requestedDay).toBe(input.today);
    expect(dailyQuestionSource(input.getCache(), input.today, false)).toBe("local");
    input.getToken.mockResolvedValue("token");
    await requestDailyQuestion(input);
    expect(input.request).not.toHaveBeenCalled();
  });
  it("changing the question uses local prompts without another request", async () => {
    const input = fixture();
    await requestDailyQuestion(input);
    expect(dailyQuestionSource(input.getCache(), input.today, true)).toBe("local");
    await requestDailyQuestion({ ...input, changed: true });
    expect(input.request).toHaveBeenCalledTimes(1);
  });
  it("a late answer cannot replace the user's choice to use local prompts", async () => {
    const input = fixture();
    let resolve!: (value: unknown) => void;
    input.request.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const request = requestDailyQuestion(input);
    await vi.waitFor(() => expect(input.request).toHaveBeenCalledTimes(1));
    resolve({ question: "谁在旁边？" });
    await request;
    expect(dailyQuestionSource(input.getCache(), input.today, true)).toBe("local");
  });
  it("does not contact the service if saving the attempt fails", async () => {
    const input = fixture();
    input.save.mockRejectedValue(new Error("disk full"));
    await expect(requestDailyQuestion(input)).rejects.toThrow("disk full");
    expect(input.request).not.toHaveBeenCalled();
  });
  it("can try once on the next day", async () => {
    const input = fixture();
    await requestDailyQuestion(input);
    input.today = "2026-09-22";
    await requestDailyQuestion(input);
    expect(input.request).toHaveBeenCalledTimes(2);
  });
});
