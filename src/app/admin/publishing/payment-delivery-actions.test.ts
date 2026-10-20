// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({ user:vi.fn(), drain:vi.fn(), resolve:vi.fn(), revalidate:vi.fn(), sql:vi.fn() }));
vi.mock("@/lib/auth",()=>({getCurrentUser:m.user}));
vi.mock("next/cache",()=>({revalidatePath:m.revalidate}));
vi.mock("@/lib/billing/payment-delivery",()=>({drainPaymentEmails:m.drain}));
vi.mock("@/lib/data-store/payment-outbox",()=>({resolvePaymentEmail:m.resolve}));
vi.mock("@/lib/data-store/connection",()=>({sql:m.sql,withTransaction:vi.fn()}));
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
  it("records a whole-number operator when users.id arrives as text (#1970)",async()=>{
    // The real row conversion getCurrentUser uses, and the real outbox guard, with the bigint id as "7".
    const {userFromRow}=await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
    const outbox=await vi.importActual<typeof import("@/lib/data-store/payment-outbox")>("@/lib/data-store/payment-outbox");
    m.user.mockResolvedValue(userFromRow({id:"7",role:"admin"} as Parameters<typeof userFromRow>[0]));
    m.resolve.mockImplementation(outbox.resolvePaymentEmail);m.sql.mockResolvedValue([]);
    await expect(resolvePaymentDelivery(form())).resolves.toBeUndefined();
    expect(m.resolve).toHaveBeenCalledWith(id,7,"Verified receipt manually");expect(m.sql).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed ids before database/provider access",async()=>{
    const input=form();input.set("jobId","not-a-uuid");await expect(retryPaymentEmail(input)).rejects.toThrow("Invalid");expect(m.drain).not.toHaveBeenCalled();
  });
});
