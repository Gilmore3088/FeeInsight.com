// @vitest-environment node
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutIntent, CheckoutIntentStore } from "@/lib/data-store/checkout-intents";
const mocks = vi.hoisted(() => ({ lock:vi.fn(), billingLock:vi.fn(), state:vi.fn(), create:vi.fn(), list:vi.fn(), retrieve:vi.fn(), expire:vi.fn(), subscription:vi.fn() }));
vi.mock("@/lib/data-store/checkout-intents", () => ({ withCheckoutLock:mocks.lock }));
vi.mock("./subscription-state", () => ({ lockBillingCustomer:mocks.billingLock, readSubscriptionState:mocks.state }));
vi.mock("@/lib/stripe", () => ({ getStripe:()=>({ checkout:{sessions:{create:mocks.create,list:mocks.list,retrieve:mocks.retrieve,expire:mocks.expire}}, subscriptions:{retrieve:mocks.subscription} }) }));
import { checkoutFingerprint, createGuardedCheckout } from "./checkout";
let current:CheckoutIntent|null;
let retired:CheckoutIntent[];
const params = ():Stripe.Checkout.SessionCreateParams => ({ mode:"subscription",customer:"cus_7",line_items:[{price:"price_1",quantity:1}],metadata:{user_id:"7",pro_plan:"annual",institution_id:"99"},success_url:"https://example.invalid/success",cancel_url:"https://example.invalid/cancel" });
const session = (more:Record<string,unknown>={}) => ({ id:"cs_one",customer:"cus_7",mode:"subscription",status:"open",url:"https://checkout.stripe.invalid/one",metadata:{checkout_intent:current?.id},...more });
beforeEach(()=>{
  vi.clearAllMocks(); current=null; retired=[];
  mocks.state.mockResolvedValue("canceled"); mocks.list.mockResolvedValue({data:[],has_more:false});
  mocks.retrieve.mockImplementation(async()=>session()); mocks.create.mockImplementation(async()=>session());
  mocks.expire.mockResolvedValue({status:"expired"}); mocks.subscription.mockResolvedValue({status:"canceled"});
  let queue=Promise.resolve();
  mocks.lock.mockImplementation((_id:number, callback:(store:CheckoutIntentStore)=>Promise<unknown>)=>{
    const run=queue.then(async()=>{
      const before=current?structuredClone(current):null;
      const store={ tx:vi.fn(), current:async()=>current, reserve:async(input:Partial<CheckoutIntent>)=>{
        current={...input,user_id:7,state:"pending",session_id:null,created_at:new Date()} as CheckoutIntent; return current;
      }, session:async(_id:string,id:string)=>{current!.session_id=id;current!.state="open";}, retire:async()=>{retired.push(current!);current=null;}, review:async()=>{current!.state="review";} } as unknown as CheckoutIntentStore;
      try {return await callback(store);} catch(error){current=before;throw error;}
    });
    queue=run.then(()=>undefined,()=>undefined);return run;
  });
});

