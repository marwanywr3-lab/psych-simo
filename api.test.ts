import { it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { ask, listModels } from "../src/ai/client";
const settings = {
  key: "TEST-ONLY-NOT-A-REAL-KEY",
  model: "test-model",
  remember: false,
  language: "ar" as const,
};
afterEach(() => vi.unstubAllGlobals());
it("uses header auth, JSON schema, no remote storage; parses current Interactions steps", async () => {
  const mock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [{ type: "text", text: '{"reply":"نص اختباري"}' }],
          },
        ],
      }),
    ),
  );
  vi.stubGlobal("fetch", mock);
  expect(
    await ask(settings, "test", {}, z.object({ reply: z.string() })),
  ).toEqual({ reply: "نص اختباري" });
  const [url, init] = mock.mock.calls[0];
  expect(url).not.toContain(settings.key);
  expect(init.headers["x-goog-api-key"]).toBe(settings.key);
  const body = JSON.parse(init.body);
  expect(body.store).toBe(false);
  expect(body.response_format.schema.type).toBe("object");
});
it.each([
  [401, "key"],
  [403, "key"],
  [404, "model"],
  [429, "quota"],
  [500, "request"],
])(
  "handles HTTP %s without retries or secret leakage",
  async (status, code) => {
    const mock = vi.fn().mockResolvedValue(new Response("{}", { status }));
    vi.stubGlobal("fetch", mock);
    await expect(
      ask(settings, "test", {}, z.object({ reply: z.string() })),
    ).rejects.toMatchObject({ code });
    expect(mock).toHaveBeenCalledTimes(1);
  },
);
it.each([
  ["{broken", "json"],
  ["{}", "json"],
  ["", "empty"],
])("rejects empty and invalid JSON (%s)", async (raw, code) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          steps: [
            { type: "model_output", content: [{ type: "text", text: raw }] },
          ],
        }),
      ),
    ),
  );
  await expect(
    ask(settings, "test", {}, z.object({ reply: z.string() })),
  ).rejects.toMatchObject({ code });
});
it("handles blocked content and offline failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "failed" }))),
  );
  await expect(
    ask(settings, "test", {}, z.object({ reply: z.string() })),
  ).rejects.toMatchObject({ code: "content" });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  await expect(
    ask(settings, "test", {}, z.object({ reply: z.string() })),
  ).rejects.toMatchObject({ code: "network" });
});
it("lists paginated models without switching the selection", async () => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [
            {
              name: "models/a",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
          nextPageToken: "next",
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [
            {
              name: "models/b",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
      ),
    );
  vi.stubGlobal("fetch", mock);
  expect(await listModels(settings)).toEqual(["a", "b"]);
  expect(settings.model).toBe("test-model");
});
it("times out with no hidden retries", async () => {
  vi.useFakeTimers();
  const mock = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () =>
          reject(new DOMException("timeout", "AbortError")),
        );
      }),
  );
  vi.stubGlobal("fetch", mock);
  const check = expect(
    ask(settings, "test", {}, z.object({ reply: z.string() })),
  ).rejects.toMatchObject({ code: "timeout" });
  await vi.advanceTimersByTimeAsync(60001);
  await check;
  expect(mock).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
