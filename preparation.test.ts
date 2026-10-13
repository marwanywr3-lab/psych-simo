import { it, expect, vi, afterEach } from "vitest";
import { prepareDay } from "../src/ai/service";
import { prepared, patient } from "./fixtures";
import { reduce } from "../src/game/reducer";
import { ask } from "../src/ai/client";
vi.mock("../src/ai/client", () => ({ ask: vi.fn() }));
afterEach(() => vi.resetAllMocks());
it("checkpoints valid generation and preserves identity through a failed follow-up request", async () => {
  let s = prepared();
  s.day = 3;
  s.prepared = false;
  s.preparation = { fresh: null, evolved: {} };
  s.queue = [];
  s.cursor = 0;
  s.patients.p1.nextFollowUp = 3;
  s.patients.p1.history = [
    { sessionId: "old", day: 1, summary: "ناقشنا ضغط العمل", plan: "متابعة" },
  ];
  const settings = {
    key: "TEST-ONLY",
    model: "test",
    remember: false,
    language: "ar" as const,
  };
  const generated = {
    core: { ...patient.core, name: "جديد" },
    state: patient.state,
    plan: { goals: ["الفهم"], requiredItems: ["خطة"], opening: "مرحبًا" },
  };
  const evolved = {
    state: { ...patient.state, progress: "التزمت بالخطة" },
    plan: {
      goals: ["متابعة"],
      requiredItems: ["مراجعة الخطوة"],
      opening: "أتذكر حديثنا السابق",
    },
    evolutionSummary: "متابعة مرتبطة بالخطة",
  };
  vi.mocked(ask)
    .mockResolvedValueOnce({ patients: [generated] })
    .mockRejectedValueOnce(new Error("TEST network failure"));
  const checkpoint = async (preparation: typeof s.preparation) => {
    s = reduce(s, { type: "checkpoint", day: 3, preparation });
  };
  await expect(prepareDay(s, settings, checkpoint)).rejects.toThrow(
    "TEST network failure",
  );
  expect(s.preparation.fresh).toHaveLength(1);
  vi.mocked(ask).mockResolvedValueOnce(evolved);
  const result = await prepareDay(s, settings, checkpoint);
  expect(ask).toHaveBeenCalledTimes(3);
  expect(result.patients[0].id).toBe("p1");
  expect(result.patients[0].core).toEqual(patient.core);
  expect(result.patients[0].history).toEqual(s.patients.p1.history);
  expect(result.sessions[0].messages[0].text).toBe("أتذكر حديثنا السابق");
  expect(result.patients).toHaveLength(2);
});
