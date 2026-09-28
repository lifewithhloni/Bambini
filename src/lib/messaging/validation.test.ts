import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_LENGTH, messagePreview, normalizeMessageBody } from "./validation";

describe("normalizeMessageBody", () => {
  it("O. rejects an empty message", () => {
    expect(normalizeMessageBody("")).toEqual({ ok: false, error: expect.any(String) });
  });

  it("O. rejects a whitespace-only message, including tabs and newlines", () => {
    expect(normalizeMessageBody("   \n\t \r\n ").ok).toBe(false);
  });

  it("rejects a non-string value outright", () => {
    expect(normalizeMessageBody(null).ok).toBe(false);
    expect(normalizeMessageBody(undefined).ok).toBe(false);
    expect(normalizeMessageBody(42).ok).toBe(false);
  });

  it("P. accepts exactly the maximum length and rejects one more", () => {
    expect(normalizeMessageBody("x".repeat(MAX_MESSAGE_LENGTH)).ok).toBe(true);
    expect(normalizeMessageBody("x".repeat(MAX_MESSAGE_LENGTH + 1))).toEqual({ ok: false, error: expect.stringContaining(String(MAX_MESSAGE_LENGTH)) });
  });

  it("trims surrounding whitespace but keeps the message itself", () => {
    expect(normalizeMessageBody("  Is this still available?  \n")).toEqual({ ok: true, body: "Is this still available?" });
  });

  it("normalises Windows/old-Mac line endings to \\n", () => {
    expect(normalizeMessageBody("a\r\nb\rc")).toEqual({ ok: true, body: "a\nb\nc" });
  });

  it("keeps normal multiline messages and single blank lines", () => {
    expect(normalizeMessageBody("Hi\n\nAre you free tomorrow?")).toEqual({ ok: true, body: "Hi\n\nAre you free tomorrow?" });
  });

  it("collapses runs of blank lines to one", () => {
    expect(normalizeMessageBody("a\n\n\n\n\nb")).toEqual({ ok: true, body: "a\n\nb" });
  });

  it("strips control characters but keeps tabs and newlines", () => {
    expect(normalizeMessageBody("he\u0000llo\u0007\tthere\nfriend")).toEqual({ ok: true, body: "hello\tthere\nfriend" });
  });

  it("leaves markup as inert text — nothing is rendered as HTML, so there is nothing to strip or execute", () => {
    expect(normalizeMessageBody("<script>alert(1)</script> <b>hi</b>")).toEqual({ ok: true, body: "<script>alert(1)</script> <b>hi</b>" });
  });
});

describe("messagePreview", () => {
  it("returns a short message unchanged, flattened to one line", () => {
    expect(messagePreview("Hello\nthere")).toBe("Hello there");
  });

  it("truncates a long message with an ellipsis, on a word boundary when possible", () => {
    const preview = messagePreview("word ".repeat(40), 30);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(31);
    expect(preview).not.toMatch(/wor…$/);
  });
});
