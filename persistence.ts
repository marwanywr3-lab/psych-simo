import { openDB } from "idb";
import { careerSchema, type Career } from "./schemas";
const db = () =>
  openDB("marwan-psych-simulator", 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("careers"))
        db.createObjectStore("careers", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    },
  });
export function parseSave(value: unknown): Career {
  if (!value || typeof value !== "object")
    throw Error("ملف الحفظ غير صالح / Invalid save");
  const v = structuredClone(value) as Record<string, unknown>;
  if (v.version === 1) {
    v.version = 2;
    v.drafts ??= {};
    v.rescheduled ??= [];
    v.preparation ??= { fresh: null, evolved: {} };
  }
  const s = careerSchema.parse(v);
  if (
    s.cursor > s.queue.length ||
    new Set(s.queue).size !== s.queue.length ||
    (s.prepared && s.queue.length !== s.capacity)
  )
    throw Error("جدول غير صالح");
  for (const [id, p] of Object.entries(s.patients))
    if (id !== p.id) throw Error("Patient ID mismatch");
  for (const [id, x] of Object.entries(s.sessions))
    if (id !== x.id || !s.patients[x.patientId]) throw Error("Invalid session");
  for (const id of s.queue)
    if (!s.sessions[id] || s.sessions[id].day !== s.day)
      throw Error("Invalid schedule");
  for (let i = 0; i < s.queue.length; i++)
    if (s.sessions[s.queue[i]].closed !== i < s.cursor)
      throw Error("Invalid cursor");
  if (
    s.checkedOut &&
    (!s.checkedIn ||
      !s.prepared ||
      s.cursor !== s.queue.length ||
      s.minutes < 1080)
  )
    throw Error("Invalid checkout");
  if (
    s.discipline !==
    Math.min(4, s.incidents.filter((i) => i.status === "confirmed").length)
  )
    throw Error("Invalid discipline");
  if (s.phase === "dismissed" && s.discipline !== 4)
    throw Error("Invalid career");
  if (s.phase === "sessionReviewing") s.phase = "sessionActive";
  for (const list of [
    s.noura,
    ...Object.values(s.sessions).map((x) => x.messages),
    ...s.incidents.map((i) => i.meeting),
  ])
    for (const m of list) if (m.status === "pending") m.status = "failed";
  return s;
}
export async function saveCareer(s: Career) {
  const d = await db();
  const tx = d.transaction(["careers", "meta"], "readwrite");
  await tx.objectStore("careers").put(careerSchema.parse(s));
  await tx.objectStore("meta").put(s.id, "active");
  await tx.done;
}
export async function listCareers(): Promise<Career[]> {
  const d = await db();
  const all = await d.getAll("careers");
  return all
    .map(parseSave)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function loadActive(): Promise<Career | null> {
  const d = await db();
  const id = await d.get("meta", "active");
  if (!id) return null;
  const s = await d.get("careers", id);
  return s ? parseSave(s) : null;
}
export function exportSave(s: Career) {
  return JSON.stringify(careerSchema.parse(s), null, 2);
}
