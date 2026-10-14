// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ verify:vi.fn(), tx:vi.fn(), record:vi.fn(), apply:vi.fn(), stage:vi.fn(), drain:vi.fn(), status:vi.fn(), headers:vi.fn(), analytics:vi.fn() }));
vi.mock("@/lib/api-hardening/route-wrapper",()=>({ withApiRoutePolicy:(_id:string,_method:string,handler:unknown)=>handler }));
vi.mock("@/lib/stripe",()=>({ getStripe:()=>({webhooks:{constructEvent:m.verify}}), getWebhookSecret:()=>"fixture" }));
vi.mock("@/lib/data-store/connection",()=>({ withTransaction:m.tx }));
vi.mock("@/lib/stripe-webhook",()=>({recordStripeEvent:m.record,applyStripeEvent:m.apply}));
vi.mock("@/lib/billing/payment-delivery",()=>({stagePaymentEmails:m.stage,drainPaymentEmails:m.drain,paymentEmailStatus:m.status}));
vi.mock("@/lib/analytics-server",()=>({trackServerEvent:m.analytics}));
vi.mock("next/headers",()=>({headers:m.headers}));
import { POST } from "./route";
const request=()=>new Request("https://example.invalid/webhook",{method:"POST",body:"{}"});
beforeEach(()=>{
  vi.clearAllMocks();m.analytics.mockResolvedValue(undefined);m.verify.mockReturnValue({id:"evt_test",type:"checkout.session.completed"});
  m.headers.mockResolvedValue(new Map([["stripe-signature","signed"]]));
  m.record.mockResolvedValue(true);m.apply.mockResolvedValue({welcome:[],reportPaid:[],reportDuplicate:[],reportRefunded:[]});
  m.stage.mockResolvedValue(undefined);m.drain.mockResolvedValue(undefined);m.status.mockResolvedValue({pending:0,review:0});
  m.tx.mockImplementation(async(callback:(tx:unknown)=>Promise<unknown>)=>callback("transaction"));
});
describe("transactional webhook delivery",()=>{
  it("stages the obligation in the payment transaction before draining",async()=>{
    const order:string[]=[];
    m.tx.mockImplementation(async(callback:(tx:unknown)=>Promise<void>)=>{order.push("begin");await callback("transaction");order.push("commit");});
    m.stage.mockImplementation(async(tx:unknown)=>{expect(tx).toBe("transaction");order.push("stage");});
    m.drain.mockImplementation(async()=>{order.push("drain");});
    expect((await POST(request())).status).toBe(200);expect(order).toEqual(["begin","stage","commit","drain"]);
  });
  it("recovers previously committed obligations on duplicate event delivery",async()=>{
    m.record.mockResolvedValue(false);expect((await POST(request())).status).toBe(200);
    expect(m.apply).not.toHaveBeenCalled();expect(m.stage).not.toHaveBeenCalled();expect(m.drain).toHaveBeenCalledWith("evt_test");
  });
  it("rolls back instead of accepting payment without an obligation",async()=>{
    m.stage.mockRejectedValueOnce(new Error("outbox unavailable"));expect((await POST(request())).status).toBe(500);expect(m.drain).not.toHaveBeenCalled();
  });
  it("requests safe redelivery after an interrupted worker",async()=>{
    m.drain.mockRejectedValueOnce(new Error("interrupted"));expect((await POST(request())).status).toBe(503);
    m.record.mockResolvedValue(false);expect((await POST(request())).status).toBe(200);expect(m.apply).toHaveBeenCalledTimes(1);
  });
  it("keeps retrying pending items but acknowledges visible operator-review items",async()=>{
    m.status.mockResolvedValueOnce({pending:1,review:0});expect((await POST(request())).status).toBe(503);
    m.status.mockResolvedValueOnce({pending:0,review:1});expect((await POST(request())).status).toBe(200);
  });
  it("counts activations once, not again on a delivery retry",async()=>{
    m.apply.mockResolvedValue({welcome:[{email:"fixture@example.invalid",name:null}],reportPaid:[],reportDuplicate:[],reportRefunded:[]});
    await POST(request());m.record.mockResolvedValue(false);await POST(request());
    expect(m.analytics).toHaveBeenCalledTimes(1);expect(m.analytics).toHaveBeenCalledWith("pro_activated",{source:"webhook"});
  });
  it("rejects missing or invalid signatures before any database access",async()=>{
    m.headers.mockResolvedValueOnce(new Map());expect((await POST(request())).status).toBe(400);
    m.verify.mockImplementationOnce(()=>{throw new Error("bad signature");});expect((await POST(request())).status).toBe(400);expect(m.tx).not.toHaveBeenCalled();
  });
});
