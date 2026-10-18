import { describe, expect, it } from "vitest";

import { SNIPPET_MAX, classifyZelleSentence, decideZelle, zelleSentences, type ZelleDocument } from "./bank-zelle-match";

const doc = (text: string, id = 1): ZelleDocument => ({ agentSourceTextId: id * 10, sourceDocumentId: id, url: `https://bank.example/doc-${id}.pdf`, text });

describe("classifyZelleSentence", () => {
  it.each([
    ["Send money with Zelle® to friends and family in our mobile app.", "send_money_with"],
    ["Zelle and the Zelle related marks are wholly owned by Early Warning Services, LLC and are used herein under license.", "brand_notice"],
    ["Enroll in Zelle® through Online Banking.", "enroll"],
    ["Zelle® is available within our Mobile Banking app.", "in_our_banking"],
    ["We now offer Zelle to all checking customers.", "offer_statement"],
    ["Zelle® transfer   $0.00", "fee_or_limit_line"],
    ["Zelle daily limit $2,500", "fee_or_limit_line"],
  ])("reads %j as offering Zelle", (sentence, rule) => {
    expect(classifyZelleSentence(sentence)).toMatchObject({ kind: "offers", rule });
  });

  it.each([
    ["We do not offer Zelle.", "not_offered"],
    ["Zelle is not available to our members.", "not_available"],
    ["We don't currently support Zelle.", "not_offered"],
  ])("reads %j as not offering Zelle", (sentence, rule) => {
    expect(classifyZelleSentence(sentence)).toMatchObject({ kind: "does_not_offer", rule });
  });

  it("keeps a narrowed no (one account type) as a mention", () => {
    expect(classifyZelleSentence("Zelle is not available for business accounts.")).toMatchObject({ kind: "mentioned", rule: "not_available_narrowed" });
  });

  // Review B1 (#1963): safety warnings without the word "scam" are advice, never offers.
  it.each([
    "Never send money with Zelle to someone you don't know.",
    "Only send money with Zelle to people you know and trust.",
    "Criminals may pose as your bank and ask you to send money with Zelle.",
    "once you send money using Zelle, you generally cannot cancel it",
    "Send money with Zelle to friends and family.",
  ])("does not read the warning or bare phrase %j as offering Zelle", (sentence) => {
    expect(classifyZelleSentence(sentence).kind).not.toBe("offers");
  });

  // "only" and "trust" outside the warning's shape stay offers (#1963 follow-up).
  it.each([
    ["Send money with Zelle® to friends and family you trust, right from our mobile app.", "send_money_with"],
    ["You can send money with Zelle through our online banking to almost anyone you trust", "send_money_with"],
    ["Zelle is available only in our mobile app.", "in_our_banking"],
    ["Enrolling in Zelle only takes a few minutes in our app.", "enroll"],
  ])("still reads %j as offering Zelle", (sentence, rule) => {
    expect(classifyZelleSentence(sentence)).toMatchObject({ kind: "offers", rule });
  });

  // Review B2 (#1963): a condition or scope on a service is a limit, not "does not offer".
  it.each([
    "Zelle transfers are not available until your account has been open 30 days.",
    "Zelle is not available on weekends.",
    "We cannot support Zelle payments to recipients outside the U.S.",
    "We do not offer Zelle at this time.",
    "Zelle is temporarily not available.",
  ])("does not read the conditional %j as not offering Zelle", (sentence) => {
    expect(classifyZelleSentence(sentence).kind).not.toBe("does_not_offer");
  });

  it.each([
    "Scammers may ask you to pay with Zelle, Venmo or Cash App; never send money to someone you do not know.",
    "Payment apps such as Zelle and PayPal let people send money fast.",
    "Read more about Zelle.",
  ])("reads %j as a mention only", (sentence) => {
    expect(classifyZelleSentence(sentence).kind).toBe("mentioned");
  });

  it("caps the snippet", () => {
    const long = `${"word ".repeat(200)}Send money with Zelle ${"more ".repeat(200)}`;
    const s = classifyZelleSentence(long);
    expect(s.snippet.length).toBeLessThanOrEqual(SNIPPET_MAX);
    expect(s.snippet).toContain("Zelle");
  });
});

describe("zelleSentences", () => {
  it("reads each sentence once, in order, and ignores words that only contain the name", () => {
    const text = "Welcome. Send money with Zelle in our app. Zellerbach Street branch. Send money with Zelle in our app.\n\nZelle daily limit $1,000";
    const sentences = zelleSentences(text);
    expect(sentences.map((s) => s.rule)).toEqual(["send_money_with", "fee_or_limit_line"]);
  });

  it("finds nothing in a document that never names Zelle", () => {
    expect(zelleSentences("Overdraft fee $35. Wire transfer $25.")).toEqual([]);
  });
});

describe("decideZelle", () => {
  it("returns null when no document names Zelle (silence is not a no)", () => {
    expect(decideZelle([doc("Overdraft fee $35.")])).toBeNull();
    expect(decideZelle([])).toBeNull();
  });

  it("says offers, citing the document the sentence came from", () => {
    const finding = decideZelle([doc("Overdraft fee $35."), doc("Beware of Zelle scams. Enroll in Zelle in Online Banking.", 2)]);
    expect(finding).toMatchObject({
      status: "offers",
      rule: "enroll",
      evidence: { sourceDocumentId: 2, agentSourceTextId: 20, url: "https://bank.example/doc-2.pdf" },
      documentsMentioning: 1,
      offersSentences: 1,
      mentionSentences: 1,
    });
  });

  it("says does_not_offer only from a plain statement", () => {
    expect(decideZelle([doc("We do not offer Zelle.")])).toMatchObject({ status: "does_not_offer", rule: "not_offered" });
  });

  it("says unclear when documents disagree or only mention Zelle", () => {
    expect(decideZelle([doc("Send money with Zelle in our app."), doc("We do not offer Zelle.", 2)])).toMatchObject({ status: "unclear", rule: "conflict" });
    expect(decideZelle([doc("Scammers often ask for payment by Zelle.")])).toMatchObject({ status: "unclear", rule: "mention" });
  });
});
