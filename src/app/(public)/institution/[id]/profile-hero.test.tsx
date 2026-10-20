import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ProfileHero } from "./profile-hero";

function hero(same: number) {
  return render(
    <ProfileHero
      name="Capital City Bank"
      stateName="Florida"
      stateCode="FL"
      facts={[]}
      counts={{ above: 16, below: 5, same, compared: 21 + same, level: "state" }}
      finding=""
      source={null}
      primary={<span>Request a report</span>}
      schedulesHref="#schedule"
    />,
  );
}

describe("ProfileHero count sentence (#1953)", () => {
  it("reads as one plain sentence when copied or extracted as text", () => {
    const { container } = hero(3);
    const text = (container.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("16 of 24");
    expect(text).toContain("compared fees are above the median.");
    expect(text).toContain("5 below, 3 about the same.");
    expect(text).not.toMatch(/\/ of|· ,/);
    expect(text).toContain("About the same: within 1% of the median.");
  });

  it("leaves the threshold note out when nothing is about the same", () => {
    const { container } = hero(0);
    expect(container.textContent).not.toContain("within 1% of the median");
  });
});
