// @vitest-environment node
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

// Node resolves the real package's distinct require/import exports. No copied builder,
// Vite transform, browser rendering, network connection or large payload is involved.
function probe(mode: "CommonJS" | "ESM") {
  const loading = mode === "CommonJS"
    ? `const {createRequire}=await import('node:module'); const require=createRequire(process.cwd()+'/fixture.cjs');
       const lib=require('fast-xml-parser'); const resolved=require.resolve('fast-xml-parser');`
    : `const lib=await import('fast-xml-parser'); const resolved=import.meta.resolve('fast-xml-parser');`;
  const script = `${loading}
    const {XMLBuilder,XMLParser}=lib;
    const parse=xml=>new XMLParser({ignoreAttributes:false,parseTagValue:false}).parse(xml);
    const quoteValue='" fixture="value';
    const quoted=new XMLBuilder({ignoreAttributes:false,processEntities:false}).build({a:{'@_attr':quoteValue}});
    const comment=new XMLBuilder({commentPropName:'#comment'}).build({root:{'#comment':'--><injected/><!--',data:'ok'}});
    const cdataValue=']]><injected/><![CDATA[';
    const cdata=new XMLBuilder({cdataPropName:'#cdata'}).build({root:{'#cdata':cdataValue}});
    const normalValue='0 & < > "quoted"';
    const normal=new XMLBuilder({ignoreAttributes:false}).build({root:{'@_attr':normalValue,'#text':normalValue}});
    const zero=new XMLBuilder().build({root:{amount:0,flag:false,empty:''}});
    const entity=new XMLBuilder({ignoreAttributes:false,processEntities:false}).build({root:{'@_attr':'a&amp;b'}});
    console.log(JSON.stringify({resolved,quoteValue,quoted,quote:parse(quoted),comment:parse(comment),
      cdataValue,cdata:parse(cdata),normalValue,normal:parse(normal),zero:parse(zero),entity:parse(entity)}));`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: process.cwd(), encoding: "utf8", timeout: 10_000,
  }));
}

describe.each(["CommonJS", "ESM"] as const)("installed XML builder %s safety", (mode) => {
  let result: ReturnType<typeof probe>;
  beforeAll(() => { result = probe(mode); });

  it("does not split an attribute when entity processing is disabled", () => {
    expect(result.resolved).toMatch(mode === "CommonJS" ? /\/lib\/fxp\.cjs$/ : /\/src\/fxp\.js$/);
    expect(result.quote.a).toEqual({ "@_attr": result.quoteValue });
  });
  it("keeps a comment delimiter payload inside the comment", () => {
    expect(result.comment.root).toEqual({ data: "ok" });
  });
  it("keeps a CDATA delimiter payload as text", () => {
    expect(result.cdata.root).toBe(result.cdataValue);
  });
  it("preserves ordinary text and attribute escaping", () => {
    expect(result.normal.root).toEqual({ "@_attr": result.normalValue, "#text": result.normalValue });
  });
  it("preserves financial zero, false and empty values", () => {
    expect(result.zero.root).toEqual({ amount: "0", flag: "false", empty: "" });
  });
  it("does not double-escape a caller-supplied entity with processing disabled", () => {
    expect(result.entity.root).toEqual({ "@_attr": "a&b" });
  });
});
