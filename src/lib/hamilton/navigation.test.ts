/**
 * Tests for Hamilton navigation source of truth (Phase 38, ARCH-04).
 * Verifies shape, completeness, exact label values, and CTA hierarchy.
 */

import { describe, it, expect } from "vitest";
import {
  HAMILTON_NAV,
  HAMILTON_REFERENCE_NAV,
  HAMILTON_WIRE_NAV,
  HAMILTON_BASE,
  LEFT_RAIL_CONFIG,
  PRIMARY_ACTION_HREF,
  CTA_HIERARCHY,
  ANALYSIS_FOCUS_TABS,
  HAMILTON_LABELS,
  getPrimaryActionHref,
} from "./navigation";
import type { HamiltonScreen } from "./navigation";

describe("HAMILTON_BASE", () => {
  it("is /pro", () => {
    expect(HAMILTON_BASE).toBe("/pro");
  });
});

describe("HAMILTON_NAV", () => {
  it("has exactly 5 entries (four tabs plus Admin, which lives in the account menu)", () => {
    expect(HAMILTON_NAV).toHaveLength(5);
  });

  it("has exact labels in order: This month, My fees, Try a price, Reports, Admin", () => {
    const labels = HAMILTON_NAV.map((item) => item.label);
    expect(labels).toEqual(["This month", "My fees", "Try a price", "Reports", "Admin"]);
  });

  it("all hrefs are unique (no duplicates)", () => {
    const hrefs = HAMILTON_NAV.map((item) => item.href);
    const unique = new Set(hrefs);
    expect(unique.size).toBe(hrefs.length);
  });

  it("all hrefs start with /", () => {
    for (const item of HAMILTON_NAV) {
      expect(item.href).toMatch(/^\//);
    }
  });

  it("non-Admin hrefs start with /pro", () => {
    for (const item of HAMILTON_NAV) {
      if (item.label !== "Admin") {
        expect(item.href).toMatch(/^\/pro\//);
      }
    }
  });
});

describe("LEFT_RAIL_CONFIG", () => {
  it("has an entry for every screen in HAMILTON_NAV", () => {
    const navLabels = HAMILTON_NAV.map((item) => item.label) as HamiltonScreen[];
    for (const label of navLabels) {
      expect(LEFT_RAIL_CONFIG).toHaveProperty(label);
    }
  });

  it("each entry has primaryAction and sections array", () => {
    for (const [_key, config] of Object.entries(LEFT_RAIL_CONFIG)) {
      expect(config).toHaveProperty("primaryAction");
      expect(config).toHaveProperty("sections");
      expect(Array.isArray(config.sections)).toBe(true);
    }
  });

  it("routes primary actions to the matching Hamilton workflow", () => {
    expect(getPrimaryActionHref("This month")).toBe("/pro/research");
    expect(getPrimaryActionHref("My fees")).toBe("/pro/simulate");
    expect(getPrimaryActionHref("Try a price")).toBe("/pro/reports");
    expect(getPrimaryActionHref("Reports")).toBe("/pro/reports?intent=executive-briefing");
    expect(getPrimaryActionHref("Admin")).toBe("/admin");
    expect(Object.keys(PRIMARY_ACTION_HREF).sort()).toEqual(
      HAMILTON_NAV.map((item) => item.label).sort(),
    );
  });
});

describe("CTA_HIERARCHY", () => {
  it("has entries for the workspace screens and the Ask answer screen", () => {
    const expectedKeys = ["Analyze", "This month", "My fees", "Try a price", "Reports"];
    for (const key of expectedKeys) {
      expect(CTA_HIERARCHY).toHaveProperty(key);
    }
    expect(CTA_HIERARCHY).not.toHaveProperty("Admin");
  });

  it("Analyze primary CTA is 'Try a Price'", () => {
    expect(CTA_HIERARCHY["Analyze"].primary).toBe("Try a Price");
  });

  it("Try a price primary CTA is 'Plan the Change'", () => {
    expect(CTA_HIERARCHY["Try a price"].primary).toBe("Plan the Change");
  });

  it("Reports primary CTA is 'Generate Brief'", () => {
    expect(CTA_HIERARCHY["Reports"].primary).toBe("Generate Brief");
  });

  it("no CTA tells the bank what to charge", () => {
    const text = JSON.stringify(CTA_HIERARCHY) + JSON.stringify(LEFT_RAIL_CONFIG);
    expect(text).not.toMatch(/recommend|raise|lower/i);
  });

  it("each entry has primary string and secondary array", () => {
    for (const [_key, cta] of Object.entries(CTA_HIERARCHY)) {
      expect(typeof cta.primary).toBe("string");
      expect(Array.isArray(cta.secondary)).toBe(true);
    }
  });
});

describe("ANALYSIS_FOCUS_TABS", () => {
  it("contains exactly 4 entries", () => {
    expect(ANALYSIS_FOCUS_TABS).toHaveLength(4);
  });

  it("contains Pricing, Risk, Peer Position, Trend in order", () => {
    expect(ANALYSIS_FOCUS_TABS).toEqual(["Pricing", "Risk", "Peer Position", "Trend"]);
  });
});

describe("HAMILTON_LABELS", () => {
  it("contains Hamilton's View label (D-08)", () => {
    expect(HAMILTON_LABELS.hamiltonsView).toBe("Hamilton's View");
  });

  it("contains all required label keys", () => {
    expect(HAMILTON_LABELS).toHaveProperty("whatChanged");
    expect(HAMILTON_LABELS).toHaveProperty("whatThisMeans");
    expect(HAMILTON_LABELS).toHaveProperty("whyItMatters");
    expect(HAMILTON_LABELS).toHaveProperty("recommendedPosition");
    expect(HAMILTON_LABELS).toHaveProperty("priorityAlert");
    expect(HAMILTON_LABELS).toHaveProperty("signalFeed");
    expect(HAMILTON_LABELS).toHaveProperty("analysisFocus");
  });
});

describe("no Sovereign branding (D-05)", () => {
  it("HAMILTON_NAV contains no Sovereign strings", () => {
    const allText = JSON.stringify(HAMILTON_NAV);
    expect(allText.toLowerCase()).not.toContain("sovereign");
  });

  it("HAMILTON_LABELS contains no Sovereign strings", () => {
    const allText = JSON.stringify(HAMILTON_LABELS);
    expect(allText.toLowerCase()).not.toContain("sovereign");
  });
});

describe("labels open the screen of the same name", () => {
  it("This month opens /pro/hamilton and each screen keeps its old URL", () => {
    const byLabel = Object.fromEntries(HAMILTON_NAV.map((item) => [item.label, item.href]));
    expect(byLabel["This month"]).toBe("/pro/hamilton");
    expect(byLabel["My fees"]).toBe("/pro/research");
    expect(byLabel["Try a price"]).toBe("/pro/simulate");
    expect(byLabel.Reports).toBe("/pro/reports");
  });

  it("keeps no more than four tabs a client sees", () => {
    expect(HAMILTON_NAV.filter((item) => item.label !== "Admin")).toHaveLength(4);
  });

  it("reference pages stay inside Pro", () => {
    expect(HAMILTON_REFERENCE_NAV.length).toBeGreaterThanOrEqual(4);
    for (const item of HAMILTON_REFERENCE_NAV) expect(item.href.startsWith("/pro/")).toBe(true);
  });

  it("puts Regulatory Wire in the top nav and not also under Reference", () => {
    expect(HAMILTON_WIRE_NAV).toEqual({ label: "Regulatory Wire", href: "/pro/news" });
    expect(HAMILTON_REFERENCE_NAV.map((item) => item.href)).not.toContain("/pro/news");
  });
});

