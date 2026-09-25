"use client";

import { useEffect, useRef } from "react";
import { X } from "./icons";
import { IconButton } from "./IconButton";

/**
 * The mobile counterpart to Modal — same native <dialog> foundation
 * (see Modal.tsx for why), positioned flush to the bottom of the
 * viewport with only the top corners rounded (--radius-sheet), plus a
 * drag-handle affordance. Used for mobile-native interactions like
 * filters or action sheets; Modal remains the desktop/general-purpose
 * dialog.
 */
export function BottomSheet({
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
      aria-labelledby="bambini-sheet-title"
      className="m-0 mt-auto max-h-[85vh] w-full max-w-none rounded-t-sheet rounded-b-none border-0 border-t border-brand-border bg-brand-surface p-0 shadow-elevated backdrop:bg-bambini-charcoal/40"
    >
      <div className="flex justify-center pt-2.5">
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-brand-border" />
      </div>
      <div className="flex items-center justify-between px-5 py-3">
        <h2 id="bambini-sheet-title" className="text-heading-section text-brand-ink">
          {title}
        </h2>
        <IconButton aria-label="Close" onClick={onClose}>
          <X className="h-5 w-5" aria-hidden="true" />
        </IconButton>
      </div>
      <div className="overflow-y-auto px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">{children}</div>
    </dialog>
  );
}
