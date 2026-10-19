import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BranchMapGL, { MAP_STYLE_URL } from "./branch-map-gl";

const mock = vi.hoisted(() => ({
  create: vi.fn(), worker: vi.fn(), events: new Map<string, (...args: unknown[]) => void>(),
  controls: vi.fn(), addSource: vi.fn(), addLayer: vi.fn(), remove: vi.fn(), popupDom: vi.fn(),
  features: vi.fn(), throwOnCreate: false,
}));
vi.mock("maplibre-gl", async (original) => {
  const actual = await original<typeof import("maplibre-gl")>();
  return {
    ...actual,
    setWorkerUrl: mock.worker,
    Map: vi.fn(function (options) {
      mock.create(options);
      if (mock.throwOnCreate) throw new Error("Synthetic context failure");
      const map = {
        touchZoomRotate: { disableRotation: vi.fn() }, addControl: mock.controls,
        on: (name: string, ...args: unknown[]) => mock.events.set(name, args.at(-1) as (...args: unknown[]) => void),
        once: (name: string, callback: (...args: unknown[]) => void) => mock.events.set(name, callback),
        getStyle: () => ({ layers: [], sources: { base: { type: "vector" } } }),
        setPaintProperty: vi.fn(), addSource: mock.addSource, addLayer: mock.addLayer,
        querySourceFeatures: mock.features, getCanvas: () => ({ style: {} }), remove: mock.remove,
      };
      return map;
    }),
    Popup: vi.fn(function () {
      const popup = { setLngLat: () => popup, setDOMContent: (element: HTMLElement) => { mock.popupDom(element); return popup; }, addTo: () => popup };
      return popup;
    }),
  };
});

// Invented branch records, no live coordinates/data requests.
const points = [
  { lat: 28, lon: -81, institution_id: 1, name: "Invented Bank", address: "1 Test Road", charter: "bank" as const },
  { lat: 28.1, lon: -81.1, institution_id: 2, name: "Invented CU", address: null, charter: "credit_union" as const },
];
const props = () => ({ points, bounds: [[-82, 27], [-80, 29]] as [[number, number], [number, number]], branchesById: { 1: 1, 2: 1 }, label: "Test City", onReady: vi.fn(), onFail: vi.fn(), onBoundary: vi.fn() });

beforeEach(() => {
  vi.clearAllMocks(); mock.events.clear(); mock.throwOnCreate = false;
  mock.features.mockReturnValue([{}]);
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as WebGL2RenderingContext);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("city map compatibility without WebGL rendering", () => {
  it("keeps fixed style, branch GeoJSON, safe popup DOM and required attribution", () => {
    const p = props(); render(<BranchMapGL {...p} />);
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ style: MAP_STYLE_URL, attributionControl: false, cooperativeGestures: true }));
    const attribution = mock.controls.mock.calls[0][0];
    expect(attribution.options.customAttribution).toContain("https://openfreemap.org");
    expect(attribution.options.customAttribution).toContain("https://www.openmaptiles.org/");
    expect(attribution.options.customAttribution).toContain("https://www.openstreetmap.org/copyright");
    act(() => mock.events.get("load")!());
    expect(mock.addSource).toHaveBeenCalledWith("fi-branches", expect.objectContaining({ type: "geojson", data: expect.objectContaining({ features: expect.arrayContaining([expect.objectContaining({ properties: expect.objectContaining({ id: 1, name: "Invented Bank" }) })]) }) }));
    expect(mock.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: "fi-branches", type: "circle", source: "fi-branches" }));
    act(() => mock.events.get("click")!({ features: [{ geometry: { type: "Point", coordinates: [-81, 28] }, properties: { id: 1, name: '<img src=x onerror="sentinel">', address: "<script>sentinel</script>", charter: "bank", branches: 1 } }] }));
    const dom = mock.popupDom.mock.calls[0][0] as HTMLElement;
    expect(dom.querySelector("img,script")).toBeNull();
    expect(dom.textContent).toContain('<img src=x onerror="sentinel">');
    expect(dom.querySelector("a")).toHaveAttribute("href", "/institution/1");
    expect(p.onReady).toHaveBeenCalledTimes(1);
  });
  it("falls back before constructing a map when WebGL2 is absent", () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const p = props(); render(<BranchMapGL {...p} />);
    expect(p.onFail).toHaveBeenCalledTimes(1); expect(mock.create).not.toHaveBeenCalled();
    expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalledWith("webgl");
  });
  it("falls back on constructor failure, missing street data or style timeout", () => {
    mock.throwOnCreate = true;
    const failed = props(); const first = render(<BranchMapGL {...failed} />);
    expect(failed.onFail).toHaveBeenCalledTimes(1); first.unmount();
    mock.throwOnCreate = false;
    const timed = props(); const second = render(<BranchMapGL {...timed} />);
    act(() => vi.advanceTimersByTime(15_000)); expect(timed.onFail).toHaveBeenCalledTimes(1); second.unmount();
    const blank = props(); render(<BranchMapGL {...blank} />);
    mock.features.mockReturnValue([]);
    act(() => mock.events.get("load")!()); act(() => mock.events.get("idle")!());
    expect(blank.onFail).toHaveBeenCalledTimes(1);
  });
  it("releases the map and timeout on unmount", () => {
    const p = props(); const { unmount } = render(<BranchMapGL {...p} />);
    unmount(); act(() => vi.advanceTimersByTime(15_000));
    expect(mock.remove).toHaveBeenCalledTimes(1); expect(p.onFail).not.toHaveBeenCalled();
  });
});
