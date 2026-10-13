import { z } from "zod";
import { common } from "./prompts/common";
export type Settings = {
  key: string;
  model: string;
  remember: boolean;
  language: "ar" | "en";
};
const endpoint = "https://generativelanguage.googleapis.com/v1beta";
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
const errors: Record<string, [string, string]> = {
  key: [
    "مفتاح Gemini غير صالح أو لا يملك الصلاحية. راجع الإعدادات.",
    "Invalid API key or permission. Check settings.",
  ],
  model: [
    "النموذج غير متاح لهذا المفتاح. اختبر الاتصال واختر نموذجًا متاحًا.",
    "Model unavailable for this key. Test connection and choose an available model.",
  ],
  quota: [
    "بلغت حد الحصة أو عدد الطلبات (429). انتظر قبل إعادة المحاولة؛ لم يتغير الوقت.",
    "Quota or rate limit reached (429). Wait before retrying; game time is unchanged.",
  ],
  network: [
    "تعذر الاتصال بالإنترنت. رسالتك محفوظة لإعادة المحاولة.",
    "Network unavailable. Your message is saved for retry.",
  ],
  timeout: [
    "انتهت مهلة الطلب. يمكنك إعادة المحاولة دون تكرار الرسالة.",
    "Request timed out. Retry without duplicating the message.",
  ],
  content: [
    "لم يُرجع النموذج نصًا بسبب قيود المحتوى. جرّب إعادة المحاولة أو راجع النموذج.",
    "Model returned no text due to content restrictions. Retry or check the model.",
  ],
  empty: [
    "وصل رد فارغ أو غير مكتمل. أعد المحاولة.",
    "Empty or incomplete response. Please retry.",
  ],
  json: [
    "رد النموذج غير صالح ولم يُعتمد. أعد المحاولة؛ تقدمك محفوظ.",
    "Invalid structured response; nothing was applied. Retry safely.",
  ],
  request: [
    "رفض Gemini الطلب. تحقق من دعم النموذج للبيانات المنظمة.",
    "Gemini rejected the request. Check structured-output support.",
  ],
};
function fail(code: string, s: Settings, retry = 0): never {
  throw new ApiError(code, errors[code][s.language === "ar" ? 0 : 1], retry);
}
async function request(path: string, s: Settings, body?: unknown) {
  if (!s.key.trim()) fail("key", s);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const r = await fetch(`${endpoint}/${path}`, {
      method: body ? "POST" : "GET",
      headers: { "x-goog-api-key": s.key, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!r.ok) {
      let detail = "";
      try {
        detail = JSON.stringify(await r.json());
      } catch {
        /* Do not expose request or credentials. */
      }
      if (r.status === 429)
        fail(
          "quota",
          s,
          Math.max(15, Number(r.headers.get("retry-after")) || 30),
        );
      if (
        r.status === 401 ||
        r.status === 403 ||
        /API_KEY_INVALID/i.test(detail)
      )
        fail("key", s);
      if (r.status === 404) fail("model", s);
      fail("request", s);
    }
    try {
      return await r.json();
    } catch {
      fail("json", s);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") fail("timeout", s);
    fail("network", s);
  } finally {
    clearTimeout(timer);
  }
}
export async function listModels(s: Settings): Promise<string[]> {
  let token = "";
  const result: string[] = [];
  for (let page = 0; page < 20; page++) {
    const data = await request(
      `models?pageSize=1000${token ? "&pageToken=" + encodeURIComponent(token) : ""}`,
      s,
    );
    for (const m of data.models || [])
      if (
        m.supportedGenerationMethods?.some((v: string) =>
          /generateContent|interact/i.test(v),
        )
      )
        result.push(String(m.name).replace(/^models\//, ""));
    token = data.nextPageToken || "";
    if (!token) break;
  }
  return result;
}
export async function ask<T extends z.ZodType>(
  s: Settings,
  prompt: string,
  context: unknown,
  schema: T,
): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(schema);
  delete jsonSchema.$schema;
  const data = await request("interactions", s, {
    model: s.model,
    system_instruction:
      common +
      "\n" +
      prompt +
      "\nLanguage: " +
      (s.language === "ar" ? "Arabic" : "English"),
    input: JSON.stringify(context),
    store: false,
    stream: false,
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: jsonSchema,
    },
    generation_config: {
      temperature: prompt.includes("TASK session review") ? 0 : 0.65,
      max_output_tokens: 16000,
    },
  });
  if (data.status && data.status !== "completed")
    fail(data.status === "failed" ? "content" : "empty", s);
  const content = (data.steps || [])
    .filter((step: { type: string }) => step.type === "model_output")
    .flatMap((step: { content: unknown[] }) => step.content || []);
  // outputs supports earlier Interactions deployments; never consume thought text.
  const parts = content.length ? content : data.outputs || [];
  const raw = parts
    .filter((p: { type: string }) => p.type === "text")
    .map((p: { text: string }) => p.text)
    .join("");
  if (!raw)
    fail(
      parts.some((p: { type: string }) => p.type === "refusal")
        ? "content"
        : "empty",
      s,
    );
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    fail("json", s);
  }
}
export async function testConnection(s: Settings) {
  const models = await listModels(s);
  if (!models.includes(s.model)) fail("model", s);
  await ask(
    s,
    "TASK connectivity check. Return reply = OK.",
    {},
    z.object({ reply: z.string() }),
  );
  return models;
}
