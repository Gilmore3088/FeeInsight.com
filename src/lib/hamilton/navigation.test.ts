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
  it("has seven workspace entries plus gated Admin", () => {
    expect(HAMILTON_NAV).toHaveLength(8);
  });

  it("has exact labels in order: Overview, Ask Hamilton, Research, Try a price, Reports, Monitor, Saved analyses, Admin", () => {
    const labels = HAMILTON_NAV.map((item) => item.label);
    expect(labels).toEqual(["Overview", "Ask Hamilton", "Research", "Try a price", "Reports", "Monitor", "Saved analyses", "Admin"]);
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
    expect(getPrimaryActionHref("Overview")).toBe("/pro/analyze");
    expect(getPrimaryActionHref("Research")).toBe("/pro/analyze");
    expect(getPrimaryActionHref("Try a price")).toBe("/pro/reports?intent=board-brief");
    expect(getPrimaryActionHref("Reports")).toBe("/pro/reports?intent=board-brief");
    expect(getPrimaryActionHref("Admin")).toBe("/admin");
    expect(Object.keys(PRIMARY_ACTION_HREF).sort()).toEqual(
      HAMILTON_NAV.map((item) => item.label).sort(),
    );
  });
});

describe("CTA_HIERARCHY", () => {
  it("has entries for the workspace screens and the Ask answer screen", () => {
    const expectedKeys = ["Overview", "Ask Hamilton", "Research", "Try a price", "Reports", "Monitor", "Saved analyses"];
    for (const key of expectedKeys) {
      expect(CTA_HIERARCHY).toHaveProperty(key);
    }

  });

  it("Ask primary CTA is Create report", () => {
    expect(CTA_HIERARCHY["Ask Hamilton"].primary).toBe("Create report");
  });

  it("Try a price primary CTA is Build report", () => {
    expect(CTA_HIERARCHY["Try a price"].primary).toBe("Build report");
  });

  it("Reports primary CTA is Create board brief", () => {
    expect(CTA_HIERARCHY["Reports"].primary).toBe("Create board brief");
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
  it("Overview, Ask Hamilton, and Research open their dedicated screens", () => {
    const byLabel = Object.fromEntries(HAMILTON_NAV.map((item) => [item.label, item.href]));
    expect(byLabel["Overview"]).toBe("/pro/hamilton");
    expect(byLabel["Ask Hamilton"]).toBe("/pro/analyze");
    expect(byLabel.Research).toBe("/pro/intelligence");
    expect(byLabel["Try a price"]).toBe("/pro/simulate");
    expect(byLabel.Reports).toBe("/pro/reports");
  });

  it("uses seven purposeful sidebar destinations for customers", () => {
    expect(HAMILTON_NAV.filter((item) => item.label !== "Admin")).toHaveLength(7);
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

