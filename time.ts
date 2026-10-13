import type { Career } from "./schemas";
export const TIME = {
  start: 600,
  end: 1080,
  travel: 2,
  dialogue: 7,
  close: 5,
  break: 15,
};
export function advance(s: Career, kind: string, amount: number, id: string) {
  if (s.timeEvents.some((e) => e.id === id)) return;
  s.timeEvents.push({
    id,
    day: s.day,
    kind,
    from: s.minutes,
    to: s.minutes + amount,
  });
  s.minutes += amount;
}
export function clockText(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
