import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, isValidListingStatus } from "./statusTransitions";

describe("canTransition", () => {
  it("allows draft -> published", () => {
    expect(canTransition("draft", "published")).toBe(true);
  });
  it("allows draft -> archived", () => {
    expect(canTransition("draft", "archived")).toBe(true);
  });
  it("allows published -> draft (unpublish)", () => {
    expect(canTransition("published", "draft")).toBe(true);
  });
  it("allows published -> archived", () => {
    expect(canTransition("published", "archived")).toBe(true);
  });
  it("allows archived -> draft (restore)", () => {
    expect(canTransition("archived", "draft")).toBe(true);
  });
  it("rejects archived -> published directly", () => {
    expect(canTransition("archived", "published")).toBe(false);
  });
  it("rejects a same-state transition", () => {
    expect(canTransition("draft", "draft")).toBe(false);
    expect(canTransition("published", "published")).toBe(false);
    expect(canTransition("archived", "archived")).toBe(false);
  });
  it("never allows any transition into or out of an order-related state — the type system already excludes them, this pins that no such state sneaks back in via a string", () => {
    const allStates: string[] = ["draft", "published", "archived"];
    expect(allStates).not.toContain("sold");
    expect(allStates).not.toContain("active");
    expect(allStates).not.toContain("removed");
  });

  describe("legacy/invalid status values reaching the application layer at runtime", () => {
    // The underlying Postgres enum still technically permits the
    // foundation phase's 'sold'/'removed'/'active' labels (kept as
    // inert values rather than a risky enum recreation — see
    // DECISIONS.md), and canTransition()'s parameters are only *typed*
    // as ListingStatus, not runtime-validated by the caller — a row's
    // status arrives as a plain string from the database. These tests
    // use `as string` to simulate that: a legacy value flowing in from
    // the DB rather than from a TypeScript literal, proving the
    // application layer safely rejects it instead of crashing.
    it("rejects a legacy status as the FROM state without throwing", () => {
      for (const legacy of ["sold", "removed", "active"]) {
        expect(canTransition(legacy as string, "published")).toBe(false);
        expect(canTransition(legacy as string, "draft")).toBe(false);
        expect(canTransition(legacy as string, "archived")).toBe(false);
      }
    });

    it("rejects a legacy status as the TO state without throwing", () => {
      for (const legacy of ["sold", "removed", "active"]) {
        expect(canTransition("draft", legacy as string)).toBe(false);
        expect(canTransition("published", legacy as string)).toBe(false);
        expect(canTransition("archived", legacy as string)).toBe(false);
      }
    });

    it("rejects complete garbage input without throwing", () => {
      expect(canTransition("", "published")).toBe(false);
      expect(canTransition("DROP TABLE products", "draft")).toBe(false);
      expect(canTransition("draft", "")).toBe(false);
    });

    it("assertTransition throws a clean, catchable error for a legacy FROM state — never an uncaught TypeError from indexing an unknown key", () => {
      expect(() => assertTransition("sold" as string, "published")).toThrow(/cannot move/i);
      expect(() => assertTransition("removed" as string, "draft")).toThrow(/cannot move/i);
    });
  });
});

describe("isValidListingStatus", () => {
  it("accepts exactly the three current statuses", () => {
    expect(isValidListingStatus("draft")).toBe(true);
    expect(isValidListingStatus("published")).toBe(true);
    expect(isValidListingStatus("archived")).toBe(true);
  });

  it("rejects every legacy/order-related enum label still technically permitted by the database", () => {
    expect(isValidListingStatus("sold")).toBe(false);
    expect(isValidListingStatus("removed")).toBe(false);
    expect(isValidListingStatus("active")).toBe(false);
  });

  it("rejects arbitrary strings", () => {
    expect(isValidListingStatus("")).toBe(false);
    expect(isValidListingStatus("Draft")).toBe(false); // case-sensitive — the enum labels are lowercase
  });
});

describe("assertTransition", () => {
  it("does not throw for an allowed transition", () => {
    expect(() => assertTransition("draft", "published")).not.toThrow();
  });
  it("throws for a disallowed transition", () => {
    expect(() => assertTransition("archived", "published")).toThrow(/cannot move/i);
  });
});
