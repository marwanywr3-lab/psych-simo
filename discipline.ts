import type { Career, Incident, Reply } from "./schemas";
// AI nominates evidence; code binds it to an actual doctor message and a unique event.
export function nominate(
  s: Career,
  sessionId: string,
  p: Reply["potentialIncident"],
) {
  if (!p) return;
  const session = s.sessions[sessionId];
  const m = session.messages.find(
    (m) => m.id === p.messageId && m.role === "doctor" && m.status === "sent",
  );
  if (!m || !m.text.includes(p.quote) || p.quote.trim().length < 5) return;
  const id = `incident:${sessionId}:${m.id}`;
  if (s.incidents.some((i) => i.id === id)) return;
  s.incidents.push({
    id,
    day: s.day,
    sessionId,
    type: p.type,
    messageId: m.id,
    quote: p.quote,
    reason: p.reason,
    status: "queued",
    meeting: [],
    decision: "",
    level: 0,
  });
}
export function decide(
  s: Career,
  i: Incident,
  result: {
    evaluationComplete: boolean;
    confirmed: boolean;
    reason: string;
    evidenceMessageIds: string[];
  },
) {
  if (i.status !== "queued" || !result.evaluationComplete) return;
  const hasDefense = i.meeting.some(
    (m) => m.role === "doctor" && m.status === "sent",
  );
  const evidence = s.sessions[i.sessionId]?.messages.find(
    (m) =>
      m.id === i.messageId && m.role === "doctor" && m.text.includes(i.quote),
  );
  if (!hasDefense || !evidence) return;
  const confirmed =
    result.confirmed && result.evidenceMessageIds.includes(i.messageId);
  i.status = confirmed ? "confirmed" : "dismissed";
  i.decision = result.reason;
  if (confirmed) {
    s.discipline = Math.min(4, s.discipline + 1);
    i.level = s.discipline;
  }
  if (s.discipline === 4) s.phase = "dismissed";
}
export const disciplinaryLabels = [
  "لا إنذارات",
  "تنبيه إداري",
  "إنذار أول",
  "إنذار نهائي",
  "فصل من العمل",
];
