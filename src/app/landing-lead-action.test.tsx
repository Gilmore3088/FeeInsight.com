import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/analytics",()=>({trackEvent:vi.fn()}));
vi.mock("@/lib/marketing-touch",()=>({readFirstTouch:()=>null}));
import { LandingLeadAction } from "./landing-lead-action";

beforeEach(()=>{
  Object.defineProperty(HTMLDialogElement.prototype,"showModal",{configurable:true,value:function(){this.setAttribute("open","");}});
  Object.defineProperty(HTMLDialogElement.prototype,"close",{configurable:true,value:function(){this.removeAttribute("open");}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function openAndSubmit(offer:"walkthrough"|"sample") {
  render(<LandingLeadAction offer={offer} />);
  fireEvent.click(screen.getByRole("button",{name:offer==="sample"?"Download sample report":"Request a free walkthrough"}));
  fireEvent.change(screen.getByLabelText("Work email"),{target:{value:"buyer@example.org"}});
  fireEvent.submit(screen.getByLabelText("Work email").closest("form")!);
}
describe("homepage resource requests",()=>{
  it("records a walkthrough as an explicit contact request instead of a newsletter subscription",async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true}),{status:200}));vi.stubGlobal("fetch",fetcher);
    openAndSubmit("walkthrough");
    expect(await screen.findByRole("status")).toHaveTextContent("received your walkthrough request");
    const [url,request]=fetcher.mock.calls[0];expect(url).toBe("/api/leads");
    const payload=JSON.parse(request.body);expect(payload.source).toBe("contact_walkthrough");expect(payload.email).toBe("buyer@example.org");expect(payload.use_case).toContain("no newsletter opt-in");
    expect(screen.queryByRole("link",{name:/Download sample PDF/})).toBeNull();
  });
  it("reveals the actual sample download only after the server accepts the request",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true}),{status:200})));
    openAndSubmit("sample");
    expect(await screen.findByRole("link",{name:"Download sample PDF"})).toHaveAttribute("href","/reports/sample-competitive-fee-position.pdf");
    expect(screen.getByRole("status")).not.toHaveTextContent("emailed");
  });
  it("retains the form and withholds the download when lead storage fails",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({error:"Please try again"}),{status:500})));
    openAndSubmit("sample");expect(await screen.findByRole("alert")).toHaveTextContent("Please try again");
    expect(screen.queryByRole("link",{name:"Download sample PDF"})).toBeNull();
    expect(screen.getByRole("button",{name:"Get the sample PDF"})).toBeEnabled();
  });
});
