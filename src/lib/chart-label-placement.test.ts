import { describe, expect, it } from "vitest";
import { boxesOverlap, estimateTextWidth, labelBox, placePointLabel } from "./chart-label-placement";

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
