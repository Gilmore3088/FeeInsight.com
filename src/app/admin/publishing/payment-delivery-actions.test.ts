// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({ user:vi.fn(), drain:vi.fn(), resolve:vi.fn(), revalidate:vi.fn() }));
vi.mock("@/lib/auth",()=>({getCurrentUser:m.user}));
vi.mock("next/cache",()=>({revalidatePath:m.revalidate}));
vi.mock("@/lib/billing/payment-delivery",()=>({drainPaymentEmails:m.drain}));
vi.mock("@/lib/data-store/payment-outbox",()=>({resolvePaymentEmail:m.resolve}));
import {retryPaymentEmail,resolvePaymentDelivery} from "./payment-delivery-actions";
const id="00000000-0000-4000-8000-000000000001";
function form(){const data=new FormData();data.set("jobId",id);data.set("note","Verified receipt manually");return data;}
beforeEach(()=>{vi.clearAllMocks();m.user.mockResolvedValue({id:7,role:"admin"});});
describe("payment recovery authorization",()=>{
  it.each([null,{role:"viewer"},{role:"premium"},{role:"analyst"}])("rejects non-admin %j before recovery or mutation",async(user)=>{
    m.user.mockResolvedValue(user);await expect(retryPaymentEmail(form())).rejects.toThrow("Administrator");await expect(resolvePaymentDelivery(form())).rejects.toThrow("Administrator");
    expect(m.drain).not.toHaveBeenCalled();expect(m.resolve).not.toHaveBeenCalled();
  });
  it("limits retries to the requested saved job without bypass parameters",async()=>{
    await retryPaymentEmail(form());expect(m.drain).toHaveBeenCalledWith(null,id);expect(m.revalidate).toHaveBeenCalledWith("/admin/publishing");
  });
  it("records the authenticated operator, never an actor supplied by the form",async()=>{
    const input=form();input.set("userId","999");await resolvePaymentDelivery(input);expect(m.resolve).toHaveBeenCalledWith(id,7,"Verified receipt manually");
  });
  it("rejects malformed ids before database/provider access",async()=>{
    const input=form();input.set("jobId","not-a-uuid");await expect(retryPaymentEmail(input)).rejects.toThrow("Invalid");expect(m.drain).not.toHaveBeenCalled();
  });
});
