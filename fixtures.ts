// Fictional deterministic fixtures used by tests only. Never imported by the app.
import { createCareer, reduce } from "../src/game/reducer";
import type { Patient, Session, Review, Reply } from "../src/game/schemas";
export const patient: Patient = {
  id: "p1",
  core: {
    name: "مريض اختباري",
    age: 32,
    background: "موظف بالغ",
    reason: "ضغوط العمل",
    hiddenStory: "خوف من فقدان الوظيفة",
    speechStyle: "متردد",
    facts: [{ id: "f1", text: "قلق من العمل" }],
  },
  state: { emotion: "متردد", trust: 35, progress: "بداية" },
  revealedFactIds: [],
  history: [],
  nextFollowUp: null,
  notes: "",
};
export const session: Session = {
  id: "s1",
  patientId: "p1",
  day: 1,
  plan: {
    goals: ["الفهم"],
    requiredItems: ["خطة مشتركة"],
    opening: "أشعر بالضغط.",
  },
  messages: [
    { id: "opening", role: "patient", text: "أشعر بالضغط.", status: "sent" },
  ],
  reviews: [],
  closed: false,
  evolution: "",
};
export const rejection: Review = {
  canEnd: false,
  missingItems: ["اتفق على الخطوة القادمة"],
  evidence: [{ messageId: "", finding: "لا توجد خطة" }],
  feedback: "تحتاج إلى خطة",
  sessionSummary: "",
  followUpPlan: "",
  followUpRequired: false,
  suggestedFollowUpDay: null,
};
export const approval: Review = {
  canEnd: true,
  missingItems: [],
  evidence: [],
  feedback: "اكتملت النقاط",
  sessionSummary: "فهم الضغط واتفاق على خطوة",
  followUpPlan: "متابعة الضغوط",
  followUpRequired: true,
  suggestedFollowUpDay: 3,
};
export const reply: Reply = {
  patientReply: "أفهم ذلك، دعنا نتحدث.",
  updatedPatientState: {
    emotion: "مرتاح",
    trust: 40,
    progress: "ناقشنا العمل",
  },
  revealedFactIds: ["f1"],
  optionalNouraAlert: null,
  resolvedAlertIds: [],
  potentialIncident: null,
};
export function prepared() {
  let s = createCareer();
  s.capacity = 2;
  s = reduce(s, { type: "checkIn" });
  s = reduce(s, { type: "move", scene: "corridor", id: "m1" });
  s = reduce(s, { type: "move", scene: "clinic", id: "m2" });
  return reduce(s, {
    type: "prepared",
    day: 1,
    patients: [
      structuredClone(patient),
      { ...structuredClone(patient), id: "p2" },
    ],
    sessions: [
      structuredClone(session),
      { ...structuredClone(session), id: "s2", patientId: "p2" },
    ],
    deferred: [],
  });
}
