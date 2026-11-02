import { describe, expect, it } from "vitest";
import {
  buildHamiltonRequestContractPrompt,
  parseHamiltonRequestContract,
} from "./request-contract";

const messages = [{ role: "user", parts: [{ type: "text", text: "Analyze this institution" }] }];

describe("Hamilton request contract", () => {
  it("normalizes the shared institution-aware contract", () => {
    const parsed = parseHamiltonRequestContract(
      {
        messages,
        institutionId: "2945",
        intent: "competitive-brief",
        evidencePolicy: "source-diligence",
        mode: "analyze",
        analysisFocus: "Peer Position",
        gate_citations: true,
      },
      { audience: "pro", defaultIntent: "analyze", allowGateCitations: true },
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.contract).toMatchObject({
      audience: "pro",
      institutionId: 2945,
      intent: "competitive-brief",
      evidencePolicy: "source-diligence",
      mode: "analyze",
      analysisFocus: "Peer Position",
      gateCitations: true,
    });
  });

  it("defaults missing optional fields without losing the audience", () => {
    const parsed = parseHamiltonRequestContract(
      { messages },
      { audience: "public", defaultIntent: "institution" },
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.contract.audience).toBe("public");
    expect(parsed.contract.institutionId).toBeNull();
    expect(parsed.contract.intent).toBe("institution");
    expect(parsed.contract.evidencePolicy).toBe("provisional-first");
    expect(parsed.contract.gateCitations).toBe(false);
  });

  it("rejects invalid institution IDs and evidence policies", () => {
    expect(
      parseHamiltonRequestContract(
        { messages, institutionId: "abc" },
        { audience: "pro" },
      ),
    ).toMatchObject({ ok: false, status: 400, error: "Invalid institutionId" });

    expect(
      parseHamiltonRequestContract(
        { messages, evidencePolicy: "make-it-up" },
        { audience: "pro" },
      ),
    ).toMatchObject({ ok: false, status: 400, error: "Invalid evidencePolicy" });
  });

  it("validates optional conversation IDs on internal chat routes", () => {
    expect(
      parseHamiltonRequestContract(
        {
          messages,
          conversation_id: "1b39a9e0-1c86-44b7-baba-25e4b22f4b7b",
        },
        { audience: "admin", allowConversationId: true },
      ),
    ).toMatchObject({ ok: true });

    expect(
      parseHamiltonRequestContract(
        { messages, conversation_id: "not-a-uuid" },
        { audience: "admin", allowConversationId: true },
      ),
    ).toMatchObject({ ok: false, status: 400, error: "Invalid conversation_id format" });
  });

  it("describes audience and evidence policy constraints for Hamilton prompts", () => {
    const prompt = buildHamiltonRequestContractPrompt({
      audience: "admin",
      institutionId: 8109,
      intent: "watch",
      evidencePolicy: "provisional-first",
    });

    expect(prompt).toContain("HAMILTON REQUEST CONTRACT");
    expect(prompt).toContain("Audience: admin");
    expect(prompt).toContain("Selected institution ID: 8109");
    expect(prompt).toContain("a thin benchmark sample may support directional exploration");
    expect(prompt).toContain("a fee still under review is never given or stated");
    expect(prompt).toContain("Empty or thin evidence");
  });
});
