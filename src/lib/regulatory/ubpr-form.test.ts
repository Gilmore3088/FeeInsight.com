import {strToU8,zipSync} from "fflate";
import {describe,expect,it,vi} from "vitest";
import {fetchUbprBulk,UBPR_RATIO_PRODUCT} from "./ubpr-peer-groups";

const FIELD="ctl00$MainContentHolder$";
// These are labelled protocol fixtures using field names seen in production, not captured HTML.
function page(handler:string,version:number) {
  return `<input type="hidden" name="__VIEWSTATE" value="state-${version}">
  <input type="hidden" name="__VIEWSTATEGENERATOR" value="gen">
  <input type="hidden" name="__EVENTVALIDATION" value="validation-${version}">
  <select name="${FIELD}ListBox1"><option value="UBPR">UBPR Ratio -- Single Period</option></select>
  <select name="${FIELD}DatesDropDownList"><option value="2017-09-30">09/30/2017</option></select>
  <input type="radio" name="${FIELD}FormatType" value="TSVRadioButton" ${handler}>
  <input type="submit" name="${FIELD}TabStrip1$Download_0" value="Download">`;
}

function server(handler:string,target:string|null) {
  const posts:URLSearchParams[]=[];
  let version=0;
  const fetchImpl=vi.fn(async (_url:string,init?:RequestInit)=>{
    if(!init?.body) return new Response(page(handler,version),{headers:{"set-cookie":"ASP.NET_SessionId=fixture; Path=/","content-type":"text/html"}});
    const form=new URLSearchParams(String(init.body));posts.push(form);
    expect((init.headers as Record<string,string>).Cookie).toBe("ASP.NET_SessionId=fixture");
    expect(form.get("__VIEWSTATE")).toBe(`state-${version}`);
    expect(form.get("__EVENTVALIDATION")).toBe(`validation-${version}`);
    const event=form.get("__EVENTTARGET");
    if(form.has(`${FIELD}TabStrip1$Download_0`)){
      expect(form.get(`${FIELD}FormatType`)).toBe("TSVRadioButton");
      const expectedPosts=target?4:3;
      if(posts.length!==expectedPosts) return new Response(page(handler,version),{headers:{"content-type":"text/html"}});
      return new Response(zipSync({"fixture.txt":strToU8('ID_RSSD\tGROUP\nID\tPeer group number\n1\t2\n')}),{headers:{"content-type":"application/zip"}});
    }
    if(posts.length===3) expect(event).toBe(target);
    version++;
    return new Response(page(handler,version),{headers:{"content-type":"text/html"}});
  }) as unknown as typeof fetch;
  return {fetchImpl,posts};
}

describe("UBPR published format control",()=>{
  it("uses the actual RadioButtonList postback target and fresh state",async()=>{
    const target=`${FIELD}FormatType$0`;
    const {fetchImpl,posts}=server(`onclick="javascript:setTimeout('__doPostBack(\\'${target}\\',\\'\\')', 0)"`,target);
    const result=await fetchUbprBulk({year:2017,quarter:3},UBPR_RATIO_PRODUCT,{fetchImpl},()=>[0,1]);
    expect(result.zip).not.toBeNull();
    expect(posts[2].get("__EVENTTARGET")).toBe(target);
  });
  it("submits a non-postback radio with Download instead of inventing a separate event",async()=>{
    const {fetchImpl,posts}=server("",null);
    const result=await fetchUbprBulk({year:2017,quarter:3},UBPR_RATIO_PRODUCT,{fetchImpl},()=>[0,1]);
    expect(result.zip).not.toBeNull();
    expect(posts).toHaveLength(3);
  });
});

it("reads HTML-encoded postback quotes and rejects handlers it cannot reproduce",async()=>{
  const target=`${FIELD}FormatType$0`;
  const {fetchImpl}=server(`onclick="__doPostBack(&#39;${target}&#39;,&#39;&#39;)"`,target);
  expect((await fetchUbprBulk({year:2017,quarter:3},UBPR_RATIO_PRODUCT,{fetchImpl},()=>[0,1])).zip).not.toBeNull();
  const unsupported=server('onclick="selectOtherFormat()"',null);
  await expect(fetchUbprBulk({year:2017,quarter:3},UBPR_RATIO_PRODUCT,{fetchImpl:unsupported.fetchImpl})).rejects.toThrow("unsupported handler");
  expect(unsupported.posts).toHaveLength(2);
});
