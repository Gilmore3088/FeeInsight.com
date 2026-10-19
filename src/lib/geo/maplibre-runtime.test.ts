import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import * as maplibre from "maplibre-gl";

const require = createRequire(import.meta.url);

/** Runs the installed library's public attribution control, with no map/network/WebGL. */
function attribution(sources: string[], customAttribution?: string): { root: HTMLElement; remove: () => void } {
  const canvas = document.createElement("div");
  const map = {
    style: { stylesheet: {}, tileManagers: Object.fromEntries(sources.map((text, id) => [id, { used: true, getSource: () => ({ attribution: text }) }])) },
    getCanvasContainer: () => canvas,
    _getUIString: () => "Attribution",
    on: vi.fn(), off: vi.fn(),
  };
  const control = new maplibre.AttributionControl({ compact: false, customAttribution });
  const root = control.onAdd(map as unknown as maplibre.Map);
  document.body.append(root);
  return { root, remove: () => control.onRemove() };
}

describe("installed MapLibre runtime security and compatibility", () => {
  it("removes consecutive dangerous attributes through the actual source-attribution control", () => {
    // Harmless sentinel strings: no script execution is needed to prove the boundary.
    const { root, remove } = attribution([
      '<a href="https://example.org/credit" onclick="sentinel-one" onmouseover="sentinel-two" onfocus="sentinel-three">Source credit</a>',
      '<details open onload="sentinel-four" ontoggle="sentinel-five">Unsafe wrapper</details>',
    ]);
    try {
      expect(root.textContent).toContain("Source credit");
      expect(root.querySelector('a[href="https://example.org/credit"]')).not.toBeNull();
      for (const node of root.querySelectorAll("*")) {
        for (const attribute of node.getAttributeNames()) expect(attribute).not.toMatch(/^on/i);
      }
      expect(root.innerHTML).not.toContain("sentinel-");
    } finally { remove(); }
  });
  it("rejects script URLs/foreign markup while preserving independent legitimate source credits", () => {
    const { root, remove } = attribution([
      '<svg><a href="javascript:sentinel">Unsafe foreign link</a></svg>',
      '<a href="java\nscript:sentinel" onclick="sentinel">Unsafe URL</a>',
      '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
    ], '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>');
    try {
      expect(root.querySelector("svg,script,iframe")).toBeNull();
      expect(Array.from(root.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"))).toEqual(expect.arrayContaining([
        "https://openfreemap.org", "https://www.openstreetmap.org/copyright",
      ]));
      expect(root.innerHTML).not.toContain("javascript:");
      expect(root.innerHTML).not.toContain("sentinel");
    } finally { remove(); }
  });
  it("retains every public library method used by the city map", () => {
    for (const method of ["addControl", "setPaintProperty", "getStyle", "on", "once", "addLayer", "addSource", "querySourceFeatures", "getCanvas", "remove"]) {
      expect(maplibre.Map.prototype[method as keyof maplibre.Map], method).toBeTypeOf("function");
    }
    for (const method of ["setLngLat", "setDOMContent", "addTo"]) expect(maplibre.Popup.prototype[method as keyof maplibre.Popup]).toBeTypeOf("function");
    expect(maplibre.NavigationControl).toBeTypeOf("function");
    expect(maplibre.setWorkerUrl).toBeTypeOf("function");
  });
  it("ships self-contained module-worker and stylesheet assets for the pinned package", () => {
    expect(maplibre.getVersion()).toBe("6.15.0");
    const worker = readFileSync(require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs"), "utf8");
    expect(worker.length).toBeGreaterThan(100_000);
    expect(worker).not.toContain("maplibre-gl-shared.mjs");
    const css = readFileSync(require.resolve("maplibre-gl/dist/maplibre-gl.css"), "utf8");
    for (const selector of [".maplibregl-map", ".maplibregl-popup", ".maplibregl-ctrl-attrib"]) expect(css).toContain(selector);
  });
});
