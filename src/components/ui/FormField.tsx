"use client";

import { useId } from "react";

/**
 * A label + control + helper/error text wrapper — every form control in
 * this file composes with it rather than each one re-implementing
 * label association, so "form controls require labels" (this phase's
 * own accessibility requirement) is structural, not a convention to
 * remember. `useId()` generates a stable id when the caller doesn't
 * supply one, so `htmlFor`/`aria-describedby` always line up correctly
 * even if the same field renders twice on a page.
 */
export function FormField({
  label,
  htmlFor,
  helperText,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const helperId = helperText ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label uppercase tracking-wide text-brand-muted">
        {label}
        {required && (
          <span aria-hidden="true" className="text-brand-danger">
            {" "}
            *
          </span>
        )}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": !!error })}
      {helperText && !error && (
        <p id={helperId} className="text-caption text-brand-muted">
          {helperText}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-caption text-brand-danger">
          {error}
        </p>
      )}
    </div>
  );
}
