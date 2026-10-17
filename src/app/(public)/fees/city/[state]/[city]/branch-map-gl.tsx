"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { BranchPoint } from "@/lib/data-store";

/** Free, keyless vector tiles (OpenFreeMap, OpenMapTiles schema); restyled below in Fee Insight's neutrals. */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>';
/** Give up on the live map and show the plain dot map when its style has not arrived by then. */
const LOAD_TIMEOUT_MS = 15_000;

function webglSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** The page's own colors, so the map follows light and dark themes. */
function palette() {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    paper: read("--fi-paper", "#f3efe6"),
    surface: read("--fi-surface-0", "#fbf9f4"),
    surface200: read("--fi-surface-200", "#ebe5d9"),
    ink: read("--fi-ink", "#132338"),
    muted: read("--fi-muted", "#55606f"),
    border: read("--fi-border", "#ddd5c6"),
    brick: read("--fi-brick", "#b23a32"),
  };
}

/** a toward b by t, for #rrggbb colors; a when either is not a hex color. */
function blend(a: string, b: string, t: number): string {
  const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
  const x = hex(a);
  const y = hex(b);
  if (!x || !y) return a;
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

function setPaint(map: maplibregl.Map, id: string, prop: string, value: unknown) {
  try {
    map.setPaintProperty(id, prop, value);
  } catch {
    // A layer without that property keeps its own.
  }
}

/** Repaints the base style in parchment and ink: water and parks as quiet tints, roads light with a border. */
function restyle(map: maplibregl.Map, c: ReturnType<typeof palette>) {
  const water = blend(c.surface200, c.muted, 0.18);
  for (const layer of map.getStyle().layers ?? []) {
    const id = layer.id;
    const name = id.toLowerCase();
    if (layer.type === "background") setPaint(map, id, "background-color", c.paper);
    else if (layer.type === "fill") {
      const color = /water|ocean|lake|river/.test(name)
        ? water
        : /park|wood|grass|landcover|green|cemetery/.test(name)
          ? blend(c.paper, c.muted, 0.08)
          : /building/.test(name)
            ? blend(c.paper, c.ink, 0.07)
            : blend(c.paper, c.ink, 0.03);
      setPaint(map, id, "fill-color", color);
      setPaint(map, id, "fill-outline-color", color);
    } else if (layer.type === "line") {
      if (/water|river|stream|canal/.test(name)) setPaint(map, id, "line-color", water);
      else if (/boundary|admin/.test(name)) setPaint(map, id, "line-color", blend(c.paper, c.muted, 0.55));
      else if (/rail/.test(name)) setPaint(map, id, "line-color", blend(c.paper, c.muted, 0.45));
      // Roads read as streets: a light ink tint on parchment, heavier for highways and main roads.
      else if (/casing|outline/.test(name)) setPaint(map, id, "line-color", blend(c.paper, c.ink, 0.22));
      else if (/motorway|trunk/.test(name)) setPaint(map, id, "line-color", blend(c.paper, c.ink, 0.42));
      else if (/major|primary|secondary|tertiary/.test(name)) setPaint(map, id, "line-color", blend(c.paper, c.ink, 0.3));
      else if (/highway|road|street|minor|service|path|track/.test(name)) setPaint(map, id, "line-color", blend(c.paper, c.ink, 0.16));
      else setPaint(map, id, "line-color", blend(c.paper, c.ink, 0.2));
    } else if (layer.type === "symbol") {
      setPaint(map, id, "text-color", /city|town|state|country/.test(name) ? c.ink : c.muted);
      setPaint(map, id, "text-halo-color", c.paper);
      setPaint(map, id, "icon-opacity", 0.6);
    }
  }
}

function popupContent(p: { id: number; name: string; charter: string; address: string; branches: number }): HTMLElement {
  const root = document.createElement("div");
  root.className = "space-y-0.5 text-[12px] leading-snug text-ink-muted";
  const link = document.createElement("a");
  link.href = `/institution/${p.id}`;
  link.textContent = p.name;
  link.className = "block pr-4 text-[14px] font-semibold text-ink underline decoration-border underline-offset-4 hover:decoration-ink";
  const kind = document.createElement("p");
  kind.textContent = `${p.charter === "credit_union" ? "Credit union" : "Bank"} · ${p.branches} ${p.branches === 1 ? "branch" : "branches"} here`;
  root.append(link, kind);
  if (p.address) {
    const addr = document.createElement("p");
    addr.textContent = p.address;
    root.append(addr);
  }
  return root;
}

/**
 * The branch map on a real base map: streets, neighborhood names and municipal boundaries from
 * OpenStreetMap, with each branch a dot (banks ink, credit unions brick). Selecting a dot names
 * its institution and links to it. Calls onFail when WebGL or the tiles are unavailable, so the
 * page can show the plain dot map instead.
 */
export default function BranchMapGL({
  points,
  bounds,
  branchesById,
  label,
  onReady,
  onFail,
  onBoundary,
}: {
  points: BranchPoint[];
  bounds: [[number, number], [number, number]];
  branchesById: Record<number, number>;
  label: string;
  onReady: () => void;
  onFail: () => void;
  /** Called once the first view has drawn, with whether any city limits were in the tiles. */
  onBoundary?: (shown: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!webglSupported()) {
      onFail();
      return;
    }
    let loaded = false;
    // Once the style has arrived the map can draw; a missing tile or sprite after that is not a failure.
    let styled = false;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: el,
        style: MAP_STYLE_URL,
        bounds,
        fitBoundsOptions: { padding: 28, maxZoom: 14 },
        cooperativeGestures: true,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: false,
      });
    } catch {
      onFail();
      return;
    }
    map.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: ATTRIBUTION }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.touchZoomRotate.disableRotation();

    const timer = window.setTimeout(() => {
      if (!styled) onFail();
    }, LOAD_TIMEOUT_MS);
    map.on("styledata", () => {
      styled = true;
    });
    map.on("error", (e) => {
      if (!styled && !loaded) onFail();
      else console.warn("Branch map resource failed", e.error?.message ?? e);
    });

    map.on("load", () => {
      loaded = true;
      window.clearTimeout(timer);
      const c = palette();
      restyle(map, c);
      const style = map.getStyle();
      const vector = Object.entries(style.sources ?? {}).find(([, s]) => s.type === "vector")?.[0];
      const font = (style.layers ?? [])
        .map((l) => (l.type === "symbol" ? (l.layout?.["text-font"] as string[] | undefined) : undefined))
        .find((f) => Array.isArray(f));
      const boundaryFilter: maplibregl.FilterSpecification = ["all", ["==", ["get", "admin_level"], 8], ["!=", ["get", "maritime"], 1]];
      if (vector) {
        // City and town limits (OpenStreetMap admin level 8), dashed, so the city reads as a place.
        map.addLayer({
          id: "fi-municipal-boundary",
          type: "line",
          source: vector,
          "source-layer": "boundary",
          minzoom: 8,
          filter: boundaryFilter,
          paint: { "line-color": c.ink, "line-opacity": 0.45, "line-width": 1.4, "line-dasharray": [3, 2] },
        });
        if (font) {
          map.addLayer({
            id: "fi-neighborhoods",
            type: "symbol",
            source: vector,
            "source-layer": "place",
            minzoom: 9.5,
            filter: ["match", ["get", "class"], ["neighbourhood", "quarter", "suburb"], true, false],
            layout: {
              "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
              "text-font": font,
              "text-size": 11,
              "text-transform": "uppercase",
              "text-letter-spacing": 0.08,
              "text-max-width": 8,
            },
            paint: { "text-color": c.muted, "text-halo-color": c.paper, "text-halo-width": 1.2 },
          });
        }
      }
      map.addSource("fi-branches", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: points.map((p) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [p.lon, p.lat] },
            properties: { id: p.institution_id, name: p.name, charter: p.charter, address: p.address ?? "", branches: branchesById[p.institution_id] ?? 1 },
          })),
        },
      });
      map.addLayer({
        id: "fi-branches",
        type: "circle",
        source: "fi-branches",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.5, 13, 6, 16, 8],
          "circle-color": ["match", ["get", "charter"], "credit_union", c.brick, c.ink],
          "circle-opacity": 0.85,
          "circle-stroke-color": c.paper,
          "circle-stroke-width": 1.5,
        },
      });

      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "260px", offset: 10 });
      map.on("click", "fi-branches", (e) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const pr = f.properties as Record<string, unknown>;
        popup
          .setLngLat(f.geometry.coordinates as [number, number])
          .setDOMContent(
            popupContent({
              id: Number(pr.id),
              name: String(pr.name ?? ""),
              charter: String(pr.charter ?? "bank"),
              address: String(pr.address ?? ""),
              branches: Number(pr.branches ?? 1),
            }),
          )
          .addTo(map);
      });
      map.on("mouseenter", "fi-branches", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "fi-branches", () => {
        map.getCanvas().style.cursor = "";
      });
      map.once("idle", () => {
        const shown = vector ? map.querySourceFeatures(vector, { sourceLayer: "boundary", filter: boundaryFilter }).length > 0 : false;
        onBoundary?.(shown);
      });
      onReady();
    });

    return () => {
      window.clearTimeout(timer);
      map.remove();
    };
    // The map is built once per set of points; callbacks are stable for its life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  return <div ref={ref} className="fi-branch-map h-[380px] w-full sm:h-[460px]" role="region" aria-label={`Map of branch locations in ${label}`} />;
}
