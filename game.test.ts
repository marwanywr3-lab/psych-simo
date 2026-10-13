import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { createCareer, reduce, currentSession } from "../src/game/reducer";
import { capacity, schedule } from "../src/game/scheduling";
import {
  parseSave,
  saveCareer,
  loadActive,
  exportSave,
} from "../src/game/persistence";
import { decide, nominate } from "../src/game/discipline";
import { prepared, approval, rejection, reply, patient } from "./fixtures";
describe("event-driven game rules", () => {
  it("random daily capacity is always 2–5 and survives reload", () => {
    for (let i = 0; i < 1000; i++) expect(capacity()).toBeGreaterThanOrEqual(2);
    expect(capacity(() => 0)).toBe(2);
    expect(capacity(() => 0.999)).toBe(5);
    const s = prepared();
    expect(parseSave(JSON.parse(exportSave(s))).queue).toEqual(s.queue);
  });
  it("cannot enter corridor or clinic without check-in; check-in is idempotent", () => {
    let s = createCareer();
    expect(reduce(s, { type: "move", scene: "clinic", id: "a" })).toEqual(s);
    expect(reduce(s, { type: "move", scene: "corridor", id: "b" })).toEqual(s);
    s = reduce(s, { type: "checkIn" });
    expect(reduce(s, { type: "checkIn" })).toEqual(s);
    expect(s.minutes).toBe(600);
  });
  it("pending and failed API messages preserve time and can commit exactly once", () => {
    let s = prepared(),
      time = s.minutes;
    s = reduce(s, {
      type: "pending",
      target: "patient",
      id: "d1",
      text: "ما الذي يقلقك؟",
    });
    expect(s.minutes).toBe(time);
    s = reduce(s, { type: "failed", target: "patient", id: "d1" });
    expect(s.minutes).toBe(time);
    expect(currentSession(s).messages.at(-1)?.text).toBe("ما الذي يقلقك؟");
    s = reduce(s, {
      type: "reply",
      sessionId: "s1",
      messageId: "d1",
      result: reply,
    });
    expect(s.minutes).toBe(time + 7);
    expect(
      reduce(s, {
        type: "reply",
        sessionId: "s1",
        messageId: "d1",
        result: reply,
      }),
    ).toEqual(s);
  });
  it("rejected review preserves patient, transcript and clock; repeated review never penalizes", () => {
    let s = prepared();
    const before = structuredClone(s);
    s = reduce(s, { type: "reviewing" });
    s = reduce(s, { type: "review", sessionId: "s1", result: rejection });
    s = reduce(s, { type: "review", sessionId: "s1", result: rejection });
    expect(currentSession(s).id).toBe("s1");
    expect(currentSession(s).messages).toEqual(currentSession(before).messages);
    expect(s.minutes).toBe(before.minutes);
    expect(s.discipline).toBe(0);
    expect(s.noura).toHaveLength(1);
    expect(s.phase).toBe("sessionActive");
  });
  it("accepted close saves history and follows up without closing twice", () => {
    let s = prepared();
    s = reduce(s, { type: "review", sessionId: "s1", result: approval });
    expect(s.patients.p1.history).toHaveLength(1);
    expect(s.patients.p1.nextFollowUp).toBe(3);
    expect(s.cursor).toBe(1);
    expect(
      reduce(s, { type: "review", sessionId: "s1", result: approval }),
    ).toEqual(s);
    s.day = 3;
    const plan = schedule(s);
    expect(plan.returning[0].id).toBe("p1");
    expect(plan.returning[0].core).toEqual(patient.core);
    expect(plan.returning[0].history[0].summary).toBe(approval.sessionSummary);
  });
  it("overflow follow-ups remain explicitly deferred", () => {
    const s = prepared();
    s.day = 4;
    for (let i = 0; i < 5; i++)
      s.patients["extra" + i] = {
        ...structuredClone(patient),
        id: "extra" + i,
        nextFollowUp: 3,
      };
    const plan = schedule(s);
    expect(plan.returning).toHaveLength(2);
    expect(plan.deferred).toHaveLength(3);
    expect(plan.newCount).toBe(0);
  });
  it("checkout and next day are single events; late sessions may finish", () => {
    let s = prepared();
    s.minutes = 1090;
    s = reduce(s, { type: "review", sessionId: "s1", result: approval });
    s = reduce(s, { type: "review", sessionId: "s2", result: approval });
    s = reduce(s, { type: "move", scene: "corridor", id: "exit1" });
    s = reduce(s, { type: "move", scene: "attendance", id: "exit2" });
    s = reduce(s, { type: "checkOut" });
    expect(s.checkedOut).toBe(true);
    expect(s.minutes).toBeGreaterThan(1080);
    expect(reduce(s, { type: "checkOut" })).toEqual(s);
    expect(s.reports).toHaveLength(1);
    s = reduce(s, { type: "nextDay" });
    expect(s.day).toBe(2);
    expect(s.minutes).toBe(600);
    expect(reduce(s, { type: "nextDay" })).toEqual(s);
  });
  it("early completion requires paperwork and cannot checkout an active patient", () => {
    let s = prepared();
    expect(reduce(s, { type: "checkOut" })).toEqual(s);
    expect(reduce(s, { type: "finishWork" })).toEqual(s);
    s = reduce(s, { type: "review", sessionId: "s1", result: approval });
    s = reduce(s, { type: "review", sessionId: "s2", result: approval });
    s = reduce(s, { type: "finishWork" });
    expect(s.minutes).toBe(1080);
    expect(reduce(s, { type: "finishWork" })).toEqual(s);
  });
  it("no duplicate incident, no penalty without defense, deterministic four-stage ladder", () => {
    const s = prepared();
    for (let n = 1; n <= 4; n++) {
      const messageId = "bad" + n;
      s.sessions.s1.messages.push({
        id: messageId,
        role: "doctor",
        text: "عبارة اختبارية جارحة مؤكدة " + n,
        status: "sent",
      });
      const p = {
        type: "verbal_abuse" as const,
        messageId,
        quote: "عبارة اختبارية جارحة مؤكدة " + n,
        reason: "إساءة مثبتة",
      };
      nominate(s, "s1", p);
      nominate(s, "s1", p);
      expect(s.incidents).toHaveLength(n);
      const i = s.incidents[n - 1];
      const decision = {
        evaluationComplete: true,
        confirmed: true,
        reason: "تم التحقق",
        evidenceMessageIds: [messageId],
      };
      decide(s, i, decision);
      expect(s.discipline).toBe(n - 1);
      i.meeting.push({
        id: "defense" + n,
        role: "doctor",
        text: "هذا ردي على الواقعة",
        status: "sent",
      });
      decide(s, i, decision);
      expect(s.discipline).toBe(n);
      decide(s, i, decision);
      expect(s.discipline).toBe(n);
    }
    expect(s.phase).toBe("dismissed");
  });
  it("nominations require real verbatim doctor evidence and dismissals do not penalize", () => {
    const s = prepared();
    nominate(s, "s1", {
      type: "explicit_neglect",
      messageId: "invented",
      quote: "لم يحدث هذا القول",
      reason: "غير حقيقي",
    });
    expect(s.incidents).toHaveLength(0);
  });
  it("restores active conversation from IndexedDB, marks interrupted requests retryable", async () => {
    let s = prepared();
    s = reduce(s, {
      type: "pending",
      target: "patient",
      id: "d1",
      text: "رسالة محفوظة",
    });
    await saveCareer(s);
    const restored = (await loadActive())!;
    expect(currentSession(restored).messages.at(-1)?.status).toBe("failed");
    expect(restored.minutes).toBe(s.minutes);
    expect(restored.scene).toBe("clinic");
    expect(restored.queue).toEqual(s.queue);
  });
  it("rejects invalid imports and references and migrates version 1", () => {
    expect(() => parseSave({ version: 99 })).toThrow();
    const s = prepared();
    const bad = structuredClone(s);
    bad.queue[0] = "nonexistent";
    expect(() => parseSave(bad)).toThrow();
    const v1 = {
      ...s,
      version: 1,
      drafts: undefined,
      rescheduled: undefined,
      preparation: undefined,
    };
    expect(parseSave(v1).version).toBe(2);
    expect(exportSave(s)).not.toContain("gemini-key");
  });
  it("identity cannot be changed by conversation and trust changes gradually", () => {
    let s = prepared();
    s = reduce(s, {
      type: "pending",
      target: "patient",
      id: "d",
      text: "كلام",
    });
    s = reduce(s, {
      type: "reply",
      sessionId: "s1",
      messageId: "d",
      result: {
        ...reply,
        updatedPatientState: { ...reply.updatedPatientState, trust: 100 },
        revealedFactIds: ["fake"],
      },
    });
    expect(s.patients.p1.core).toEqual(patient.core);
    expect(s.patients.p1.state.trust).toBe(43);
    expect(s.patients.p1.revealedFactIds).toEqual([]);
  });
});
