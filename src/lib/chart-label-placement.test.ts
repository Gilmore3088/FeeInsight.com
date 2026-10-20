import { describe, expect, it } from "vitest";
import { type Box, boxesOverlap, estimateTextWidth, fitText, labelBox, LINE_HEIGHT, placeLineLabel, placePointLabel, pointInBox } from "./chart-label-placement";

const PHONE = { left: 52, right: 340, top: 20, bottom: 276 };
const DESKTOP = { left: 52, right: 900, top: 20, bottom: 396 };

describe("placePointLabel", () => {
  it("should_keep_the_label_inside_the_plot_when_the_point_sits_near_the_right_edge", () => {
    const text = "Capital City Bank · $8.45";
    const width = estimateTextWidth(text);
    const placed = placePointLabel({ x: 250, y: 150, widths: [width], bounds: PHONE });
    expect(placed.box.left).toBeGreaterThanOrEqual(PHONE.left);
    expect(placed.box.right).toBeLessThanOrEqual(PHONE.right);
  });

  it("should_avoid_the_median_label_and_not_sit_across_the_median_line", () => {
    const medianText = "Peer median $8.00";
    const medianWidth = estimateTextWidth(medianText);
    const medianY = 160;
    const medianLabel = labelBox(PHONE.right, medianY - 6, "end", [medianWidth]);
    const placed = placePointLabel({
      x: 200,
      y: 156,
      widths: [estimateTextWidth("Capital City Bank · $8.45")],
      bounds: PHONE,
      avoidBoxes: [medianLabel],
      avoidLines: [medianY],
    });
    expect(boxesOverlap(placed.box, medianLabel)).toBe(false);
    expect(placed.box.top < medianY && placed.box.bottom > medianY).toBe(false);
    expect(placed.box.right).toBeLessThanOrEqual(PHONE.right);
  });

  it("should_move_off_a_peer_dot_that_would_sit_under_the_label", () => {
    const width = estimateTextWidth("Capital City Bank · $8.45");
    // A peer just up and to the right of the subject, where the default label would go.
    const placed = placePointLabel({ x: 300, y: 200, widths: [width], bounds: DESKTOP, avoidPoints: [{ x: 360, y: 190 }] });
    const inside = placed.box.left <= 360 && placed.box.right >= 360 && placed.box.top <= 190 && placed.box.bottom >= 190;
    expect(inside).toBe(false);
  });

  it("should_prefer_the_right_side_above_the_point_when_nothing_is_in_the_way", () => {
    const placed = placePointLabel({ x: 200, y: 200, widths: [80], bounds: DESKTOP });
    expect(placed.anchor).toBe("start");
    expect(placed.x).toBeGreaterThan(200);
    expect(placed.box.bottom).toBeLessThan(200);
  });

  it("should_fit_a_two_line_label_inside_the_plot", () => {
    const placed = placePointLabel({ x: 330, y: 30, widths: [150, 120], bounds: PHONE });
    expect(placed.box.top).toBeGreaterThanOrEqual(PHONE.top - 20);
    expect(placed.box.right).toBeLessThanOrEqual(PHONE.right);
    expect(placed.box.left).toBeGreaterThanOrEqual(PHONE.left);
  });
});

// The growthOS re-check's case (Oct 20): a $8.45 bank against an $8 median, 28 long-named peers
// packed between $7 and $8.50 at $4.0B to $4.8B in assets.
function cluster(bounds: Box, medianY: number, count = 28): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let seed = 7;
  const next = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < count; i++) {
    points.push({ x: bounds.left + 8 + next() * (bounds.right - bounds.left - 16), y: medianY - 30 + next() * 60 });
  }
  return points;
}

function clearOf(box: Box, points: { x: number; y: number }[]): boolean {
  return points.every((p) => !pointInBox(p, box));
}

