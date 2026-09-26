import { describe, expect, it } from "vitest";
import { addIdPure, removeIdPure, parseStoredIds } from "./cartStorage";

describe("addIdPure", () => {
  it("appends a new id", () => {
    expect(addIdPure(["a"], "b")).toEqual(["a", "b"]);
  });

  it("a listing is a unique item, never a quantity — adding an id already present is a no-op, not a duplicate/increment", () => {
    expect(addIdPure(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("adding to an empty cart works", () => {
    expect(addIdPure([], "a")).toEqual(["a"]);
  });

  it("never mutates the input array", () => {
    const input = ["a"];
    addIdPure(input, "b");
    expect(input).toEqual(["a"]);
  });

  it("caps the cart at a sane maximum rather than growing unbounded", () => {
    const full = Array.from({ length: 100 }, (_, i) => `id-${i}`);
    expect(addIdPure(full, "one-too-many")).toHaveLength(100);
  });
});

describe("removeIdPure", () => {
  it("removes the matching id", () => {
    expect(removeIdPure(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("removing an id not present is a no-op", () => {
    expect(removeIdPure(["a"], "z")).toEqual(["a"]);
  });

  it("removing from an empty cart is a no-op", () => {
    expect(removeIdPure([], "a")).toEqual([]);
  });

  it("never mutates the input array", () => {
    const input = ["a", "b"];
    removeIdPure(input, "a");
    expect(input).toEqual(["a", "b"]);
  });
});

describe("parseStoredIds", () => {
  it("parses a valid JSON array of strings", () => {
    expect(parseStoredIds('["a","b"]')).toEqual(["a", "b"]);
  });

  it("returns an empty array for null (nothing stored yet)", () => {
    expect(parseStoredIds(null)).toEqual([]);
  });

  it("returns an empty array for corrupted/invalid JSON, never throwing", () => {
    expect(parseStoredIds("{not valid json")).toEqual([]);
  });

  it("returns an empty array for valid JSON that isn't an array", () => {
    expect(parseStoredIds('{"a":1}')).toEqual([]);
  });

  it("filters out any non-string entries — never trusts stored shape blindly", () => {
    expect(parseStoredIds('["a", 1, null, "b", {}]')).toEqual(["a", "b"]);
  });

  it("caps at the same maximum as addIdPure, even for tampered/oversized stored data", () => {
    const oversized = JSON.stringify(Array.from({ length: 500 }, (_, i) => `id-${i}`));
    expect(parseStoredIds(oversized)).toHaveLength(100);
  });
});
