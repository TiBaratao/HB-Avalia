"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo acessível: fecha com Esc, prende o foco dentro da janela,
 * move o foco para o primeiro controle ao abrir e devolve o foco ao
 * elemento de origem ao fechar, além de bloquear o scroll do fundo.
 */
export function Modal({
  title,
  onClose,
  children,
  actions,
  variant = "dialog",
  closeOnScrim = true,
  initialFocusRef,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  variant?: "dialog" | "alertdialog";
  closeOnScrim?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const titleId = useId();
  const containerRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;
    const focusable = container ? Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
    (initialFocusRef?.current ?? focusable[0] ?? container)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [initialFocusRef]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="dialog-scrim"
      onMouseDown={(event) => {
        if (closeOnScrim && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={containerRef}
        className="demo-dialog"
        role={variant}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dialog-heading">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        {children}
        {actions && <div className="dialog-actions">{actions}</div>}
      </section>
    </div>
  );
}

/**
 * Botão que abre um diálogo de confirmação antes de executar uma ação destrutiva.
 */
export function ConfirmButton({
  children,
  dialogTitle,
  description,
  confirmLabel = "Excluir",
  busyLabel = "Excluindo…",
  className = "button button-outline button-small",
  disabled = false,
  title,
  onConfirm,
}: {
  children: ReactNode;
  dialogTitle: string;
  description: ReactNode;
  confirmLabel?: string;
  busyLabel?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
  onConfirm: () => Promise<unknown> | unknown;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <>
      <button type="button" className={className} disabled={disabled} title={title} aria-haspopup="dialog" onClick={() => setOpen(true)}>{children}</button>
      {open && (
        <Modal
          title={dialogTitle}
          variant="alertdialog"
          closeOnScrim={!busy}
          initialFocusRef={cancelRef}
          onClose={() => { if (!busy) setOpen(false); }}
          actions={
            <>
              <button ref={cancelRef} type="button" className="button button-outline" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button>
              <button type="button" className="button button-danger" disabled={busy} onClick={() => void confirm()}>{busy ? busyLabel : confirmLabel}</button>
            </>
          }
        >
          <div className="dialog-description">{description}</div>
        </Modal>
      )}
    </>
  );
}
