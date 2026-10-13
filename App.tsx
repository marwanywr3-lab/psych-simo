import { useEffect, useRef, useState } from "react";
import { ErrorContext } from "./components/Modal";
import {
  type Career,
  replySchema,
  reviewSchema,
  assistanceSchema,
  directorSchema,
} from "./game/schemas";
import {
  createCareer,
  reduce,
  currentSession,
  completed,
  queuedIncident,
  uid,
  type Action,
} from "./game/reducer";
import {
  saveCareer,
  loadActive,
  listCareers,
  exportSave,
  parseSave,
} from "./game/persistence";
import { clockText, TIME } from "./game/time";
import { disciplinaryLabels } from "./game/discipline";
import {
  ask,
  listModels,
  testConnection,
  ApiError,
  type Settings,
} from "./ai/client";
import {
  prepareDay,
  patientContext,
  nouraContext,
  reviewContext,
} from "./ai/service";
import conversation from "./ai/prompts/conversation";
import review from "./ai/prompts/review";
import noura from "./ai/prompts/noura";
import director from "./ai/prompts/director";
import { scenes, hotspots, rect } from "./scenes/assets";
import { Clock } from "./components/Clock";
import { Modal } from "./components/Modal";
import { Chat } from "./components/Chat";
function initialSettings(): Settings {
  try {
    return {
      key: localStorage.getItem("gemini-key") || "",
      model: localStorage.getItem("gemini-model") || "gemini-3.5-flash-lite",
      remember: !!localStorage.getItem("gemini-key"),
      language: localStorage.getItem("language") === "en" ? "en" : "ar",
    };
  } catch {
    return {
      key: "",
      model: "gemini-3.5-flash-lite",
      remember: false,
      language: "ar",
    };
  }
}
type Panel =
  | "settings"
  | "help"
  | "patient"
  | "noura"
  | "director"
  | "files"
  | "history"
  | "careers"
  | "new"
  | null;
