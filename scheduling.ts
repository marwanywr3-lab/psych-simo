import type { Career } from "./schemas";
export function capacity(random = Math.random) {
  return 2 + Math.min(3, Math.floor(random() * 4));
}
export function duePatients(s: Career) {
  return Object.values(s.patients)
    .filter((p) => p.nextFollowUp !== null && p.nextFollowUp <= s.day)
    .sort(
      (a, b) => a.nextFollowUp! - b.nextFollowUp! || a.id.localeCompare(b.id),
    );
}
export function schedule(s: Career) {
  const due = duePatients(s);
  return {
    returning: due.slice(0, s.capacity),
    deferred: due.slice(s.capacity),
    newCount: Math.max(0, s.capacity - due.length),
  };
}
