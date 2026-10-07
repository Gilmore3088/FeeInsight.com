import { RD, RD_FONTS, RD_PHONE_MAX, RD_TYPE } from "./tokens";

/**
 * The shared report stylesheet, scoped to `.rd`. HTML-string reports inject it in a <style>
 * tag; React surfaces render <ReportDesignStyles/> (src/components/report-design). Both emit
 * the same class names, so a study, a state report and an answer exhibit look the same.
 *
 * Rules it carries:
 * - Headings balance (no single word on its own line); body text is `pretty`.
 * - An exhibit, a hero row, a table row and a legend never split across a printed page, and a
 *   label or headline never ends a page.
 * - Each chart is drawn wide and narrow; below RD_PHONE_MAX only the narrow one shows. Print
 *   always shows the wide one.
 */
export const REPORT_DESIGN_CSS = `
.rd{color:${RD.ink};font-family:${RD_FONTS.sans};font-size:${RD_TYPE.body}px;line-height:1.6;max-width:960px;margin:0 auto}
.rd h1,.rd h2,.rd h3,.rd h4{text-wrap:balance}
.rd p,.rd li{text-wrap:pretty}
.rd .rd-eyebrow,.rd .rd-label{font-family:${RD_FONTS.sans};font-size:${RD_TYPE.label}px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${RD.terraText};margin:0}
.rd h1.rd-title{font-family:${RD_FONTS.serif};font-weight:600;font-size:${RD_TYPE.title}px;line-height:1.15;letter-spacing:-.01em;margin:6px 0 8px}
.rd .rd-deck{font-family:${RD_FONTS.serif};font-style:italic;font-size:${RD_TYPE.deck}px;line-height:1.5;color:${RD.inkSoft};margin:0 0 12px}
.rd .rd-heroes{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin:18px 0 8px}
.rd .rd-hero{border-top:2px solid ${RD.ink};padding-top:8px}
.rd .rd-hero-fig{font-family:${RD_FONTS.serif};font-size:${RD_TYPE.hero}px;line-height:1.1;font-variant-numeric:tabular-nums}
.rd .rd-hero-lab{font-size:13px;color:${RD.ink};margin-top:4px}
.rd .rd-hero-note{font-size:12px;color:${RD.inkSoft};margin-top:2px}
.rd .rd-exhibit{border-top:1px solid ${RD.rule2};padding:22px 0 8px;margin:18px 0 0;break-inside:avoid;page-break-inside:avoid}
.rd .rd-exhibit.rd-flow{break-inside:auto;page-break-inside:auto}
.rd .rd-exhibit h2{font-family:${RD_FONTS.serif};font-weight:600;font-size:${RD_TYPE.headline}px;line-height:1.25;margin:4px 0 6px}
.rd .rd-sub{font-family:${RD_FONTS.serif};font-style:italic;font-size:16px;line-height:1.5;color:${RD.inkSoft};margin:0 0 12px}
.rd .rd-legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:${RD_TYPE.legend}px;color:${RD.inkSoft};margin:6px 0 10px}
.rd .rd-legend span{display:inline-flex;align-items:center;gap:6px}
.rd .rd-swatch{display:inline-block;width:10px;height:10px;border-radius:2px}
.rd .rd-pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}
.rd .rd-chart{display:block;width:100%;height:auto}
.rd .rd-source{font-size:${RD_TYPE.source}px;font-style:italic;color:${RD.muted};margin-top:8px;line-height:1.5}
.rd .rd-notice{font-size:14px;color:${RD.inkSoft};background:${RD.terraSoft};padding:10px 12px;border-radius:4px;margin:8px 0}
.rd .rd-prose{max-width:680px}
.rd table.rd-table{width:100%;border-collapse:collapse;font-size:13.5px;font-variant-numeric:tabular-nums}
.rd .rd-table th{font-size:${RD_TYPE.label}px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${RD.inkSoft};text-align:left;border-bottom:1px solid ${RD.ink};padding:6px 8px}
.rd .rd-table td{border-bottom:1px solid ${RD.rule};padding:7px 8px;vertical-align:top}
.rd .rd-table td.num,.rd .rd-table th.num{text-align:right;font-family:${RD_FONTS.mono};font-size:13px}
.rd .rd-table tr.rd-subject td{background:${RD.terraSoft};font-weight:600}
.rd .rd-table tr{break-inside:avoid;page-break-inside:avoid}
.rd .rd-tag{display:inline-block;font-size:${RD_TYPE.label}px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:${RD.terraSoft};color:${RD.terraText}}
.rd .sc-narrow{display:none}
@media screen and (max-width:${RD_PHONE_MAX}px){
.rd .sc-wide{display:none}.rd .sc-narrow{display:block}
.rd h1.rd-title{font-size:${RD_TYPE.titlePhone}px}
.rd .rd-exhibit h2{font-size:20px}
.rd .rd-table{font-size:13px}
.rd .rd-table-wrap{overflow-x:auto}
}
@media print{
.rd{max-width:none}
.rd h1,.rd h2,.rd h3,.rd .rd-label,.rd .rd-eyebrow,.rd .rd-legend,.rd .rd-sub{break-after:avoid;page-break-after:avoid}
.rd .rd-heroes{break-inside:avoid;page-break-inside:avoid}
}
`;