describe("persisted subscription checkout",()=>{
  it("reuses one session across repeated and concurrent requests",async()=>{
    const results=await Promise.all(Array.from({length:12},()=>createGuardedCheckout(7,"cus_7",params())));
    expect(mocks.create).toHaveBeenCalledTimes(1);expect(new Set(results.map(x=>JSON.stringify(x))).size).toBe(1);
    expect(current?.session_id).toBe("cs_one");
  });
  it("persists the idempotency key before an ambiguous provider failure and reuses it",async()=>{
    mocks.create.mockRejectedValueOnce(new Error("connection lost")).mockImplementationOnce(async()=>session());
    await expect(createGuardedCheckout(7,"cus_7",params())).rejects.toThrow("connection lost");
    const reserved=current!.id;expect(current!.session_id).toBeNull();
    await createGuardedCheckout(7,"cus_7",params());
    expect(mocks.create.mock.calls[0][1].idempotencyKey).toBe(`pro-checkout/${reserved}`);
    expect(mocks.create.mock.calls[1]).toEqual(mocks.create.mock.calls[0]);
  });
  it("recovers an already-created session by its persisted intent tag",async()=>{
    mocks.create.mockRejectedValueOnce(new Error("response lost"));
    await expect(createGuardedCheckout(7,"cus_7",params())).rejects.toThrow();
    mocks.list.mockImplementation(async()=>({data:[session()],has_more:false}));
    await createGuardedCheckout(7,"cus_7",params());expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it.each(["active","past_due","none"])("blocks a second purchase when current state is %s",async(state)=>{
    mocks.state.mockResolvedValue(state);expect(await createGuardedCheckout(7,"cus_7",params())).toHaveProperty("error");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not reset the key when only the return path changes",async()=>{
    await createGuardedCheckout(7,"cus_7",params());
    await createGuardedCheckout(7,"cus_7",{...params(),success_url:"https://example.invalid/new"});
    expect(mocks.create).toHaveBeenCalledTimes(1);expect(mocks.expire).not.toHaveBeenCalled();
  });
  it("expires the prior unpaid session before changing plans",async()=>{
    await createGuardedCheckout(7,"cus_7",params());
    await createGuardedCheckout(7,"cus_7",{...params(),line_items:[{price:"price_2",quantity:1}]});
    expect(mocks.expire).toHaveBeenCalledTimes(1);expect(retired).toHaveLength(1);expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[1][1].idempotencyKey).not.toBe(mocks.create.mock.calls[0][1].idempotencyKey);
  });
  it("cannot replace a session that completed while expiry was requested",async()=>{
    await createGuardedCheckout(7,"cus_7",params());mocks.expire.mockRejectedValueOnce(new Error("already completed"));
    await expect(createGuardedCheckout(7,"cus_7",{...params(),line_items:[{price:"price_2",quantity:1}]})).rejects.toThrow();
    expect(mocks.create).toHaveBeenCalledTimes(1);expect(retired).toHaveLength(0);
  });
  it("blocks an older untracked subscription checkout",async()=>{
    mocks.list.mockResolvedValue({data:[session({metadata:{user_id:"7"}})],has_more:false});
    expect(await createGuardedCheckout(7,"cus_7",params())).toHaveProperty("error");expect(mocks.create).not.toHaveBeenCalled();
  });
  it("never resubmits an ambiguous intent after the provider deduplication window",async()=>{
    mocks.create.mockRejectedValueOnce(new Error("lost"));await expect(createGuardedCheckout(7,"cus_7",params())).rejects.toThrow();
    current!.created_at=new Date(Date.now()-24*3600000);
    expect(await createGuardedCheckout(7,"cus_7",params())).toHaveProperty("error");
    expect(current!.state).toBe("review");expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("retires only positively expired sessions",async()=>{
    await createGuardedCheckout(7,"cus_7",params());mocks.retrieve.mockImplementationOnce(async()=>session({status:"expired",url:null}));
    await createGuardedCheckout(7,"cus_7",params());expect(retired).toHaveLength(1);expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it("blocks completed sessions while their subscription state is uncertain",async()=>{
    await createGuardedCheckout(7,"cus_7",params());mocks.retrieve.mockImplementation(async()=>session({status:"complete",subscription:null}));
    expect(await createGuardedCheckout(7,"cus_7",params())).toHaveProperty("error");expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("allows resubscription only after confirming the prior subscription ended",async()=>{
    await createGuardedCheckout(7,"cus_7",params());mocks.retrieve.mockImplementationOnce(async()=>session({status:"complete",subscription:"sub_old"}));
    await createGuardedCheckout(7,"cus_7",params());expect(mocks.subscription).toHaveBeenCalledWith("sub_old",{},expect.any(Object));expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it("rejects owner mismatch before storage or Stripe access",async()=>{
    await expect(createGuardedCheckout(8,"cus_7",params())).rejects.toThrow("authenticated owner");expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("blocks provider ownership mismatches",async()=>{
    mocks.create.mockImplementation(async()=>session({customer:"cus_someone_else"}));
    expect(await createGuardedCheckout(7,"cus_7",params())).toHaveProperty("error");expect(current!.state).toBe("review");
  });
  it("fails closed on an incomplete checkout inventory",async()=>{
    mocks.list.mockResolvedValue({data:[],has_more:true});await expect(createGuardedCheckout(7,"cus_7",params())).rejects.toThrow("incomplete");expect(mocks.create).not.toHaveBeenCalled();
  });
  it("has a stable fingerprint regardless of metadata insertion order",()=>{
    const a=params();expect(checkoutFingerprint(a)).toBe(checkoutFingerprint({...a,metadata:{institution_id:"99",pro_plan:"annual",user_id:"7"}}));
  });
});
