import { describe, expect, it, vi } from "vitest";

import { DARWIN_RECHECK_CHECK, DARWIN_RECHECK_OLDER_LIVE, DARWIN_RECHECK_SECOND_LOOK_LIVE, DARWIN_RECHECK_SECOND_LOOK_LIVE_CODES, DARWIN_RECHECK_SAME_STEP_TAKEDOWN, DARWIN_RECHECK_STRATEGY, recheckVerifiedFees, recheckAssessment, olderLiveShadow, dueSecondLookShadow } from "./verified-recheck";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

const TEXT = [
  "Bill Pay - FREE with E-Statements and Debit Card | $6.95 per Month",
  "Monthly fee for balance of $500 & over | FREE",
  "Overdraft fee $35.00",
].join("\n");

const verifiedRow = {
  review_status: "verified",
  institution_id: 42,
  source_url: "https://testbank.example/fees",
  document_r2_key: null,
  extraction_confidence: "0.9",
  frequency: null,
  source_document_id: 55,
  amount_kind: null,
  rate_percent: null,
};

function dbWith(
  rows: Array<Record<string, unknown>>,
  older: Array<Record<string, unknown>> = [],
  due: Array<Record<string, unknown>> = [],
  firstLooks: Array<Record<string, unknown>> = [],
  texts: Array<{ source_document_id: number; normalized_text: string }> = [{ source_document_id: 55, normalized_text: TEXT }],
): DbMock {
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    // Live rows whose first look is due its second (#1397), and the second look's own read of the flags.
    if (text.includes("JOIN published_fee_records p ON p.fee_published_id = f.fee_published_id")) return Promise.resolve(due);
    if (text.includes("SELECT fee_published_id, kind, evidence")) return Promise.resolve(firstLooks);
    // Live rows verified under an older verify version (#1568).
    if (text.includes("JOIN LATERAL")) return Promise.resolve(older);
    if (text.includes("FROM verified_fee_observations v")) return Promise.resolve(rows);
    if (text.includes("FROM agent_source_texts")) return Promise.resolve(texts);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: 7001 }]);
    return Promise.resolve([]);
  }) as DbMock;
  return db;
}

// Mutation/feedback assertions moved from permissive mocks to verified-recheck.db.test.ts.
// Historical price/column decisions remain pure controls against the unchanged checker.
describe("Darwin recheck policy and unsupported contexts",()=>{
  const base:Parameters<typeof recheckAssessment>[0]={...verifiedRow,fee_verified_id:1,fee_raw_id:2,canonical_fee_key:"bill_pay",verified_amount:0,amount:0,fee_name:"Bill Pay",outlier_flags:[],conditions:null,fee_published_id:null,
    selected_verified:"selected-v",selected_raw:"selected-r",selected_published:null,selected_feedback:null};
  const assess=(changes:Partial<typeof base>,text=TEXT)=>recheckAssessment({...base,...changes},new Map([[55,text]]));
  it("keeps settled versions, default-off switches and narrow live reason unchanged",()=>{
    expect(DARWIN_RECHECK_STRATEGY).toEqual({strategy:"verify.recheck",version:5});
    expect(DARWIN_RECHECK_SAME_STEP_TAKEDOWN).toBe(false);expect(DARWIN_RECHECK_OLDER_LIVE).toBe(false);expect(DARWIN_RECHECK_SECOND_LOOK_LIVE).toBe(false);
    expect(DARWIN_RECHECK_SECOND_LOOK_LIVE_CODES).toEqual(["tier_perk_zero"]);
  });
  it("preserves conditional-zero, retired-category and ordinary paid decisions",()=>{
    expect(assess({conditions:'excerpt="Bill Pay - FREE"'}).check?.code).toBe("conditional_zero");
    expect(assess({canonical_fee_key:"monthly_maintenance",fee_name:"Monthly fee for balance of & over"}).check?.code).toBe("conditional_zero");
    expect(assess({canonical_fee_key:"estatement_fee",fee_name:"Includes: Bill Pay E-Statement Mobile Access"}).check?.code).toBe("retired_category");
    expect(assess({canonical_fee_key:"overdraft",fee_name:"Overdraft fee",amount:35,verified_amount:35}).check).toBeNull();
  });
  it("keeps a genuinely free Bill Pay even with unrelated buy-back money",()=>{
    const text="FREE Debit Card, FREE Bill Pay, FREE eStatements, Buy back of unused checks up to $10 within 30 days";
    expect(assess({conditions:`excerpt="${text}"`},text).check).toBeNull();
  });
  it("v5 keeps two-column free ATM and Bill Pay separate from a scoped check-print price",()=>{
    const poca="POS transactions No Charge Wire Transfers\nForeign ATM usage No Charge Customer (incoming) $15.00\nReplacement Card $10.00 Customer Domestic (outgoing) $30.00\nCustomer International $60.00";
    expect(assess({canonical_fee_key:"atm_non_network",fee_name:"Foreign ATM usage"},poca).check).toBeNull();
    const tcfcu="Check Printing (members over 62) ----------- No Charge | Money Orders ------------------------------------ $3.00 each\nBill Pay | Other Fees\nBill Pay ------------------------------------------- No Charge | Account History ---------------------------------- $3.00 each";
    expect(assess({},tcfcu).check).toBeNull();
    expect(assess({canonical_fee_key:"check_printing",fee_name:"Check Printing (members over 62)"},tcfcu).check).not.toBeNull();
  });
  it("keeps zero tier perks challenged and an ordinary paid price passing",()=>{
    const source_url="https://www.examplebank.com/agreements-disclosures/truth-in-savings/premium-account-fees";
    expect(assess({source_url,canonical_fee_key:"stop_payment",fee_name:"Stop Payment"}).check?.code).toBe("tier_perk_zero");
    expect(assess({source_url,canonical_fee_key:"overdraft",fee_name:"Overdraft fee",amount:35,verified_amount:35}).check).toBeNull();
  });
  it("unsupported standalone tags cannot claim atomic effects",async()=>{
    const db=dbWith([]);const result=await recheckVerifiedFees(db as never,{runId:503,stepId:9});
    expect(result.execution).toMatchObject({state:"unavailable",reasonCode:"transaction_unavailable",eventId:null});expect(db).not.toHaveBeenCalled();
  });
  it("legacy older-live shadow stays read-only with its existing sample semantics",async()=>{
    const rows=[{...base,source_url:"https://www.examplebank.com/premium-account-fees",canonical_fee_key:"overdraft",fee_name:"Overdraft",fee_published_id:10}];
    const db=dbWith([],rows);const result=await olderLiveShadow(db as never,{runId:600});
    expect(result).toMatchObject({read:1,wouldFail:{tier_perk_zero:1}});
    expect(db.mock.calls.some(call=>/\b(INSERT|UPDATE)\b/.test(templateText(call[0])))).toBe(false);
  });
  it("legacy due shadow is still a would-outcome report, not a settlement",async()=>{
    const row={...base,source_url:"https://www.examplebank.com/premium-account-fees",canonical_fee_key:"overdraft",fee_name:"Overdraft",fee_published_id:10};
    const db=dbWith([],[],[row]);const result=await dueSecondLookShadow(db as never);
    expect(result).toMatchObject({due:1,wouldConfirm:{tier_perk_zero:1},wouldClear:0});
    expect(db.mock.calls.some(call=>/\b(INSERT|UPDATE)\b/.test(templateText(call[0])))).toBe(false);
  });
});
