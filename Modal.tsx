import {
  useEffect,
  useRef,
  createContext,
  useContext,
  type ReactNode,
} from "react";
export const ErrorContext = createContext({ error: "", clear: () => {} });
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  closeLabel = "إغلاق / Close",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  closeLabel?: string;
}) {
  const { error, clear } = useContext(ErrorContext);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current,
      prior = document.activeElement as HTMLElement;
    el?.showModal();
    return () => {
      el?.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label={closeLabel}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button onClick={clear} aria-label="إغلاق / Close">
            ×
          </button>
        </div>
      )}
      {children}
    </dialog>
  );
}
