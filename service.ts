import { z } from "zod";
import { ask, type Settings } from "./client";
import generation from "./prompts/generation";
import evolution from "./prompts/evolution";
import {
  generatedSchema,
  evolutionSchema,
  type Career,
  type Patient,
  type Session,
} from "../game/schemas";
import { schedule } from "../game/scheduling";
import { uid, currentSession } from "../game/reducer";
export async function prepareDay(
  s: Career,
  settings: Settings,
  checkpoint: (value: Career["preparation"]) => Promise<void>,
) {
  const cache = structuredClone(s.preparation);
  const plan = schedule(s);
  const patients: Patient[] = [];
  const sessions: Session[] = [];
  const fresh = cache.fresh
    ? { patients: cache.fresh }
    : plan.newCount
      ? await ask(
          settings,
          generation,
          {
            newCount: plan.newCount,
            currentDay: s.day,
            existingNames: Object.values(s.patients).map((p) => p.core.name),
          },
          z.object({
            patients: z.array(generatedSchema).length(plan.newCount),
          }),
        )
      : { patients: [] };
  if (!cache.fresh) {
    cache.fresh = fresh.patients;
    await checkpoint(cache);
  }
  for (const original of plan.returning) {
    const p = structuredClone(original);
    const result =
      cache.evolved[p.id] ||
      (await ask(
        settings,
        evolution,
        { core: p.core, state: p.state, history: p.history, currentDay: s.day },
        evolutionSchema,
      ));
    if (!cache.evolved[p.id]) {
      cache.evolved[p.id] = result;
      await checkpoint(cache);
    }
    p.state = result.state;
    patients.push(p);
    sessions.push({
      id: uid(),
      patientId: p.id,
      day: s.day,
      plan: result.plan,
      messages: [],
      reviews: [],
      closed: false,
      evolution: result.evolutionSummary,
    });
  }
  for (const data of fresh.patients) {
    const p: Patient = {
      id: uid(),
      core: data.core,
      state: data.state,
      revealedFactIds: [],
      history: [],
      nextFollowUp: null,
      notes: "",
    };
    patients.push(p);
    sessions.push({
      id: uid(),
      patientId: p.id,
      day: s.day,
      plan: data.plan,
      messages: [],
      reviews: [],
      closed: false,
      evolution: "",
    });
  }
  for (const session of sessions)
    session.messages.push({
      id: uid(),
      role: "patient",
      text: session.plan.opening,
      status: "sent",
    });
  return {
    patients,
    sessions,
    deferred: plan.deferred.map((p) => ({
      patientId: p.id,
      from: p.nextFollowUp!,
      to: s.day + 1,
    })),
  };
}
export function patientContext(s: Career, full = false) {
  const x = currentSession(s);
  if (!x)
    return { currentDay: s.day, appointments: s.capacity, completed: s.cursor };
  const p = s.patients[x.patientId];
  return {
    currentDay: s.day,
    patient: p,
    session: { ...x, messages: full ? x.messages : x.messages.slice(-32) },
    alerts: s.alerts.filter((a) => a.sessionId === x.id),
    earlierCurrentSessionSummary: p.state.progress,
  };
}
export function nouraContext(s: Career) {
  const x = currentSession(s),
    p = x ? s.patients[x.patientId] : null;
  return {
    currentDay: s.day,
    appointments: s.capacity,
    completed: s.cursor,
    minutes: s.minutes,
    patient: p
      ? {
          name: p.core.name,
          age: p.core.age,
          reason: p.core.reason,
          notes: p.notes,
          history: p.history,
        }
      : null,
    transcript: x?.messages.slice(-32),
    lastReview: x?.reviews.at(-1),
    alerts: s.alerts.filter((a) => a.sessionId === x?.id),
    noura: s.noura.slice(-24),
  };
}
export async function reviewContext(
  s: Career,
  settings: Settings,
  checkpoint: (key: string, value: string) => Promise<void>,
) {
  const context = patientContext(s, true);
  const x = currentSession(s);
  if (!x || JSON.stringify(x.messages).length < 120000) return context;
  const { default: summaryPrompt } = await import("./prompts/summary");
  const summarySchema = z.object({
    summary: z.string().min(1),
    evidence: z.array(
      z.object({ messageId: z.string(), quote: z.string().min(1) }),
    ),
    unresolved: z.array(z.string()),
  });
  const chunks: Session["messages"][] = [];
  let chunk: Session["messages"] = [],
    size = 0;
  for (const m of x.messages) {
    const n = JSON.stringify(m).length;
    if (size + n > 65000 && chunk.length) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
    chunk.push(m);
    size += n;
  }
  if (chunk.length) chunks.push(chunk);
  const digests = [];
  for (let n = 0; n < chunks.length; n++) {
    const messages = chunks[n];
    const key = `review-chunk:${x.id}:${messages[0].id}:${messages.at(-1)!.id}`;
    let digest;
    if (s.drafts[key]) {
      try {
        digest = summarySchema.parse(JSON.parse(s.drafts[key]));
      } catch {
        /* regenerate an invalid cached summary */
      }
    }
    if (!digest) {
      digest = await ask(
        settings,
        summaryPrompt,
        { part: n + 1, total: chunks.length, originalPlan: x.plan, messages },
        summarySchema,
      );
      if (
        digest.evidence.some(
          (e) =>
            !messages.some(
              (m) => m.id === e.messageId && m.text.includes(e.quote),
            ),
        )
      )
        throw new Error("Invalid summary evidence");
      await checkpoint(key, JSON.stringify(digest));
    }
    digests.push(digest);
  }
  return {
    ...context,
    session: { ...x, messages: [], fullConversationDigests: digests },
    transcriptRepresentation:
      "Every message was read in chronological chunks. Use the complete faithful summaries and exact evidence; do not assume omitted details.",
  };
}
