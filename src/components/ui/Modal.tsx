"use client";

import { useEffect, useRef } from "react";
import { X } from "./icons";
import { IconButton } from "./IconButton";

/**
 * Built on the native <dialog> element rather than a hand-rolled
 * focus-trap/portal — the browser already provides top-layer stacking,
 * Escape-to-close, and a sensible initial focus target for free, with
 * no new dependency. `open` is a controlled prop; the effect below is
 * just what bridges React state to <dialog>'s imperative
 * showModal()/close() API, which has no declarative equivalent.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="bambini-modal-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card-lg border border-brand-border bg-brand-surface p-0 shadow-elevated backdrop:bg-bambini-charcoal/40"
    >
      <div className="flex items-center justify-between border-b border-brand-border px-5 py-4">
        <h2 id="bambini-modal-title" className="text-heading-section text-brand-ink">
          {title}
        </h2>
        <IconButton aria-label="Close" onClick={onClose}>
          <X className="h-5 w-5" aria-hidden="true" />
        </IconButton>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
