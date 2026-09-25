import { describe, expect, it } from "vitest";
import { badgeVariants, buttonVariants, cardVariants, chipVariants, inputVariants } from "./variants";

/**
 * Pure class-string tests — the project has no jsdom/React Testing
 * Library (vitest.config.mts runs `environment: "node"` and only
 * globs `src/**\/*.test.ts`, not `.test.tsx`), so these components
 * can't be rendered and asserted on directly. Extracting each
 * component's variant logic into a plain function (variants.ts) keeps
 * it testable within the project's existing test architecture instead
 * of adding a new one just for this phase.
 */
describe("buttonVariants", () => {
  it("defaults to the primary variant and md size", () => {
    const classes = buttonVariants();
    expect(classes).toContain("bg-brand-sage-dark");
    expect(classes).toContain("h-11");
  });

  it("every variant produces a distinct, non-empty class string", () => {
    const variants = ["primary", "secondary", "outline", "ghost", "destructive"] as const;
    const results = variants.map((variant) => buttonVariants({ variant }));
    expect(new Set(results).size).toBe(variants.length);
    for (const r of results) expect(r.length).toBeGreaterThan(0);
  });

  it("every size produces a distinct height utility", () => {
    expect(buttonVariants({ size: "sm" })).toContain("h-9");
    expect(buttonVariants({ size: "md" })).toContain("h-11");
    expect(buttonVariants({ size: "lg" })).toContain("h-13");
  });

  it("fullWidth adds w-full only when requested", () => {
    expect(buttonVariants({ fullWidth: true })).toContain("w-full");
    expect(buttonVariants({ fullWidth: false })).not.toContain("w-full");
  });

  it("disabled styling is present for every variant (opacity + no pointer events)", () => {
    for (const variant of ["primary", "secondary", "outline", "ghost", "destructive"] as const) {
      const classes = buttonVariants({ variant });
      expect(classes).toContain("disabled:opacity-50");
      expect(classes).toContain("disabled:pointer-events-none");
    }
  });

  it("appends a caller-supplied className without dropping the base classes", () => {
    const classes = buttonVariants({ className: "mt-4" });
    expect(classes).toContain("mt-4");
    expect(classes).toContain("rounded-button");
  });
});

describe("badgeVariants", () => {
  it("every tone produces a distinct class string", () => {
    const tones = ["neutral", "success", "warning", "danger", "info", "accent"] as const;
    const results = tones.map((tone) => badgeVariants({ tone }));
    expect(new Set(results).size).toBe(tones.length);
  });

  it("defaults to the neutral tone", () => {
    expect(badgeVariants()).toBe(badgeVariants({ tone: "neutral" }));
  });
});

describe("chipVariants", () => {
  it("selected and unselected states are visually distinct", () => {
    const selected = chipVariants({ selected: true });
    const unselected = chipVariants({ selected: false });
    expect(selected).not.toBe(unselected);
    expect(selected).toContain("bg-bambini-forest");
    expect(unselected).not.toContain("bg-bambini-forest");
  });
});

describe("cardVariants", () => {
  it("every elevation level produces a distinct shadow utility", () => {
    const levels = ["none", "subtle", "card", "elevated"] as const;
    const results = levels.map((elevation) => cardVariants({ elevation }));
    expect(new Set(results).size).toBe(levels.length);
  });

  it("padded defaults to true and can be disabled", () => {
    expect(cardVariants()).toContain("p-4");
    expect(cardVariants({ padded: false })).not.toContain("p-4");
  });

  it("interactive adds a hover shadow transition", () => {
    expect(cardVariants({ interactive: true })).toContain("hover:shadow-elevated");
    expect(cardVariants({ interactive: false })).not.toContain("hover:shadow-elevated");
  });
});

describe("inputVariants", () => {
  it("invalid state swaps the border colour to the danger token", () => {
    const invalid = inputVariants({ invalid: true });
    const valid = inputVariants({ invalid: false });
    expect(invalid).toContain("border-brand-danger");
    expect(valid).not.toContain("border-brand-danger");
  });

  it("disabled styling is always present", () => {
    expect(inputVariants()).toContain("disabled:cursor-not-allowed");
  });
});
