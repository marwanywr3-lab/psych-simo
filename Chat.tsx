import { useEffect, useRef } from "react";
import type { Message } from "../game/schemas";
export function Chat({
  messages,
  draft,
  onDraft,
  onSend,
  busy,
  onRetry,
  en,
}: {
  messages: Message[];
  draft: string;
  onDraft: (s: string) => void;
  onSend: () => void;
  busy: boolean;
  onRetry: (id: string) => void;
  en: boolean;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, busy]);
  const pending = messages.find((m) => m.status !== "sent");
  return (
    <>
      <div className="messages" aria-live="polite" role="log">
        {messages.map((m) => (
          <article className={`bubble ${m.role}`} key={m.id}>
            <small>
              {m.role === "doctor"
                ? en
                  ? "You"
                  : "أنت"
                : m.role === "noura"
                  ? en
                    ? "Noura"
                    : "نوره"
                  : m.role === "director"
                    ? en
                      ? "Director"
                      : "المدير"
                    : en
                      ? "Patient"
                      : "المريض"}
            </small>
            <p>{m.text}</p>
            {m.status !== "sent" && (
              <div className="message-status">
                {busy ? (
                  en ? (
                    "Waiting for Gemini…"
                  ) : (
                    "بانتظار Gemini…"
                  )
                ) : (
                  <button onClick={() => onRetry(m.id)}>
                    {en ? "Retry this message" : "إعادة محاولة الرسالة"}
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
        {busy && (
          <p className="waiting">
            {en
              ? "One moment… game time is paused."
              : "لحظة من فضلك… وقت اللعبة متوقف."}
          </p>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          {en ? "Your message" : "رسالتك"}
        </label>
        <textarea
          id="chat-input"
          maxLength={16000}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder={en ? "Write freely…" : "اكتب كلامك بحرية…"}
          rows={3}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              window.matchMedia("(pointer: fine)").matches
            ) {
              e.preventDefault();
              if (!busy && !pending && draft.trim()) onSend();
            }
          }}
        />
        <div className="composer-bottom">
          <small>
            {en
              ? "Enter to send · Shift+Enter for a new line"
              : "Enter للإرسال · Shift+Enter لسطر جديد"}
          </small>
          <button
            className="primary"
            disabled={busy || !!pending || !draft.trim()}
          >
            {en ? "Send" : "إرسال"} <span aria-hidden="true">↗</span>
          </button>
        </div>
      </form>
    </>
  );
}
