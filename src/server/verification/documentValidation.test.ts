import { describe, expect, it } from "vitest";
import { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_BYTES, buildVerificationDocumentPath, sanitizeFullNameForStoragePath, validateDocumentFile } from "./documentValidation";

describe("MAX_DOCUMENT_BYTES — exactly 2 MiB", () => {
  it("is precisely 2097152 bytes", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(2097152);
  });
});

describe("validateDocumentFile — 2 MB boundary and MIME allowlist", () => {
  it("accepts a file of exactly 2 MB (2097152 bytes)", () => {
    expect(validateDocumentFile({ type: "application/pdf", size: 2097152 })).toEqual({ ok: true });
  });

  it("rejects a file one byte over 2 MB", () => {
    const result = validateDocumentFile({ type: "application/pdf", size: 2097153 });
    expect(result).toEqual({ ok: false, error: "The file is larger than 2 MB." });
  });

  it("rejects a file well over 2 MB — server-side check, independent of any client bypass", () => {
    const result = validateDocumentFile({ type: "image/jpeg", size: 10 * 1024 * 1024 });
    expect(result.ok).toBe(false);
  });

  it("accepts every allowed MIME type (png, jpeg, pdf)", () => {
    for (const type of ALLOWED_DOCUMENT_MIME_TYPES) {
      expect(validateDocumentFile({ type, size: 1024 })).toEqual({ ok: true });
    }
  });

  it("rejects a disallowed MIME type even at a tiny size", () => {
    const result = validateDocumentFile({ type: "application/msword", size: 1 });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(validateDocumentFile({ type: "application/pdf", size: 0 })).toEqual({ ok: false, error: "The selected file is empty." });
  });
});

describe("sanitizeFullNameForStoragePath — human-readable, safe folder base names", () => {
  it("a normal first+last name produces the expected base", () => {
    expect(sanitizeFullNameForStoragePath("Lehlohonolo Maishoane")).toBe("Lehlohonolo_Maishoane");
  });

  it("handles multiple/irregular spacing", () => {
    expect(sanitizeFullNameForStoragePath("  Lehlohonolo    Maishoane  ")).toBe("Lehlohonolo_Maishoane");
  });

  it("strips accents/diacritics rather than rejecting them", () => {
    expect(sanitizeFullNameForStoragePath("José Núñez")).toBe("Jose_Nunez");
  });

  it("strips apostrophes, hyphens and other punctuation", () => {
    expect(sanitizeFullNameForStoragePath("O'Brien Smith-Jones")).toBe("OBrien_SmithJones");
  });

  it("uses first and last word of a multi-word (e.g. middle-named) name, dropping the middle", () => {
    expect(sanitizeFullNameForStoragePath("Thabo Sipho Nkosi")).toBe("Thabo_Nkosi");
  });

  it("a single-word name produces just that word, no trailing underscore", () => {
    expect(sanitizeFullNameForStoragePath("Madonna")).toBe("Madonna");
  });

  it("a name that sanitizes to nothing at all falls back to a safe generic base", () => {
    expect(sanitizeFullNameForStoragePath("!!! @@@ ###")).toBe("verified_user");
    expect(sanitizeFullNameForStoragePath("")).toBe("verified_user");
    expect(sanitizeFullNameForStoragePath("   ")).toBe("verified_user");
  });

  it("path traversal / path-structure characters can never survive sanitization", () => {
    const result = sanitizeFullNameForStoragePath("../../etc/passwd");
    expect(result).not.toMatch(/[./\\]/);
    expect(result).not.toContain("..");
  });

  it("a name embedding a null byte or control characters is stripped down to only safe characters", () => {
    expect(sanitizeFullNameForStoragePath("Evil\u0000Name Here")).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it("truncates a pathologically long name token rather than producing an unbounded path segment", () => {
    const huge = "A".repeat(500) + " " + "B".repeat(500);
    const result = sanitizeFullNameForStoragePath(huge);
    // "A"*40 + "_" + "B"*40
    expect(result.length).toBe(81);
    expect(result).toMatch(/^A{40}_B{40}$/);
  });

  it("output only ever contains ASCII letters, digits and underscore — never a byte that could be mistaken for a path separator", () => {
    const cases = ["Anne-Marie O'Malley", "François Müller", "李 明", "Test123 User456", "   trailing.dots.. "];
    for (const c of cases) {
      expect(sanitizeFullNameForStoragePath(c)).toMatch(/^[A-Za-z0-9_]+$/);
    }
  });
});

describe("buildVerificationDocumentPath — joins an already-allocated folder to a filename", () => {
  it("builds <folder>/id-document.<ext> for each known MIME type", () => {
    expect(buildVerificationDocumentPath("Lehlohonolo_Maishoane_01", "application/pdf")).toBe("Lehlohonolo_Maishoane_01/id-document.pdf");
    expect(buildVerificationDocumentPath("Lehlohonolo_Maishoane_01", "image/png")).toBe("Lehlohonolo_Maishoane_01/id-document.png");
    expect(buildVerificationDocumentPath("Lehlohonolo_Maishoane_01", "image/jpeg")).toBe("Lehlohonolo_Maishoane_01/id-document.jpg");
  });
});
