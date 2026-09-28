import { describe, expect, it } from "vitest";
import { classifySavedItem, savedItemShowsDetails } from "./savedItemStatus";

describe("classifySavedItem", () => {
  it("I. a published product is available", () => {
    expect(classifySavedItem({ status: "published" })).toBe("available");
  });

  it("J. a sold product is unavailable-as-sold", () => {
    expect(classifySavedItem({ status: "sold" })).toBe("sold");
  });

  it("K. an archived product is unavailable", () => {
    expect(classifySavedItem({ status: "archived" })).toBe("unavailable");
  });

  it("a draft product is unavailable too, never treated as purchasable", () => {
    expect(classifySavedItem({ status: "draft" })).toBe("unavailable");
  });

  it("L. a missing product is handled gracefully as removed", () => {
    expect(classifySavedItem(null)).toBe("removed");
    expect(classifySavedItem(undefined)).toBe("removed");
  });

  it("an unrecognised status is never treated as available", () => {
    expect(classifySavedItem({ status: "something_new" })).toBe("unavailable");
  });
});

describe("savedItemShowsDetails", () => {
  it("shows details only for available and sold items — both were public; archived/draft may never have been", () => {
    expect(savedItemShowsDetails("available")).toBe(true);
    expect(savedItemShowsDetails("sold")).toBe(true);
    expect(savedItemShowsDetails("unavailable")).toBe(false);
    expect(savedItemShowsDetails("removed")).toBe(false);
  });
});
