import { useEffect, useId, useRef, type ReactNode } from "react";

/** Native modal semantics contain keyboard focus; only its body scrolls. */
export function DetailDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const activator = document.activeElement;
    const element = dialog.current!;
    element.showModal();

    return () => {
      element.close();
      if (activator instanceof HTMLElement && activator.isConnected) {
        activator.focus({ preventScroll: true });
      }
    };
  }, []);
  useEffect(() => {
    const body = dialog.current?.querySelector<HTMLElement>(".dialog-scroll");
    if (body) {
      body.scrollTop = 0;
    }
    dialog.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
  }, [title]);
  return (
    <dialog
      ref={dialog}
      className="detail-dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Tab") {
          return;
        }
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
          ),
        ].filter((element) => element.getClientRects().length > 0);
        if (!controls.length) {
          return;
        }
        event.preventDefault();
        const index = controls.indexOf(document.activeElement as HTMLElement);
        const next =
          (index + (event.shiftKey ? -1 : 1) + controls.length) %
          controls.length;
        controls[next]!.focus({ preventScroll: true });
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          className="button button-outline"
          onClick={onClose}
          aria-label="Cerrar diálogo"
        >
          Cerrar ×
        </button>
      </header>
      <div className="dialog-scroll" tabIndex={0}>
        {children}
      </div>
    </dialog>
  );
}