export default function App() {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const en = settings.language === "en";
  const t = (ar: string, eng: string) => (en ? eng : ar);
  const [career, setCareer] = useState<Career | null>(null);
  const ref = useRef<Career | null>(null);
  const chain = useRef(Promise.resolve());
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [careers, setCareers] = useState<Career[]>([]);
  const [fileId, setFileId] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const s = career;
  const session = s ? currentSession(s) : undefined;
  const patient = s && session ? s.patients[session.patientId] : undefined;
  const incident = s ? queuedIncident(s) : undefined;
  useEffect(() => {
    loadActive()
      .then((c) => {
        ref.current = c;
        setCareer(c);
        setDrafts(c?.drafts || {});
      })
      .catch(() =>
        setError("تعذر قراءة الحفظ المحلي / Could not read local save"),
      )
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    document.documentElement.lang = settings.language;
    document.documentElement.dir = en ? "ltr" : "rtl";
    try {
      localStorage.setItem("language", settings.language);
      localStorage.setItem("gemini-model", settings.model);
      if (settings.remember) localStorage.setItem("gemini-key", settings.key);
      else localStorage.removeItem("gemini-key");
    } catch {
      setError(
        t("تعذر حفظ الإعدادات محليًا.", "Could not save settings locally."),
      );
    }
  }, [settings, en]);
  useEffect(() => {
    if (s?.phase === "directorMeeting" && !menu) setPanel("director");
  }, [s?.phase, menu]);
  async function commit(action: Action) {
    const next = chain.current.then(async () => {
      if (!ref.current) return;
      const n = reduce(ref.current, action);
      await saveCareer(n);
      ref.current = n;
      setCareer(n);
    });
    chain.current = next.catch(() => {});
    await next;
  }
  function act(action: Action) {
    if (locked.current) return;
    void commit(action).catch(() =>
      setError(
        t(
          "تعذر حفظ التغيير؛ لم يُعتمد. صدّر حفظك وتحقق من مساحة الجهاز.",
          "Could not save this change; it was not applied. Export your save and check device storage.",
        ),
      ),
    );
  }
  async function activate(c: Career) {
    await chain.current;
    await saveCareer(c);
    ref.current = c;
    setCareer(c);
    setDrafts(c.drafts);
    setMenu(false);
    setPanel(null);
    setError("");
    setNotice("");
  }
  async function run(job: () => Promise<void>) {
    if (locked.current) return;
    if (Date.now() < cooldown) {
      setError(
        t("انتظر قليلًا قبل إعادة المحاولة.", "Please wait before retrying."),
      );
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : t(
              "تعذر إكمال العملية أو حفظ نتيجتها. تقدمك السابق محفوظ؛ أعد المحاولة.",
              "Could not complete or save this action. Previous progress is safe; retry.",
            ),
      );
      if (e instanceof ApiError && e.retryAfter)
        setCooldown(Date.now() + e.retryAfter * 1000);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function prepare() {
    await run(async () => {
      const c = ref.current;
      if (!c || c.prepared) return;
      const data = await prepareDay(c, settings, (preparation) =>
        commit({ type: "checkpoint", day: c.day, preparation }),
      );
      await commit({ type: "prepared", day: c.day, ...data });
      setNotice(
        t(
          "وصل المريض الأول. اضغط على الكرسي لبدء الحديث.",
          "Your first patient has arrived. Select the chair to talk.",
        ),
      );
    });
  }
  async function move(scene: Career["scene"]) {
    if (locked.current) return;
    if (!ref.current?.checkedIn) {
      setNotice(
        t(
          "يجب أن تسجل حضورك أولًا على جهاز البصمة.",
          "Please check in at the attendance device first.",
        ),
      );
      return;
    }
    try {
      await commit({ type: "move", scene, id: uid() });
      setNotice("");
      if (scene === "clinic" && !ref.current?.prepared) await prepare();
    } catch {
      setError(t("تعذر حفظ الانتقال.", "Could not save the transition."));
    }
  }
  function draft(target: string, text: string) {
    setDrafts((d) => ({ ...d, [target]: text }));
    void commit({ type: "draft", key: target, text }).catch(() =>
      setError(t("تعذر حفظ المسودة.", "Could not save draft.")),
    );
  }
  async function send(
    target: "patient" | "noura" | "director",
    retryId?: string,
  ) {
    await run(async () => {
      let c = ref.current;
      if (!c) return;
      let id = retryId;
      if (!id) {
        const value = drafts[target]?.trim();
        if (!value) return;
        id = uid();
        await commit({ type: "pending", target, id, text: value });
        setDrafts((d) => ({ ...d, [target]: "" }));
      }
      c = ref.current!;
      const list =
        target === "patient"
          ? currentSession(c)?.messages
          : target === "noura"
            ? c.noura
            : queuedIncident(c)?.meeting;
      if (!list?.some((m) => m.id === id && m.status !== "sent")) return;
      try {
        if (target === "patient") {
          const x = currentSession(c);
          if (!x) return;
          const result = await ask(
            settings,
            conversation,
            patientContext(c),
            replySchema,
          );
          await commit({
            type: "reply",
            sessionId: x.id,
            messageId: id!,
            result,
          });
        } else if (target === "noura") {
          const result = await ask(
            settings,
            noura,
            nouraContext(c),
            assistanceSchema,
          );
          await commit({
            type: "nouraReply",
            messageId: id!,
            reply: result.reply,
          });
        } else {
          const i = queuedIncident(c);
          if (!i) return;
          const result = await ask(
            settings,
            director,
            { incident: i, transcript: c.sessions[i.sessionId].messages },
            directorSchema,
          );
          await commit({ type: "directorReply", messageId: id!, result });
          if (!queuedIncident(ref.current!)) {
            setNotice(result.reply);
            setPanel(null);
          }
        }
      } catch (e) {
        await commit({ type: "failed", target, id: id! });
        throw e;
      }
    });
  }
  async function endSession() {
    await run(async () => {
      const c = ref.current,
        x = c ? currentSession(c) : undefined;
      if (!c || !x || x.closed || x.messages.some((m) => m.status !== "sent"))
        return;
      if (
        x.reviews.length &&
        c.drafts["review:" + x.id] === String(x.messages.length)
      ) {
        setPanel("patient");
        setNotice(t("نوره: ", "Noura: ") + x.reviews.at(-1)!.feedback);
        return;
      }
      await commit({ type: "reviewing" });
      try {
        const context = await reviewContext(c, settings, (key, text) =>
          commit({ type: "draft", key, text }),
        );
        const result = await ask(settings, review, context, reviewSchema);
        if (
          result.canEnd &&
          (!result.sessionSummary.trim() ||
            result.missingItems.length ||
            !result.evidence.some((e) =>
              x.messages.some(
                (m) =>
                  m.id === e.messageId &&
                  m.role === "doctor" &&
                  m.status === "sent",
              ),
            ))
        )
          throw new ApiError(
            "json",
            t(
              "مراجعة غير متسقة؛ أعد المحاولة.",
              "Inconsistent review; please retry.",
            ),
          );
        const ids = new Set(x.messages.map((m) => m.id));
        if (result.evidence.some((e) => e.messageId && !ids.has(e.messageId)))
          throw new ApiError(
            "json",
            t(
              "تضمنت المراجعة أدلة غير صالحة؛ أعد المحاولة.",
              "Review cited invalid evidence; retry.",
            ),
          );
        await commit({ type: "review", sessionId: x.id, result });
        await commit({
          type: "draft",
          key: "review:" + x.id,
          text: String(x.messages.length),
        });
        if (result.canEnd) {
          setPanel(null);
          setNotice(
            t("حُفظت الجلسة. ", "Session saved. ") +
              (completed(ref.current!)
                ? t("اكتملت مواعيد اليوم.", "All appointments are complete.")
                : t("وصل المريض التالي.", "The next patient has arrived.")),
          );
        } else {
          setPanel("patient");
          setNotice(t("نوره: ", "Noura: ") + result.feedback);
        }
      } catch (e) {
        await commit({ type: "reviewFailed" });
        throw e;
      }
    });
  }
  function exportCurrent() {
    if (!s) return;
    const url = URL.createObjectURL(
      new Blob([exportSave(s)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `psych-sim-day-${s.day}-${s.id.slice(0, 8)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file?: File) {
    if (!file) return;
    await run(async () => {
      if (file.size > 20_000_000) throw Error("Large file");
      const c = parseSave(JSON.parse(await file.text()));
      c.id = uid();
      c.updatedAt = new Date().toISOString();
      await activate(c);
      setNotice(
        t(
          "تم استيراد الحفظ كمسيرة مستقلة.",
          "Save imported as an independent career.",
        ),
      );
    });
  }
  const background = menu ? "corridor" : s?.scene || "corridor";
  const disciplineText = s
    ? en
      ? [
          "No warnings",
          "Administrative notice",
          "First warning",
          "Final warning",
          "Dismissed",
        ][s.discipline]
      : disciplinaryLabels[s.discipline]
    : "";
  const close = () => {
    setPanel(null);
    setError("");
  };
  return (
    <ErrorContext.Provider value={{ error, clear: () => setError("") }}>
      <main className={menu ? "app menu-mode" : "app"}>
        <div className="scene-viewport">
          <div className="scene" key={background}>
            <img
              className="scene-image"
              src={import.meta.env.BASE_URL + scenes[background].src}
              alt={t(
                background === "attendance"
                  ? "جهاز البصمة وباب الدخول"
                  : background === "clinic"
                    ? "العيادة وكرسي المريض"
                    : "ممر المستشفى",
                background === "attendance"
                  ? "Attendance device and entrance"
                  : background === "clinic"
                    ? "Clinic and patient chair"
                    : "Hospital corridor",
              )}
              draggable={false}
            />
            {!menu && s && (
              <>
                {background === "attendance" && (
                  <>
                    <button
                      className="hotspot device"
                      style={rect(hotspots.device)}
                      aria-label={t("جهاز البصمة", "Attendance device")}
                      onClick={() => {
                        if (!s.checkedIn) act({ type: "checkIn" });
                        else if (completed(s) && s.minutes >= TIME.end)
                          act({ type: "checkOut" });
                        else
                          setNotice(
                            completed(s)
                              ? t(
                                  "أكمل أعمال اليوم حتى 18:00 أولًا.",
                                  "Complete work until 18:00 first.",
                                )
                              : t(
                                  "تم تسجيل الحضور. أكمل المواعيد قبل الخروج.",
                                  "Checked in. Complete your appointments before checkout.",
                                ),
                          );
                      }}
                      disabled={busy}
                    />
                    <div
                      className={`device-screen ${s.checkedIn ? "lit" : ""}`}
                      style={rect(hotspots.screen)}
                    >
                      {s.checkedOut
                        ? t("تم الخروج", "Checked out")
                        : s.checkedIn
                          ? t("تم التسجيل", "Checked in")
                          : t("مرحبًا", "Welcome")}
                    </div>
                    <button
                      className="hotspot entrance"
                      style={rect(hotspots.entrance)}
                      aria-label={t("الباب إلى الممر", "Door to corridor")}
                      onClick={() => void move("corridor")}
                      disabled={busy || s.checkedOut}
                    >
                      <span>{t("إلى الممر", "Corridor")} ←</span>
                    </button>
                  </>
                )}
                {background === "corridor" && (
                  <>
                    <button
                      className="hotspot clinic-door"
                      style={rect(hotspots.clinicDoor)}
                      aria-label={t(
                        "فتح باب العيادة النفسية",
                        "Open clinic door",
                      )}
                      onClick={() => void move("clinic")}
                      disabled={busy}
                    />
                    <button
                      className="clinic-sign"
                      style={rect(hotspots.clinicSign)}
                      onClick={() => void move("clinic")}
                      disabled={busy}
                    >
                      {t("العيادة النفسية", "Psychiatry")}
                    </button>
                  </>
                )}
                {background === "clinic" &&
                  session &&
                  !session.closed &&
                  s.phase !== "directorMeeting" && (
                    <button
                      className="chair-action"
                      style={{ left: "50%", top: "54%" }}
                      onClick={() => setPanel("patient")}
                    >
                      {t("التحدث إلى المريض", "Talk to patient")}{" "}
                      <span aria-hidden="true">↗</span>
                    </button>
                  )}
              </>
            )}
          </div>
        </div>
        {menu ? (
          <>
            <div className="menu-shade" />
            <header className="brand">
              <span className="brand-mark">م</span>
              <div>
                {t("مستشفى د. مروان باربود", "Dr. Marwan Barboud Hospital")}
                <small>
                  {t(
                    "مساحة للإنصات. فرصة للفهم.",
                    "A space to listen. A chance to understand.",
                  )}
                </small>
              </div>
              <button
                className="language"
                onClick={() =>
                  setSettings((v) => ({ ...v, language: en ? "ar" : "en" }))
                }
              >
                {en ? "العربية" : "EN"}
              </button>
            </header>
            <section className="main-menu">
              <div className="eyebrow">
                <span />{" "}
                {t("محاكاة قصصية تفاعلية", "AN INTERACTIVE STORY SIMULATION")}
              </div>
              <h1>
                {t("محاكي الطبيب", "The Psychiatrist")}
                <br />
                <em>{t("النفسي", "Simulator")}</em>
              </h1>
              <p className="intro">
                {t(
                  "خلف كل باب، حكاية تستحق أن تُسمع.",
                  "Behind every door, a story waiting to be heard.",
                )}
                <br />
                {t(
                  "ابدأ يومك، أنصت لمرضاك، واصنع فرقًا.",
                  "Begin your day, listen, and make a difference.",
                )}
              </p>
              <nav className="menu-actions">
                <button
                  className="primary large"
                  disabled={!ready || busy}
                  onClick={() => {
                    if (s) setPanel("new");
                    else void run(() => activate(createCareer()));
                  }}
                >
                  {t("لعبة جديدة", "New game")}{" "}
                  <span aria-hidden="true">←</span>
                </button>
                {s && (
                  <button
                    className="continue large"
                    disabled={busy}
                    onClick={() => {
                      setMenu(false);
                      setNotice("");
                    }}
                  >
                    {t("متابعة اللعب", "Continue")}
                    <small>
                      {t("اليوم", "Day")} {s.day} · {clockText(s.minutes)}
                    </small>
                  </button>
                )}
                <div className="menu-links">
                  <button onClick={() => setPanel("settings")}>
                    {t("الإعدادات", "Settings")}
                  </button>
                  <span>·</span>
                  <button onClick={() => setPanel("help")}>
                    {t("طريقة اللعب", "How to play")}
                  </button>
                  {s && (
                    <button
                      onClick={() =>
                        void listCareers().then((v) => {
                          setCareers(v);
                          setPanel("careers");
                        })
                      }
                    >
                      {t("المسيرات", "Careers")}
                    </button>
                  )}
                </div>
              </nav>
            </section>
            <footer className="menu-footer">
              <span>
                01 —{" "}
                {t(
                  "كل حكاية تبدأ بالإنصات",
                  "EVERY STORY BEGINS WITH LISTENING",
                )}
              </span>
              <span>
                {t(
                  "تجربة خيالية · حوار حر",
                  "FICTIONAL STORIES · FREE CONVERSATION",
                )}
              </span>
            </footer>
          </>
        ) : (
          s && (
            <>
              <header className="game-top">
                <div>
                  <small>
                    {t("مستشفى د. مروان باربود", "Dr. Marwan Barboud Hospital")}
                  </small>
                  <strong>
                    {t(
                      background === "attendance"
                        ? "الحضور والانصراف"
                        : background === "corridor"
                          ? "ممر العيادات"
                          : "العيادة النفسية",
                      background === "attendance"
                        ? "Attendance"
                        : background === "corridor"
                          ? "Clinic corridor"
                          : "Psychiatry clinic",
                    )}
                  </strong>
                </div>
                <div className="toolbar">
                  {incident && (
                    <button onClick={() => setPanel("director")}>
                      {t("استدعاء المدير", "Director meeting")}
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => {
                      setMenu(true);
                      setPanel(null);
                    }}
                  >
                    {t("القائمة", "Menu")}
                  </button>
                  <button onClick={() => setPanel("settings")}>
                    {t("الإعدادات", "Settings")}
                  </button>
                  <button onClick={() => setPanel("files")}>
                    {t("الملفات", "Files")}
                  </button>
                  <button onClick={() => setPanel("history")}>
                    {t("السجل", "Journal")}
                  </button>
                  <button onClick={() => setPanel("noura")}>
                    {t("نوره", "Noura")}
                    {s.alerts.some((a) => !a.resolved) && (
                      <i className="notification-dot" />
                    )}
                  </button>
                </div>
              </header>
              <div className="scene-caption">
                <span className="eyebrow">
                  {t("اليوم", "DAY")} {String(s.day).padStart(2, "0")}
                </span>
                <p>
                  {!s.checkedIn
                    ? t(
                        "ابدأ يومك بتسجيل الحضور على الجهاز.",
                        "Start your day by checking in at the device.",
                      )
                    : completed(s)
                      ? t(
                          "اكتملت مواعيد اليوم. أحسنت الإنصات.",
                          "All appointments complete. Thank you for listening.",
                        )
                      : background === "corridor"
                        ? t(
                            "عيادتك عند الباب الأقرب إلى اليمين.",
                            "Your clinic is behind the nearest door on the right.",
                          )
                        : background === "clinic"
                          ? patient
                            ? `${patient.core.name} · ${t("الزيارة", "Visit")} ${s.cursor + 1} / ${s.capacity}`
                            : t(
                                "تجهيز مواعيد اليوم…",
                                "Preparing today’s appointments…",
                              )
                          : t(
                              "تم تسجيل حضورك. الباب على اليسار.",
                              "You are checked in. The door is on the left.",
                            )}
                </p>
              </div>
              <nav className="game-bottom">
                {background !== "attendance" && (
                  <button
                    disabled={busy || s.phase === "directorMeeting"}
                    onClick={() =>
                      void move(
                        background === "clinic" ? "corridor" : "attendance",
                      )
                    }
                  >
                    <span aria-hidden="true">→ </span>
                    {t(
                      background === "clinic"
                        ? "العودة إلى الممر"
                        : "العودة إلى البصمة",
                      background === "clinic"
                        ? "Back to corridor"
                        : "Back to attendance",
                    )}
                  </button>
                )}
                {background === "clinic" && !s.prepared && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void prepare()}
                  >
                    {busy
                      ? t("جارٍ التجهيز…", "Preparing…")
                      : t(
                          "تجهيز المرضى / إعادة المحاولة",
                          "Prepare patients / Retry",
                        )}
                  </button>
                )}
                {completed(s) && !s.checkedOut && s.minutes < TIME.end && (
                  <button
                    className="primary"
                    disabled={busy || !!incident}
                    onClick={() => act({ type: "finishWork" })}
                  >
                    {t(
                      "استكمال أعمال اليوم حتى موعد الخروج",
                      "Finish paperwork until checkout",
                    )}
                  </button>
                )}
                {s.checkedIn && !s.checkedOut && !completed(s) && (
                  <button
                    disabled={busy}
                    onClick={() => act({ type: "break", id: uid() })}
                  >
                    {t("استراحة 15 دقيقة", "15-minute break")}
                  </button>
                )}
              </nav>
              <Clock minutes={s.minutes} day={s.day} en={en} />
              {!panel && notice && (
                <button
                  className="notice"
                  onClick={() => {
                    if (notice.startsWith("نوره") || notice.startsWith("Noura"))
                      setPanel("noura");
                    else setNotice("");
                  }}
                >
                  {notice} <span>×</span>
                </button>
              )}
              {s.phase === "dayReport" && !panel && (
                <div className="report-panel">
                  <span className="eyebrow">
                    {t("نهاية يوم العمل", "END OF THE WORKDAY")}
                  </span>
                  <h2>{t("يوم آخر من الإنصات", "Another day of listening")}</h2>
                  <p>
                    {t("الجلسات المكتملة", "Completed sessions")}: {s.cursor} ·{" "}
                    {t("الخروج", "Checkout")}: {clockText(s.minutes)}
                  </p>
                  <p>{disciplineText}</p>
                  <button onClick={() => setPanel("history")}>
                    {t("تفاصيل التقرير", "View report")}
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      act({ type: "nextDay" });
                      setNotice("");
                    }}
                  >
                    {t("بدء اليوم التالي", "Begin next day")} ←
                  </button>
                </div>
              )}
              {s.phase === "dismissed" && !panel && (
                <div className="report-panel">
                  <span className="eyebrow">
                    {t("نهاية المسيرة", "CAREER ENDED")}
                  </span>
                  <h2>
                    {t(
                      "انتهت خدمتك في المستشفى",
                      "Your hospital career has ended",
                    )}
                  </h2>
                  <p>
                    {t(
                      "صدر قرار الفصل بعد أربع مخالفات مثبتة. يبقى سجل المسيرة محفوظًا.",
                      "Four confirmed incidents resulted in dismissal. Your career record remains saved.",
                    )}
                  </p>
                  <button onClick={() => setPanel("history")}>
                    {t("مراجعة الأسباب والسجل", "Review reasons and record")}
                  </button>
                  <button onClick={() => setMenu(true)}>
                    {t("العودة للقائمة", "Main menu")}
                  </button>
                  <button className="primary" onClick={() => setPanel("new")}>
                    {t("مسيرة جديدة", "New career")}
                  </button>
                </div>
              )}
            </>
          )
        )}
        {error && (
          <div className="error-toast" role="alert">
            <p>{error}</p>
            <button
              onClick={() => setError("")}
              aria-label={t("إغلاق الخطأ", "Dismiss error")}
            >
              ×
            </button>
          </div>
        )}
        {panel === "settings" && (
          <Modal title={t("الإعدادات", "Settings")} onClose={close}>
            <div className="settings form-content">
              <label>
                {t("لغة الواجهة والحوار", "Interface & dialogue language")}
                <select
                  value={settings.language}
                  onChange={(e) =>
                    setSettings((v) => ({
                      ...v,
                      language: e.target.value as "ar" | "en",
                    }))
                  }
                >
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label>
                {t("مفتاح Gemini الشخصي", "Your Gemini API key")}
                <div className="input-row">
                  <input
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    dir="ltr"
                    value={settings.key}
                    onChange={(e) =>
                      setSettings((v) => ({ ...v, key: e.target.value }))
                    }
                  />
                  <button onClick={() => setShowKey(!showKey)}>
                    {showKey ? t("إخفاء", "Hide") : t("إظهار", "Show")}
                  </button>
                </div>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.remember}
                  onChange={(e) =>
                    setSettings((v) => ({ ...v, remember: e.target.checked }))
                  }
                />
                {t(
                  "حفظ المفتاح على هذا الجهاز فقط",
                  "Remember the key on this device only",
                )}
              </label>
              <p className="muted">
                {t(
                  "يُرسل المفتاح إلى Google فقط. لا يدخل ملفات الحفظ. إذا لم تحفظه، يُنسى عند إغلاق الصفحة. الحصة والأسعار بحسب حسابك ونموذجك.",
                  "The key is sent only to Google and excluded from saves. Without opt-in it is forgotten on reload. Quotas and pricing depend on your account and model.",
                )}
              </p>
              <label>
                {t("النموذج", "Model")}
                <select
                  dir="ltr"
                  value={
                    [
                      "gemini-3.5-flash-lite",
                      "gemini-3.8-flash",
                      ...models,
                    ].includes(settings.model)
                      ? settings.model
                      : "custom"
                  }
                  onChange={(e) => {
                    if (e.target.value !== "custom")
                      setSettings((v) => ({ ...v, model: e.target.value }));
                  }}
                >
                  {[
                    ...new Set([
                      "gemini-3.5-flash-lite",
                      "gemini-3.8-flash",
                      ...models,
                    ]),
                  ].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                  <option value="custom">
                    {t("اسم مخصص", "Custom model")}
                  </option>
                </select>
              </label>
              <label>
                {t("اسم النموذج القابل للتعديل", "Editable model name")}
                <input
                  dir="ltr"
                  value={settings.model}
                  onChange={(e) =>
                    setSettings((v) => ({
                      ...v,
                      model: e.target.value.trim().replace(/^models\//, ""),
                    }))
                  }
                />
              </label>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const available = await listModels(settings);
                      setModels(available);
                      await testConnection(settings);
                      setNotice(
                        t(
                          "نجح الاتصال وتحقق دعم الرد المنظم.",
                          "Connection and structured response verified.",
                        ),
                      );
                    })
                  }
                >
                  {busy
                    ? t("جارٍ الاختبار…", "Testing…")
                    : t("اختبار الاتصال", "Test connection")}
                </button>
                <button
                  onClick={() => {
                    setSettings((v) => ({ ...v, key: "", remember: false }));
                    setModels([]);
                  }}
                >
                  {t("حذف المفتاح", "Delete key")}
                </button>
              </div>
              {notice && <p role="status">{notice}</p>}
              <hr />
              <div className="button-row">
                <button disabled={!s} onClick={exportCurrent}>
                  {t("تصدير الحفظ JSON", "Export save JSON")}
                </button>
                <label className="file-button">
                  {t("استيراد حفظ", "Import save")}
                  <input
                    type="file"
                    accept="application/json,.json"
                    disabled={busy}
                    onChange={(e) => void importFile(e.target.files?.[0])}
                  />
                </label>
              </div>
              <p className="muted">
                {t(
                  "الاستيراد ينشئ نسخة مستقلة ولا يمس المسيرة السابقة.",
                  "Import creates an independent copy and preserves existing careers.",
                )}
              </p>
            </div>
          </Modal>
        )}
        {panel === "help" && (
          <Modal title={t("طريقة اللعب", "How to play")} onClose={close}>
            <div className="prose">
              <p>
                {t(
                  "أنت الطبيب النفسي في مستشفى د. مروان باربود. أنصت، اسأل بكلماتك، واتفق مع المريض على خطوة تالية واقعية.",
                  "You are the psychiatrist at Dr. Marwan Barboud Hospital. Listen, ask in your own words, and agree on a realistic next step.",
                )}
              </p>
              <ol>
                <li>
                  {t(
                    "أضف مفتاح Gemini في الإعدادات واختبر الاتصال.",
                    "Add your Gemini key in Settings and test it.",
                  )}
                </li>
                <li>
                  {t(
                    "سجّل الحضور على جهاز البصمة عند 10:00، ثم ادخل الباب الأيسر.",
                    "Check in at 10:00, then enter through the left door.",
                  )}
                </li>
                <li>
                  {t(
                    "افتح أقرب باب يمين الممر، واضغط زر الكرسي للتحدث.",
                    "Open the nearest right door and select the chair to talk.",
                  )}
                </li>
                <li>
                  {t(
                    "اكتب بحرية. نوره تساعدك في محادثة منفصلة. يراجع Gemini نهاية الجلسة؛ إن كانت ناقصة، تابع نفس الحوار.",
                    "Write freely. Noura offers private help. Gemini reviews closure; if incomplete, continue the same conversation.",
                  )}
                </li>
                <li>
                  {t(
                    "بعد 2–5 مرضى، أكمل أعمال اليوم حتى 18:00 وعد للبصمة للخروج. يمكن إكمال الجلسات المتأخرة.",
                    "After 2–5 patients, finish paperwork until 18:00 and return to check out. Late sessions may finish normally.",
                  )}
                </li>
              </ol>
              <p>
                {t(
                  "يتقدم الوقت بالأحداث المعتمدة فقط، لا أثناء الكتابة أو انتظار الشبكة. يُحفظ التقدم تلقائيًا على جهازك. Enter يرسل على الحاسوب؛ على الجوال استخدم زر إرسال.",
                  "Time advances only on accepted events, never while typing or waiting. Progress autosaves locally. Enter sends on desktop; use Send on mobile.",
                )}
              </p>
              <p>
                {t(
                  "المخالفات المثبتة بعد سماع ردك: تنبيه إداري، إنذار أول، إنذار نهائي، ثم فصل. طلب المساعدة أو رفض الإنهاء لا يسبب عقوبة.",
                  "Confirmed misconduct, after hearing your response: notice, first warning, final warning, dismissal. Asking for help or an incomplete review never causes punishment.",
                )}
              </p>
              <aside>
                {t(
                  "هذه لعبة عن بالغين خياليين وليست علاجًا أو تدريبًا مهنيًا معتمدًا. تتجه الأزمات داخل القصة إلى الإحالة والمساعدة المناسبة، بلا جرعات أدوية أو تعليمات مؤذية.",
                  "This is a game about fictional adults, not treatment or accredited clinical training. Story crises lead to appropriate referral and support, without drug dosages or harmful instructions.",
                )}
              </aside>
            </div>
          </Modal>
        )}
        {panel === "new" && (
          <Modal
            title={t("بدء مسيرة مستقلة", "Start an independent career")}
            onClose={close}
          >
            <div className="prose">
              <p>
                {t(
                  "سيُنشأ ملف جديد. لن تُحذف مسيرتك الحالية ويمكنك الرجوع إليها من «المسيرات».",
                  "A new save will be created. Your current career remains available under Careers.",
                )}
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void run(() => activate(createCareer()))}
              >
                {t("إنشاء مسيرة جديدة", "Create new career")}
              </button>
            </div>
          </Modal>
        )}
        {panel === "careers" && (
          <Modal
            title={t("المسيرات المحفوظة", "Saved careers")}
            onClose={close}
          >
            <div className="prose">
              {careers.map((c) => (
                <button
                  className="career-row"
                  key={c.id}
                  disabled={busy}
                  onClick={() => void run(() => activate(c))}
                >
                  <span>
                    {t("اليوم", "Day")} {c.day} · {clockText(c.minutes)}
                    <small>
                      {new Date(c.createdAt).toLocaleDateString(
                        en ? "en" : "ar",
                      )}{" "}
                      · {c.id.slice(0, 8)}
                    </small>
                  </span>
                  <span>
                    {c.phase === "dismissed"
                      ? t("مسيرة منتهية", "Career ended")
                      : "←"}
                  </span>
                </button>
              ))}
            </div>
          </Modal>
        )}
        {(panel === "patient" || panel === "noura" || panel === "director") &&
          s && (
            <Modal
              wide
              title={
                panel === "patient"
                  ? patient
                    ? `${patient.core.name} · ${patient.core.age} ${t("عامًا", "years")}`
                    : t("المريض", "Patient")
                  : panel === "noura"
                    ? t("حديث خاص مع نوره", "Private conversation with Noura")
                    : t(
                        "مكتب المدير · استدعاء إداري",
                        "Director · Administrative meeting",
                      )
              }
              onClose={close}
              closeLabel={t("تصغير المحادثة", "Minimize conversation")}
            >
              {panel === "patient" && session && patient ? (
                <>
                  <div className="chat-context">
                    <p>{patient.core.reason}</p>
                    <div className="button-row">
                      <button
                        onClick={() => {
                          setFileId(patient.id);
                          setPanel("files");
                        }}
                      >
                        {t("ملف المريض", "Patient file")}
                      </button>
                      <button onClick={() => setPanel("noura")}>
                        {t("سؤال نوره", "Ask Noura")}
                      </button>
                      <button
                        disabled={
                          busy ||
                          session.messages.some((m) => m.status !== "sent")
                        }
                        onClick={() => void endSession()}
                      >
                        {s.phase === "sessionReviewing"
                          ? t("مراجعة الجلسة…", "Reviewing…")
                          : t("إنهاء الجلسة", "End session")}
                      </button>
                    </div>
                    {session.reviews.at(-1)?.canEnd === false && (
                      <aside className="review-feedback">
                        <strong>
                          {t("نوره: قبل إنهاء الجلسة", "Noura: before closing")}
                        </strong>
                        <ul>
                          {session.reviews
                            .at(-1)!
                            .missingItems.map((item, i) => (
                              <li key={i}>{item}</li>
                            ))}
                        </ul>
                      </aside>
                    )}
                  </div>
                  <Chat
                    messages={session.messages}
                    draft={drafts.patient || ""}
                    onDraft={(v) => draft("patient", v)}
                    onSend={() => void send("patient")}
                    onRetry={(id) => void send("patient", id)}
                    busy={busy}
                    en={en}
                  />
                </>
              ) : panel === "noura" ? (
                <>
                  <div className="chat-context">
                    <p>
                      {t(
                        "اسأليني عمّا تحتاجه في الجلسة أو عن يوم العمل. حديثنا لا يراه المريض.",
                        "Ask me about the session or your workday. The patient cannot see this conversation.",
                      )}
                    </p>
                    {session && (
                      <button onClick={() => setPanel("patient")}>
                        {t("العودة إلى المريض", "Return to patient")}
                      </button>
                    )}
                  </div>
                  <Chat
                    messages={s.noura}
                    draft={drafts.noura || ""}
                    onDraft={(v) => draft("noura", v)}
                    onSend={() => void send("noura")}
                    onRetry={(id) => void send("noura", id)}
                    busy={busy}
                    en={en}
                  />
                </>
              ) : panel === "director" && incident ? (
                <>
                  <div className="chat-context">
                    <strong>{incident.reason}</strong>
                    <blockquote>{incident.quote}</blockquote>
                    <small>
                      {t("اليوم", "Day")} {incident.day} ·{" "}
                      {t(
                        "لم تُطبق عقوبة؛ اكتب ردك لتقييم الواقعة.",
                        "No penalty applied yet. Write your response for evaluation.",
                      )}
                    </small>
                  </div>
                  <Chat
                    messages={incident.meeting}
                    draft={drafts.director || ""}
                    onDraft={(v) => draft("director", v)}
                    onSend={() => void send("director")}
                    onRetry={(id) => void send("director", id)}
                    busy={busy}
                    en={en}
                  />
                </>
              ) : (
                <p className="prose">
                  {t("لا توجد محادثة نشطة.", "No active conversation.")}
                </p>
              )}
            </Modal>
          )}
        {panel === "files" && s && (
          <Modal
            wide
            title={t("ملفات المرضى", "Patient files")}
            onClose={close}
          >
            <div className="file-layout">
              <aside>
                <input
                  aria-label={t("البحث في المرضى", "Search patients")}
                  placeholder={t("بحث بالاسم…", "Search names…")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {Object.values(s.patients)
                  .filter(
                    (p) =>
                      p.core.name.includes(search) ||
                      p.core.reason.includes(search),
                  )
                  .map((p) => (
                    <button
                      key={p.id}
                      className={fileId === p.id ? "selected" : ""}
                      onClick={() => setFileId(p.id)}
                    >
                      {p.core.name}
                      <small>{p.core.reason}</small>
                    </button>
                  ))}
              </aside>
              <section>
                {(() => {
                  const p = s.patients[fileId] || patient;
                  if (!p)
                    return <p>{t("اختر ملف مريض.", "Select a patient.")}</p>;
                  return (
                    <>
                      <h3>
                        {p.core.name} · {p.core.age}
                      </h3>
                      <p>{p.core.background}</p>
                      <p>{p.core.reason}</p>
                      <p>
                        {t("موعد المتابعة", "Follow-up")}:{" "}
                        {p.nextFollowUp
                          ? `${t("اليوم", "Day")} ${p.nextFollowUp}`
                          : t("غير محدد", "Not scheduled")}
                      </p>
                      <label>
                        {t("ملاحظات الطبيب", "Doctor notes")}
                        <textarea
                          rows={5}
                          maxLength={30000}
                          value={p.notes}
                          onChange={(e) =>
                            void commit({
                              type: "notes",
                              patientId: p.id,
                              text: e.target.value,
                            }).catch(() =>
                              setError(
                                t("تعذر حفظ الملاحظات", "Could not save notes"),
                              ),
                            )
                          }
                        />
                      </label>
                      {p.history.map((h) => (
                        <article className="history-entry" key={h.sessionId}>
                          <h4>
                            {t("اليوم", "Day")} {h.day}
                          </h4>
                          <p>{h.summary}</p>
                          <p>{h.plan}</p>
                          <details>
                            <summary>
                              {t("سجل الجلسة", "Session transcript")}
                            </summary>
                            {s.sessions[h.sessionId]?.messages.map((m) => (
                              <p key={m.id}>
                                <strong>
                                  {m.role === "doctor"
                                    ? t("أنت", "You")
                                    : p.core.name}
                                  :{" "}
                                </strong>
                                {m.text}
                              </p>
                            ))}
                          </details>
                        </article>
                      ))}
                    </>
                  );
                })()}
              </section>
            </div>
          </Modal>
        )}
        {panel === "history" && s && (
          <Modal
            wide
            title={t(
              "سجل الأيام والإنذارات",
              "Day reports & administrative record",
            )}
            onClose={close}
          >
            <div className="prose">
              <p>{disciplineText}</p>
              {s.reports.length === 0 && (
                <p>
                  {t(
                    "سيظهر أول تقرير بعد تسجيل الخروج.",
                    "Your first report appears after checkout.",
                  )}
                </p>
              )}
              {s.reports.map((r) => (
                <article className="history-entry" key={r.day}>
                  <h3>
                    {t("اليوم", "Day")} {r.day} · {clockText(r.checkout)}
                  </h3>
                  <p>
                    {r.completed} {t("جلسات مكتملة", "completed sessions")} ·{" "}
                    {r.checkout > 1080
                      ? t("خروج متأخر", "Late checkout")
                      : t("خروج في الموعد", "On-time checkout")}
                  </p>
                  {r.summaries.map((v, i) => (
                    <p key={i}>{v}</p>
                  ))}
                </article>
              ))}
              {s.rescheduled.map((r, i) => (
                <p key={i}>
                  {s.patients[r.patientId]?.core.name}:{" "}
                  {t("أُعيدت المتابعة من اليوم", "Follow-up moved from day")}{" "}
                  {r.from} {t("إلى", "to")} {r.to}
                </p>
              ))}
              {s.incidents.map((i) => (
                <article className="history-entry" key={i.id}>
                  <h3>
                    {t("واقعة في اليوم", "Incident on day")} {i.day}
                  </h3>
                  <p>{i.reason}</p>
                  <blockquote>{i.quote}</blockquote>
                  <p>
                    {i.decision || t("بانتظار التقييم", "Awaiting evaluation")}
                  </p>
                  <p>
                    {i.status === "confirmed"
                      ? en
                        ? [
                            "",
                            "Administrative notice",
                            "First warning",
                            "Final warning",
                            "Dismissal",
                          ][i.level]
                        : disciplinaryLabels[i.level]
                      : i.status === "dismissed"
                        ? t("لم تثبت مخالفة", "Not substantiated")
                        : t("استدعاء معلق", "Pending meeting")}
                  </p>
                  {i.meeting.map((m) => (
                    <p key={m.id}>
                      {m.role === "doctor"
                        ? t("أنت", "You")
                        : t("المدير", "Director")}
                      : {m.text}
                    </p>
                  ))}
                </article>
              ))}
              <details>
                <summary>{t("أحداث الوقت", "Time events")}</summary>
                {s.timeEvents.map((e) => (
                  <p key={e.id}>
                    {t("اليوم", "Day")} {e.day} · {e.kind} · {clockText(e.from)}{" "}
                    → {clockText(e.to)}
                  </p>
                ))}
              </details>
              <details>
                <summary>
                  {t("سجل تنبيهات نوره", "Noura alert history")}
                </summary>
                {s.alerts.map((a) => (
                  <p key={a.sessionId + a.id}>
                    {a.text} {a.resolved ? "✓" : ""}
                  </p>
                ))}
              </details>
            </div>
          </Modal>
        )}
      </main>
    </ErrorContext.Provider>
  );
}
