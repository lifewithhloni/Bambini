import { describe, expect, it } from "vitest";
import {
  MAX_IMAGES_PER_LISTING,
  MAX_IMAGE_BYTES,
  buildImageStoragePath,
  validateImageCount,
  validateImageFile,
} from "./imageValidation";

describe("validateImageFile", () => {
  it("accepts a valid png/jpeg/webp within the size limit", () => {
    expect(validateImageFile({ type: "image/png", size: 1024 })).toEqual({ ok: true });
    expect(validateImageFile({ type: "image/jpeg", size: 1024 })).toEqual({ ok: true });
    expect(validateImageFile({ type: "image/webp", size: 1024 })).toEqual({ ok: true });
  });

  it("rejects an unsupported mime type", () => {
    const r = validateImageFile({ type: "application/pdf", size: 1024, name: "doc.pdf" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/doc\.pdf/);
  });

  it("rejects a file over the size limit", () => {
    const r = validateImageFile({ type: "image/png", size: MAX_IMAGE_BYTES + 1 });
    expect(r.ok).toBe(false);
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validateImageFile({ type: "image/png", size: MAX_IMAGE_BYTES }).ok).toBe(true);
  });

  it("rejects an empty file", () => {
    expect(validateImageFile({ type: "image/png", size: 0 }).ok).toBe(false);
  });

  it("rejects a disguised file — an .svg or .exe renamed with an allowed extension is still checked by MIME type, not filename", () => {
    const r = validateImageFile({ type: "image/svg+xml", size: 100, name: "photo.png" });
    expect(r.ok).toBe(false);
  });
});

describe("validateImageCount", () => {
  it("allows staying within the per-listing cap", () => {
    expect(validateImageCount(0, MAX_IMAGES_PER_LISTING)).toEqual({ ok: true });
    expect(validateImageCount(3, 2)).toEqual({ ok: true });
  });

  it("rejects exceeding the cap, whether in one batch or cumulatively", () => {
    expect(validateImageCount(0, MAX_IMAGES_PER_LISTING + 1).ok).toBe(false);
    expect(validateImageCount(MAX_IMAGES_PER_LISTING, 1).ok).toBe(false);
  });

  it("adding zero images is always fine", () => {
    expect(validateImageCount(MAX_IMAGES_PER_LISTING, 0)).toEqual({ ok: true });
  });
});

describe("buildImageStoragePath", () => {
  it("builds a path prefixed with the product id, matching the storage RLS convention", () => {
    const path = buildImageStoragePath("prod-123", "image/jpeg", "rand-456");
    expect(path).toBe("prod-123/rand-456.jpg");
    expect(path.startsWith("prod-123/")).toBe(true);
  });

  it("maps each allowed mime type to a sane extension", () => {
    expect(buildImageStoragePath("p", "image/png", "r")).toBe("p/r.png");
    expect(buildImageStoragePath("p", "image/webp", "r")).toBe("p/r.webp");
  });
});
