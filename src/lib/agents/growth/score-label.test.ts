import { describe, expect, it } from "vitest";

import { JOURNEY_SCORE, scoreLabel } from "./score-label";

describe("score labels", () => {
  it("reads an outreach score as its journey stage and anything else as visits", () => {
    expect(JOURNEY_SCORE).toEqual({ delivered: 1, opened: 2, engaged: 3, interest: 4, purchase: 5 });
    expect(scoreLabel("outreach_email", 4)).toBe('reached "Commercial interest" in the week after sending');
    expect(scoreLabel("outreach_email", 0)).toBe("no response recorded in the week after sending");
    expect(scoreLabel("linkedin_post", 1)).toBe("1 tracked visit in the week after posting");
    expect(scoreLabel("article", 14)).toBe("14 tracked visits in the week after posting");
  });
});