describe("labels in a dense cluster around the median", () => {
  for (const [name, bounds] of [
    ["desktop", { left: 52, right: 1004, top: 0, bottom: 396 }],
    ["phone at 390px", { left: 52, right: 374, top: 0, bottom: 276 }],
  ] as const) {
    it(`should_keep_the_median_label_and_a_two_line_bank_label_off_every_dot_on_${name.replace(/ /g, "_")}`, () => {
      const medianY = (bounds.top + bounds.bottom) / 2 + 20;
      const peers = cluster(bounds, medianY);
      const median = placeLineLabel({ y: medianY, width: estimateTextWidth("Peer median $8"), bounds, avoidPoints: peers });
      expect(clearOf(median.box, peers)).toBe(true);
      expect(median.box.right).toBeLessThanOrEqual(bounds.right);
      expect(median.box.left).toBeGreaterThanOrEqual(bounds.left);

      const bank = { x: bounds.left + (bounds.right - bounds.left) * 0.45, y: medianY - 10 };
      const widths = [estimateTextWidth("Capital City Bank · $8.45"), estimateTextWidth("comparison price, its middle price")];
      const placed = placePointLabel({ ...bank, widths, bounds, avoidBoxes: [median.box], avoidLines: [medianY], avoidPoints: peers });
      // Both lines' full box: off every peer dot, the median label and the median line, inside the plot.
      expect(placed.box.bottom - placed.box.top).toBeGreaterThan(LINE_HEIGHT * 1.5);
      expect(clearOf(placed.box, peers)).toBe(true);
      expect(clearOf(placed.box, [bank])).toBe(true);
      expect(boxesOverlap(placed.box, median.box)).toBe(false);
      expect(placed.box.top < medianY && placed.box.bottom > medianY).toBe(false);
      expect(placed.box.left).toBeGreaterThanOrEqual(bounds.left);
      expect(placed.box.right).toBeLessThanOrEqual(bounds.right);
    });
  }

  it("should_not_put_the_second_line_on_a_dot_just_below_the_first_line_end", () => {
    const bounds = DESKTOP;
    // The re-check's crop: a dot under the end of the first line, where the second line runs.
    const bank = { x: 100, y: 200 };
    const widths = [estimateTextWidth("Capital City Bank · $8.45"), estimateTextWidth("comparison price, its middle price")];
    const dot = { x: 100 + 10 + widths[0] - 4, y: 200 - 14 - 8 };
    const placed = placePointLabel({ ...bank, widths, bounds, avoidPoints: [dot] });
    expect(clearOf(placed.box, [dot])).toBe(true);
  });
});

describe("a tapped peer's label at a phone's right edge", () => {
  it("should_stay_inside_a_390px_plot_even_with_a_long_name", () => {
    const bounds = { left: 52, right: 374, top: 0, bottom: 276 };
    const text = "Southern Bancorp Bank and… · $7.50";
    const placed = placePointLabel({ x: 368, y: 160, widths: [estimateTextWidth(text)], bounds, avoidLines: [150] });
    expect(placed.box.right).toBeLessThanOrEqual(bounds.right);
    expect(placed.box.left).toBeGreaterThanOrEqual(bounds.left);
    expect(clearOf(placed.box, [{ x: 368, y: 160 }])).toBe(true);
  });

  it("should_cut_a_label_wider_than_the_plot_so_it_fits", () => {
    const text = "The First National Bank and Trust Company of Southern Georgia · $7.50";
    const fitted = fitText(text, 200);
    expect(estimateTextWidth(fitted)).toBeLessThanOrEqual(200);
    expect(fitted.endsWith("…")).toBe(true);
    expect(fitText("Short · $1", 200)).toBe("Short · $1");
  });
});

describe("when every point sits on the same spot", () => {
  it("should_move_the_label_off_the_stack_with_a_leader_line_and_inside_the_plot", () => {
    const bounds = PHONE;
    const spot = { x: 200, y: 150 };
    const stack = Array.from({ length: 25 }, () => ({ ...spot }));
    const median = placeLineLabel({ y: 150, width: estimateTextWidth("Peer median $8"), bounds, avoidPoints: stack });
    expect(clearOf(median.box, stack)).toBe(true);
    const placed = placePointLabel({
      ...spot,
      widths: [estimateTextWidth("Capital City Bank · $8"), estimateTextWidth("comparison price, its middle price")],
      bounds,
      avoidBoxes: [median.box],
      avoidLines: [150],
      avoidPoints: stack,
    });
    expect(clearOf(placed.box, stack)).toBe(true);
    expect(boxesOverlap(placed.box, median.box)).toBe(false);
    expect(placed.box.left).toBeGreaterThanOrEqual(bounds.left);
    expect(placed.box.right).toBeLessThanOrEqual(bounds.right);
    expect(placed.box.top).toBeGreaterThanOrEqual(bounds.top);
  });

  it("should_draw_a_leader_line_when_the_label_has_to_move_away_from_its_point", () => {
    const spot = { x: 200, y: 150 };
    // A wall of dots around the point leaves only space further out.
    const wall: { x: number; y: number }[] = [];
    for (let dx = -170; dx <= 170; dx += 8) for (let dy = -45; dy <= 45; dy += 8) wall.push({ x: spot.x + dx, y: spot.y + dy });
    const placed = placePointLabel({ ...spot, widths: [120], bounds: DESKTOP, avoidPoints: wall });
    expect(clearOf(placed.box, wall)).toBe(true);
    expect(placed.leader).toBeDefined();
  });
});
