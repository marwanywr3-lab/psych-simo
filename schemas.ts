import { z } from "zod";
export const text = z.string().min(1).max(16000);
export const messageSchema = z.object({
  id: text,
  role: z.enum(["doctor", "patient", "noura", "director"]),
  text,
  status: z.enum(["pending", "sent", "failed"]),
});
export const stateSchema = z.object({
  emotion: text,
  trust: z.number().min(0).max(100),
  progress: text,
});
export const coreSchema = z.object({
  name: text,
  age: z.number().int().min(18).max(100),
  background: text,
  reason: text,
  hiddenStory: text,
  speechStyle: text,
  facts: z.array(z.object({ id: text, text })).max(20),
});
export const visitPlanSchema = z.object({
  goals: z.array(text).min(1).max(8),
  requiredItems: z.array(text).min(1).max(8),
  opening: text,
});
export const generatedSchema = z.object({
  core: coreSchema,
  state: stateSchema,
  plan: visitPlanSchema,
});
export const reviewSchema = z.object({
  canEnd: z.boolean(),
  missingItems: z.array(text).max(12),
  evidence: z.array(z.object({ messageId: z.string(), finding: text })).max(30),
  feedback: text,
  sessionSummary: z.string().max(16000),
  followUpPlan: z.string().max(8000),
  followUpRequired: z.boolean(),
  suggestedFollowUpDay: z.number().int().nullable(),
});
export const alertSchema = z.object({ id: text, reason: text, text });
export const potentialSchema = z.object({
  type: z.enum(["verbal_abuse", "explicit_neglect"]),
  messageId: text,
  quote: text,
  reason: text,
});
export const replySchema = z.object({
  patientReply: text,
  updatedPatientState: stateSchema,
  revealedFactIds: z.array(text),
  optionalNouraAlert: alertSchema.nullable(),
  resolvedAlertIds: z.array(text),
  potentialIncident: potentialSchema.nullable(),
});
export const assistanceSchema = z.object({ reply: text });
export const directorSchema = z.object({
  reply: text,
  evaluationComplete: z.boolean(),
  confirmed: z.boolean(),
  reason: text,
  evidenceMessageIds: z.array(text),
});
export const evolutionSchema = z.object({
  state: stateSchema,
  plan: visitPlanSchema,
  evolutionSummary: text,
});
export const sessionSchema = z.object({
  id: text,
  patientId: text,
  day: z.number().int().positive(),
  plan: visitPlanSchema,
  messages: z.array(messageSchema),
  reviews: z.array(reviewSchema),
  closed: z.boolean(),
  evolution: z.string(),
});
export const patientSchema = z.object({
  id: text,
  core: coreSchema,
  state: stateSchema,
  revealedFactIds: z.array(text),
  history: z.array(
    z.object({
      sessionId: text,
      day: z.number().int(),
      summary: text,
      plan: z.string(),
    }),
  ),
  nextFollowUp: z.number().int().positive().nullable(),
  notes: z.string().max(30000),
});
export const incidentSchema = z.object({
  id: text,
  day: z.number().int(),
  sessionId: text,
  type: potentialSchema.shape.type,
  messageId: text,
  quote: text,
  reason: text,
  status: z.enum(["queued", "confirmed", "dismissed"]),
  meeting: z.array(messageSchema),
  decision: z.string(),
  level: z.number().int().min(0).max(4),
});
export const careerSchema = z.object({
  version: z.literal(2),
  id: text,
  createdAt: text,
  updatedAt: text,
  day: z.number().int().positive(),
  minutes: z.number().int().min(600),
  scene: z.enum(["attendance", "corridor", "clinic"]),
  phase: z.enum([
    "awaitingCheckIn",
    "corridor",
    "clinicIdle",
    "sessionActive",
    "sessionReviewing",
    "directorMeeting",
    "awaitingCheckOut",
    "dayReport",
    "dismissed",
  ]),
  checkedIn: z.boolean(),
  checkedOut: z.boolean(),
  capacity: z.number().int().min(2).max(5),
  preparation: z.object({
    fresh: z.array(generatedSchema).nullable(),
    evolved: z.record(z.string(), evolutionSchema),
  }),
  prepared: z.boolean(),
  queue: z.array(text).max(5),
  cursor: z.number().int().min(0).max(5),
  patients: z.record(z.string(), patientSchema),
  sessions: z.record(z.string(), sessionSchema),
  alerts: z.array(
    alertSchema.extend({ sessionId: text, resolved: z.boolean() }),
  ),
  noura: z.array(messageSchema),
  incidents: z.array(incidentSchema),
  discipline: z.number().int().min(0).max(4),
  timeEvents: z.array(
    z.object({
      id: text,
      day: z.number().int(),
      kind: text,
      from: z.number(),
      to: z.number(),
    }),
  ),
  reports: z.array(
    z.object({
      day: z.number(),
      completed: z.number(),
      checkout: z.number(),
      warnings: z.number(),
      summaries: z.array(text),
    }),
  ),
  rescheduled: z.array(
    z.object({ patientId: text, from: z.number(), to: z.number() }),
  ),
  drafts: z.record(z.string(), z.string().max(100000)),
});
export type Career = z.infer<typeof careerSchema>;
export type Patient = z.infer<typeof patientSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Reply = z.infer<typeof replySchema>;
export type Incident = z.infer<typeof incidentSchema>;
