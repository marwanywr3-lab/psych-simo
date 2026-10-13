import {
  careerSchema,
  type Career,
  type Reply,
  type Review,
  type Patient,
  type Session,
} from "./schemas";
import { TIME, advance } from "./time";
import { capacity } from "./scheduling";
import { nominate, decide } from "./discipline";
export const uid = () => crypto.randomUUID();
export function createCareer(): Career {
  return {
    version: 2,
    id: uid(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    day: 1,
    minutes: TIME.start,
    scene: "attendance",
    phase: "awaitingCheckIn",
    checkedIn: false,
    checkedOut: false,
    capacity: capacity(),
    preparation: { fresh: null, evolved: {} },
    prepared: false,
    queue: [],
    cursor: 0,
    patients: {},
    sessions: {},
    alerts: [],
    noura: [],
    incidents: [],
    discipline: 0,
    timeEvents: [],
    reports: [],
    rescheduled: [],
    drafts: {},
  };
}
export const currentSession = (s: Career) => s.sessions[s.queue[s.cursor]];
export const completed = (s: Career) =>
  s.prepared && s.cursor === s.queue.length;
export const queuedIncident = (s: Career) =>
  s.incidents.find(
    (i) => i.status === "queued" && s.sessions[i.sessionId]?.closed,
  );
function settle(s: Career) {
  if (s.discipline === 4) {
    s.phase = "dismissed";
    return;
  }
  if (queuedIncident(s)) {
    s.phase = "directorMeeting";
    return;
  }
  if (completed(s)) {
    s.phase = "awaitingCheckOut";
    return;
  }
  s.phase =
    s.scene === "clinic"
      ? currentSession(s)
        ? "sessionActive"
        : "clinicIdle"
      : "corridor";
}
export type Action =
  | { type: "checkIn" }
  | { type: "move"; scene: Career["scene"]; id: string }
  | { type: "break"; id: string }
  | { type: "finishWork" }
  | { type: "checkOut" }
  | { type: "nextDay" }
  | { type: "checkpoint"; day: number; preparation: Career["preparation"] }
  | {
      type: "prepared";
      day: number;
      patients: Patient[];
      sessions: Session[];
      deferred: { patientId: string; from: number; to: number }[];
    }
  | {
      type: "pending";
      target: "patient" | "noura" | "director";
      text: string;
      id: string;
    }
  | { type: "failed"; target: "patient" | "noura" | "director"; id: string }
  | { type: "reply"; sessionId: string; messageId: string; result: Reply }
  | { type: "reviewing" }
  | { type: "reviewFailed" }
  | { type: "review"; sessionId: string; result: Review }
  | { type: "nouraReply"; messageId: string; reply: string }
  | {
      type: "directorReply";
      messageId: string;
      result: {
        reply: string;
        evaluationComplete: boolean;
        confirmed: boolean;
        reason: string;
        evidenceMessageIds: string[];
      };
    }
  | { type: "notes"; patientId: string; text: string }
  | { type: "draft"; key: string; text: string };
function messages(s: Career, target: "patient" | "noura" | "director") {
  return target === "patient"
    ? currentSession(s)?.messages
    : target === "noura"
      ? s.noura
      : queuedIncident(s)?.meeting;
}
export function reduce(previous: Career, action: Action): Career {
  const s = structuredClone(previous);
  const session = currentSession(s);
  if (s.phase === "dismissed" && !["notes", "draft"].includes(action.type))
    return previous;
  switch (action.type) {
    case "checkIn":
      if (s.checkedIn || s.checkedOut) return previous;
      s.checkedIn = true;
      s.phase = "corridor";
      break;
    case "move": {
      if (
        !s.checkedIn ||
        s.checkedOut ||
        s.phase === "directorMeeting" ||
        s.phase === "sessionReviewing"
      )
        return previous;
      const legal =
        s.scene === "attendance"
          ? action.scene === "corridor"
          : s.scene === "corridor"
            ? action.scene !== "corridor"
            : action.scene === "corridor";
      if (!legal) return previous;
      s.scene = action.scene;
      advance(s, "travel", TIME.travel, action.id);
      settle(s);
      break;
    }
    case "checkpoint":
      if (action.day !== s.day || s.prepared) return previous;
      s.preparation = action.preparation;
      break;
    case "prepared":
      if (s.prepared || action.day !== s.day || !s.checkedIn) return previous;
      if (action.sessions.length !== s.capacity)
        throw Error("Invalid schedule");
      for (const p of action.patients) s.patients[p.id] = p;
      for (const x of action.sessions) s.sessions[x.id] = x;
      s.queue = action.sessions.map((x) => x.id);
      s.prepared = true;
      for (const d of action.deferred) {
        s.patients[d.patientId].nextFollowUp = d.to;
        s.rescheduled.push(d);
      }
      settle(s);
      break;
    case "pending": {
      const list = messages(s, action.target);
      if (!list || list.some((m) => m.status !== "sent") || !action.text.trim())
        return previous;
      if (action.target === "patient" && (!session || session.closed))
        return previous;
      list.push({
        id: action.id,
        role: "doctor",
        text: action.text,
        status: "pending",
      });
      s.drafts[action.target] = "";
      break;
    }
    case "failed": {
      const m = messages(s, action.target)?.find(
        (m) => m.id === action.id && m.status !== "sent",
      );
      if (m) m.status = "failed";
      break;
    }
    case "reply": {
      const x = s.sessions[action.sessionId];
      const m = x?.messages.find((m) => m.id === action.messageId);
      if (!x || x.closed || !m || m.status === "sent") return previous;
      m.status = "sent";
      x.messages.push({
        id: `reply:${m.id}`,
        role: "patient",
        text: action.result.patientReply,
        status: "sent",
      });
      const p = s.patients[x.patientId];
      p.state = {
        ...action.result.updatedPatientState,
        trust: Math.max(
          p.state.trust - 8,
          Math.min(p.state.trust + 8, action.result.updatedPatientState.trust),
        ),
      };
      p.revealedFactIds = [
        ...new Set([
          ...p.revealedFactIds,
          ...action.result.revealedFactIds.filter((id) =>
            p.core.facts.some((f) => f.id === id),
          ),
        ]),
      ];
      for (const a of s.alerts)
        if (
          a.sessionId === x.id &&
          action.result.resolvedAlertIds.includes(a.id)
        )
          a.resolved = true;
      const a = action.result.optionalNouraAlert;
      if (
        a &&
        !s.alerts.some(
          (old) =>
            old.sessionId === x.id &&
            (old.id === a.id || old.reason === a.reason),
        )
      ) {
        s.alerts.push({ ...a, sessionId: x.id, resolved: false });
        s.noura.push({
          id: `alert:${x.id}:${a.id}`,
          role: "noura",
          text: a.text,
          status: "sent",
        });
      }
      nominate(s, x.id, action.result.potentialIncident);
      advance(s, "dialogue", TIME.dialogue, `reply:${m.id}`);
      break;
    }
    case "reviewing":
      if (
        !session ||
        session.closed ||
        session.messages.some((m) => m.status !== "sent")
      )
        return previous;
      s.phase = "sessionReviewing";
      break;
    case "reviewFailed":
      if (s.phase === "sessionReviewing") s.phase = "sessionActive";
      break;
    case "review": {
      const x = s.sessions[action.sessionId];
      if (!x || x.closed || currentSession(s)?.id !== x.id) return previous;
      const r = action.result;
      x.reviews.push(r);
      if (!r.canEnd) {
        s.phase = "sessionActive";
        const message = [r.feedback, ...r.missingItems].join("\n");
        if (!s.noura.some((m) => m.text === message))
          s.noura.push({
            id: uid(),
            role: "noura",
            text: message,
            status: "sent",
          });
        break;
      }
      if (!r.sessionSummary.trim() || r.missingItems.length)
        throw Error("Invalid accepted review");
      x.closed = true;
      const p = s.patients[x.patientId];
      p.history.push({
        sessionId: x.id,
        day: s.day,
        summary: r.sessionSummary,
        plan: r.followUpPlan,
      });
      p.nextFollowUp = r.followUpRequired
        ? Math.max(
            s.day + 1,
            Math.min(s.day + 14, r.suggestedFollowUpDay ?? s.day + 3),
          )
        : null;
      s.cursor++;
      advance(s, "sessionClose", TIME.close, `close:${x.id}`);
      settle(s);
      break;
    }
    case "nouraReply": {
      const m = s.noura.find((m) => m.id === action.messageId);
      if (!m || m.status === "sent") return previous;
      m.status = "sent";
      s.noura.push({
        id: `reply:${m.id}`,
        role: "noura",
        text: action.reply,
        status: "sent",
      });
      break;
    }
    case "directorReply": {
      const i = queuedIncident(s);
      const m = i?.meeting.find((m) => m.id === action.messageId);
      if (!i || !m || m.status === "sent") return previous;
      m.status = "sent";
      i.meeting.push({
        id: `reply:${m.id}`,
        role: "director",
        text: action.result.reply,
        status: "sent",
      });
      decide(s, i, action.result);
      settle(s);
      break;
    }
    case "break":
      if (!s.checkedIn || s.checkedOut) return previous;
      advance(s, "break", TIME.break, action.id);
      break;
    case "finishWork":
      if (
        !completed(s) ||
        queuedIncident(s) ||
        s.checkedOut ||
        s.minutes >= TIME.end
      )
        return previous;
      advance(
        s,
        "paperwork",
        Math.max(0, TIME.end - s.minutes),
        `paperwork:${s.day}`,
      );
      break;
    case "checkOut":
      if (
        s.scene !== "attendance" ||
        !completed(s) ||
        !s.checkedIn ||
        s.checkedOut ||
        s.minutes < TIME.end ||
        queuedIncident(s)
      )
        return previous;
      s.checkedOut = true;
      s.phase = "dayReport";
      s.reports.push({
        day: s.day,
        completed: s.cursor,
        checkout: s.minutes,
        warnings: s.discipline,
        summaries: s.queue.map(
          (id) => s.sessions[id].reviews.at(-1)?.sessionSummary || "",
        ),
      });
      break;
    case "nextDay":
      if (s.phase !== "dayReport" || !s.checkedOut) return previous;
      s.day++;
      s.minutes = TIME.start;
      s.scene = "attendance";
      s.phase = "awaitingCheckIn";
      s.checkedIn = false;
      s.checkedOut = false;
      s.capacity = capacity();
      s.preparation = { fresh: null, evolved: {} };
      s.prepared = false;
      s.queue = [];
      s.cursor = 0;
      break;
    case "notes":
      if (s.patients[action.patientId])
        s.patients[action.patientId].notes = action.text;
      break;
    case "draft":
      s.drafts[action.key] = action.text;
      break;
  }
  s.updatedAt = new Date().toISOString();
  return careerSchema.parse(s);
}
