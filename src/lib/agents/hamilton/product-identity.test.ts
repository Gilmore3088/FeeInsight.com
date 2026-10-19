import { describe, expect, it } from "vitest";
import { productKey, sameProduct } from "@/lib/fee-product";
import { secondSourceCheck, type SourceCopy } from "../darwin/peer-checks";
import { exactDuplicateDecision, collapseLineKey, type CollapseLine } from "./exact-duplicate";
import { decidePriorFee, type VerifiedFeeRow, type PriorPublishedFeeRow } from "./publish";
import { planRefreshes, type RefreshCopyCandidate } from "./refresh-copy";
import { nearNameRepeats, type NearNameRow } from "./duplicate-collapse";
import { pageCopyRepeats, type PageCopyRow } from "./page-copy-collapse";
import { newerCopyVerdict } from "./newer-copy-retire";
import { currentCopyVerdict, type CurrentCopyFeeRow } from "./current-copy";
import { ancillaryAccountText } from "../knox/ancillary-product-fixtures";

const row = { fee_verified_id: 1, fee_raw_id: 1, institution_id: 7, source_url: "https://bank.test/fees.pdf", document_r2_key: null,
 extraction_confidence: .95, canonical_fee_key: "money_order", variant_type: null, outlier_flags: ["agentic_darwin_verified"],
 verified_by_agent_event_id: "00000000-0000-4000-8000-000000000001", fee_name: "Personal money order", amount:5,
 frequency:"per_item", raw_agent_event_id:null, product_name:"Everyday Debit Account" } satisfies VerifiedFeeRow;
const prior = { fee_published_id:2,amount:5,fee_name:row.fee_name,published_at:"2026-10-01" } satisfies PriorPublishedFeeRow;
const text = ancillaryAccountText();
const pairs = [["Everyday Debit Account","Premium Debit Account"],["Everyday Debit Account",null],[null,"Premium Debit Account"]] as const;
describe("Product applicability across shared fee identity consumers (#1911 code phase)", () => {
 it("normalizes supported whitespace/case only and retains meaningful names", () => {
  expect(productKey(" \tEVERYDAY\u00a0 Debit \nAccount\u00a0")).toBe("everyday debit account");
  expect(productKey("\u00a0\t")).toBe("");
  expect(sameProduct("México Account", "méxico account")).toBe(true);
  expect(sameProduct("Ü Account", "ü Account")).toBe(false);
  expect(sameProduct("Everyday Debit Account", "Everyday Checking Account")).toBe(false);
 });
 it.each(pairs)("keeps %s versus %s separate in prior/exact/in-step/refresh/source agreement", (one,two) => {
  const candidate={...row,product_name:one};
  expect(decidePriorFee(candidate,[{...prior,product_name:two}]).kind).toBe("new");
  expect(exactDuplicateDecision(candidate,[{fee_published_id:2,fee_audience:null,frequency:"per_item",published_at:null,in_step:true,product_name:two}])).toEqual({kind:"none"});
  const line={institutionId:7,canonicalFeeKey:"money_order",variantType:null,amount:5,ratePercent:null,amountKind:"flat",rateMinAmount:null,rateMaxAmount:null,feeName:row.fee_name} as CollapseLine;
  expect(collapseLineKey({...line,productName:one})).not.toBe(collapseLineKey({...line,productName:two}));
  const refresh={...candidate,prior_product_name:two,prior_fee_published_id:2,prior_fee_name:row.fee_name,prior_amount:5,prior_source_document_id:1} satisfies RefreshCopyCandidate;
  expect(planRefreshes([refresh]).skipped[0].reason).toBe("product_differs");
  const check={feeRawId:1,institutionId:7,sourceDocumentId:10,canonicalFeeKey:"money_order",amount:5,feeAudience:"consumer" as const,productName:one};
  const copy={...check,feeRawId:2,sourceDocumentId:20,productName:two} satisfies SourceCopy;
  expect(secondSourceCheck(check,[copy])).toBeNull();
 });
 it.each(pairs)("keeps %s versus %s separate in near-name and page-copy plans", (one,two) => {
  const near={fee_published_id:1,institution_id:7,source_document_id:10,canonical_fee_key:"money_order",variant_type:null,amount:5,fee_name:row.fee_name,frequency:"per_item",fee_audience:"consumer",published_at:null,product_name:one} satisfies NearNameRow;
  expect(nearNameRepeats([near,{...near,fee_published_id:2,product_name:two}],new Map([["10",text]])).pairs).toBe(0);
  const page={...near,document_url:"https://bank.test/fees.pdf",crawled_at:"2026-10-01"} satisfies PageCopyRow;
  expect(pageCopyRepeats([page,{...page,fee_published_id:2,source_document_id:20,crawled_at:"2026-10-02",product_name:two}],new Map([["10",text],["20",text]])).pairs).toBe(0);
 });
 it("does not use another or unknown product's text to restore, retire, or confirm an owned fee", () => {
  for(const current of [ancillaryAccountText("Premium Debit Account"),"Personal money order $5.00\nStop Payment $30.00"]){
   expect(newerCopyVerdict(row,current,text)).toBe("unproven");
   expect(currentCopyVerdict({...row,fee_published_id:2,older_document_id:10,current_document_id:20,restated_row:false} as CurrentCopyFeeRow,current,text)).toBe("unproven");
  }
  expect(newerCopyVerdict(row,text,text)).toBe("still_stated");
  expect(newerCopyVerdict({...row,product_name:null},"Personal money order $5.00",text)).toBe("still_stated");
 });
});
