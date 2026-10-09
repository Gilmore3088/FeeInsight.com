import { describe, expect, it } from "vitest";
import { fieldProblem } from "./request-report-form";

describe("fieldProblem", () => {
  it("asks for each required field when it is empty, saying what to do", () => {
    expect(fieldProblem("name", "  ")).toBe("Enter your name so we know who to reply to.");
    expect(fieldProblem("district", "")).toBe("Choose a Fed district for the district report.");
    expect(fieldProblem("institution", "")).toMatch(/^Enter your bank or credit union's name/);
    expect(fieldProblem("email", "")).toBe("Enter your work email so we can send the report.");
    expect(fieldProblem("email-free", "")).toBe("Enter your email so we can send the report.");
  });

  it("names the expected shape for an email that is not one", () => {
    expect(fieldProblem("email", "jane@bank")).toBe("Enter your work email as name@example.com.");
    expect(fieldProblem("email-free", "not an email")).toBe("Enter your email as name@example.com.");
  });

  it("passes filled fields and a well-formed email", () => {
    expect(fieldProblem("name", "Jane Doe")).toBeNull();
    expect(fieldProblem("district", "6")).toBeNull();
    expect(fieldProblem("institution", "Maple Grove Community Bank")).toBeNull();
    expect(fieldProblem("email", " jane@maplegrove.example ")).toBeNull();
  });
});
