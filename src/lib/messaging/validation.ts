/**
 * Pure — the one place a message body is cleaned and checked before it
 * ever reaches the database. Plain text only: there is no rich-text or
 * HTML support anywhere, and the body is always rendered as text (React
 * escapes it), so this normalises rather than "sanitises" markup. The
 * database independently enforces the same two rules (whitespace-only and
 * > MAX_MESSAGE_LENGTH are rejected by CHECK constraints — see
 * 20261012090000_messaging_hardening.sql), so this is for a friendly
 * message and clean storage, never the security boundary.
 */
export const MAX_MESSAGE_LENGTH = 2000;

export type MessageBodyResult = { ok: true; body: string } | { ok: false; error: string };

export function normalizeMessageBody(raw: unknown): MessageBodyResult {
  if (typeof raw !== "string") return { ok: false, error: "Write a message first." };

  const body = raw
    .replace(/\r\n?/g, "\n")
    // Drop control characters other than newline/tab — they have no place in a chat message.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    // No more than one blank line in a row.
    .replace(/\n{3,}/g, "\n\n");

  if (body.length === 0) return { ok: false, error: "Write a message first." };
  if (body.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `Messages can be up to ${MAX_MESSAGE_LENGTH} characters.` };

  return { ok: true, body };
}

/** One-line preview for the inbox: newlines collapsed, cut on a word boundary where possible. */
export function messagePreview(body: string, maxLength = 90): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLength) return flat;
  const cut = flat.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
