"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, ExternalLink } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";

export const SAMPLE_REPORT_PDF = "/reports/sample-competitive-fee-position.pdf";

/** Render the actual PDF in the app, including browsers without a native PDF plugin. */
export function LandingReportDocument({ compact = false }: { compact?: boolean }) {
  const root=useRef<HTMLDivElement>(null);
  const canvas=useRef<HTMLCanvasElement>(null);
  const [enabled,setEnabled]=useState(false);
  const [document,setDocument]=useState<PDFDocumentProxy|null>(null);
  const [page,setPage]=useState(1);
  const [text,setText]=useState("");
  const [error,setError]=useState("");
  const [rendering,setRendering]=useState(true);
  useEffect(()=>{
    if(!root.current)return;
    if(typeof IntersectionObserver==="undefined"){setEnabled(true);return;}
    const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setEnabled(true);observer.disconnect();}},{rootMargin:"200px"});
    observer.observe(root.current);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!enabled)return;
    let cancelled=false;
    let task:ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs")["getDocument"]>|undefined;
    void import("pdfjs-dist/legacy/build/pdf.mjs").then(pdfjs=>{
      if(cancelled)return;
      pdfjs.GlobalWorkerOptions.workerSrc="/reports/pdf.worker.min.mjs";
      task=pdfjs.getDocument({url:SAMPLE_REPORT_PDF});
      return task.promise;
    }).then(pdf=>{if(pdf&&!cancelled)setDocument(pdf);}).catch((cause: unknown)=>{if(!cancelled){console.error("Sample PDF loading failed", cause);setError(`The PDF could not be displayed here. ${cause instanceof Error ? cause.message : "Open the report using the link below."}`);}});
    return()=>{cancelled=true;void task?.destroy();};
  },[enabled]);
  useEffect(()=>{
    if(!document||!canvas.current)return;
    let cancelled=false;
    let task:ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>|undefined;
    setRendering(true);setText("");setError("");
    void document.getPage(page).then(async pdfPage=>{
      if(cancelled||!canvas.current)return;
      const viewport=pdfPage.getViewport({scale:1.5});
      const node=canvas.current;node.width=Math.ceil(viewport.width);node.height=Math.ceil(viewport.height);
      task=pdfPage.render({canvas:node,viewport});
      const content=await pdfPage.getTextContent();
      if(!cancelled)setText(content.items.map(item=>"str" in item?item.str:"").join(" "));
      await task.promise;if(!cancelled)setRendering(false);
    }).catch(e=>{if(!cancelled&&e?.name!=="RenderingCancelledException"){setError("This page could not be rendered. Open the PDF below.");setRendering(false);}});
    return()=>{cancelled=true;task?.cancel();};
  },[document,page]);
  return <div ref={root} className="min-w-0 overflow-hidden rounded-xl border border-[#E0D7C9] bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E0D7C9] px-4 py-3"><span className="inline-flex items-center gap-2 text-sm font-semibold"><FileText size={18} className="text-[#A93D25]" aria-hidden />Competitive Fee Position Report</span><span className="text-xs text-[#6B6255]">Sample · Oct 3, 2026</span></div>
    <div className="flex items-center justify-between gap-3 border-b border-[#E0D7C9] bg-[#FAF7F2] px-4 py-2">
      <button type="button" aria-label="Previous report page" disabled={!document||page<=1||rendering} onClick={()=>setPage(p=>p-1)} className="flex h-11 w-11 items-center justify-center rounded-lg disabled:opacity-30"><ChevronLeft size={20} aria-hidden /></button>
      <span aria-live="polite" className="text-sm">Page {page} of {document?.numPages??10}</span>
      <button type="button" aria-label="Next report page" disabled={!document||page>=document.numPages||rendering} onClick={()=>setPage(p=>p+1)} className="flex h-11 w-11 items-center justify-center rounded-lg disabled:opacity-30"><ChevronRight size={20} aria-hidden /></button>
    </div>
    <div className={`overflow-auto bg-[#EDE5D8] p-3 sm:p-5 ${compact?"h-[420px]":"h-[640px] sm:h-[760px]"}`} aria-busy={rendering&&!error}>
      {error?<p role="alert" className="rounded-lg bg-white p-5 text-sm">{error}</p>:null}
      {!document&&!error?<p role="status" className="p-5 text-center text-sm">Loading the report…</p>:null}
      <canvas ref={canvas} aria-label={`Sample report page ${page}`} className="mx-auto block h-auto w-full max-w-3xl bg-white shadow-lg" />
      <p className="sr-only">{text}</p>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E0D7C9] px-4 py-3 text-xs text-[#6B6255]"><span>Illustrative sample institution and historical figures. Dates and scope are in the report.</span><a href={SAMPLE_REPORT_PDF} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 font-semibold text-[#A93D25]">Open the PDF <ExternalLink size={14} aria-hidden /></a></div>
  </div>;
}
