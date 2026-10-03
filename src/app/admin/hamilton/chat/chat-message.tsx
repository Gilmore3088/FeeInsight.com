"use client";

import { extractChartData, InlineChart } from "../research/[agentId]/chat-chart";
import {
  markdownTablesToCsv,
  hasMarkdownTable,
  downloadFile,
  buildReportHtml,
} from "../research/[agentId]/export-utils";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isLast: boolean;
  isLoading: boolean;
  onGenerateReport?: () => void;
}

/**
 * Detect whether a response is a structured mini-report.
 * Triggers warm editorial card rendering (D-16).
 */
function isMiniReport(text: string): boolean {
  const hasKeyFinding = text.includes("## Key Finding");
  const sectionCount = (text.match(/^###/gm) ?? []).length;
  return hasKeyFinding || sectionCount >= 3;
}

/**
 * Markdown to HTML with headings, tables, lists, and inline formatting.
 * Escapes HTML entities first to prevent XSS (T-17-06).
 * Pull quotes with blockquote "> **Key Finding:**" get amber left-border treatment.
 */
function simpleMarkdown(text: string): string {
  // T-17-06: Escape HTML entities BEFORE any processing to prevent XSS
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Quotes too: links below become href="…" attributes, and a raw " would end the attribute.
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  // Horizontal rules
  html = html.replace(
    /^---+$/gm,
    '<hr class="my-4 border-gray-200 dark:border-gray-700" />'
  );

  // Tables
  html = html.replace(
    /^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm,
    (_match: string, header: string, _sep: string, body: string) => {
      const headers = header
        .split("|")
        .filter((c: string) => c.trim())
        .map((c: string) => `<th class="text-[11px] font-semibold text-gray-400 uppercase tracking-wider bg-gray-50 border border-gray-200 px-2 py-1">${c.trim()}</th>`)
        .join("");
      const rows = body
        .trim()
        .split("\n")
        .map((row: string) => {
          const cells = row
            .split("|")
            .filter((c: string) => c.trim())
            .map((c: string) => `<td class="border border-gray-200 px-2 py-1 text-[12px]">${c.trim()}</td>`)
            .join("");
          return `<tr class="hover:bg-gray-50/50">${cells}</tr>`;
        })
        .join("");
      return `<table class="w-full border-collapse my-3 text-[12px]"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    }
  );

  // Blockquotes — warm editorial pull quote (D-16)
  html = html.replace(
    /^&gt; (.+)$/gm,
    '<blockquote class="border-l-4 border-amber-500 pl-4 my-3 text-[14px] font-medium text-gray-800 dark:text-gray-200 italic leading-relaxed">$1</blockquote>'
  );

  // Headings
  html = html.replace(
    /^#### (.+)$/gm,
    '<h4 class="text-[13px] font-bold text-gray-800 dark:text-gray-200 mt-4 mb-1">$1</h4>'
  );
  html = html.replace(
    /^### (.+)$/gm,
    '<h3 class="text-[14px] font-bold text-gray-800 dark:text-gray-200 mt-5 mb-1.5">$1</h3>'
  );
  html = html.replace(
    /^## (.+)$/gm,
    '<h2 class="text-[15px] font-bold text-gray-900 dark:text-gray-100 mt-6 mb-2 pb-1 border-b border-gray-100 dark:border-gray-800">$1</h2>'
  );
  html = html.replace(
    /^# (.+)$/gm,
    '<h1 class="text-[16px] font-extrabold text-gray-900 dark:text-gray-100 mt-6 mb-2">$1</h1>'
  );

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Inline code
  html = html.replace(
    /`([^`]+)`/g,
    '<code class="rounded bg-gray-100 px-1 text-[11px] dark:bg-gray-800">$1</code>'
  );

  // Links — only allow http/https protocols to prevent XSS via javascript: URIs (T-17-06)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline dark:text-blue-400">$1</a>'
  );

  // Numbered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li class="list-decimal">$1</li>');
  html = html.replace(
    /(<li class="list-decimal">.*<\/li>\n?)+/g,
    '<ol class="list-decimal ml-4 space-y-0.5">$&</ol>'
  );

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(
    /(<li>(?!.*class=).*<\/li>\n?)+/g,
    '<ul class="list-disc ml-4 space-y-0.5">$&</ul>'
  );

  // Paragraphs
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;

  // Clean up empty paragraphs around block elements
  html = html.replace(/<p>\s*(<h[1-4]|<table|<ul|<ol|<hr|<blockquote)/g, "$1");
  html = html.replace(
    /(<\/h[1-4]>|<\/table>|<\/ul>|<\/ol>|<hr[^>]*\/>|<\/blockquote>)\s*<\/p>/g,
    "$1"
  );
  html = html.replace(/<p>\s*<\/p>/g, "");

  return html;
}

export function ChatMessage({
  role,
  content,
  isLast,
  isLoading,
  onGenerateReport,
}: ChatMessageProps) {
  if (role === "user") {
    return (
      <div className="mb-4 flex justify-end">
        <div className="max-w-[75%] rounded-lg bg-gray-900 px-3.5 py-2.5 text-[13px] text-white dark:bg-gray-700">
          {content}
        </div>
      </div>
    );
  }

  const isReport = isMiniReport(content);
  const chartData = extractChartData(content);

  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Hamilton
      </p>

      {isReport ? (
        /* Mini-report card with amber accent bar (D-16 warm editorial palette) */
        <div className="admin-card p-5 border-t-2 border-amber-400">
          <div
            className="prose prose-sm prose-gray max-w-none text-[14px] leading-relaxed dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: simpleMarkdown(content) }}
          />
          {!isLoading && chartData && chartData.length >= 2 && (
            <InlineChart data={chartData} />
          )}
        </div>
      ) : (
        /* Standard conversational message */
        <div
          className="max-w-[90%] prose prose-sm prose-gray text-[13px] leading-relaxed dark:prose-invert [&_table]:text-[11px] [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_table]:border-gray-200 [&_th]:border [&_td]:border [&_th]:bg-gray-50 dark:[&_th]:bg-gray-800 dark:[&_table]:border-gray-700"
          dangerouslySetInnerHTML={{ __html: simpleMarkdown(content) }}
        />
      )}

      {!isLoading && chartData && chartData.length >= 2 && !isReport && (
        <InlineChart data={chartData} />
      )}

      {/* Action bar on last assistant message when content is substantive */}
      {isLast && !isLoading && content.length > 200 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* Export Markdown */}
          <button
            onClick={() => {
              navigator.clipboard.writeText(content);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300 transition-colors"
            title="Copy markdown to clipboard"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Export Markdown
          </button>

          {/* Export CSV if tables present */}
          {hasMarkdownTable(content) && (
            <button
              onClick={() => {
                const csv = markdownTablesToCsv(content);
                if (csv) {
                  const ts = new Date().toISOString().split("T")[0];
                  downloadFile(csv, `hamilton-data-${ts}.csv`, "text/csv");
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400 transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export CSV
            </button>
          )}

          {/* Export Report — print via buildReportHtml */}
          <button
            onClick={() => {
              const html = buildReportHtml(content, "Hamilton");
              const win = window.open("", "_blank");
              if (win) {
                win.document.write(html);
                win.document.close();
                setTimeout(() => win.print(), 500);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-300 transition-colors"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Export Report
          </button>

          {/* Generate Report quick-action */}
          {onGenerateReport && (
            <button
              onClick={onGenerateReport}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400 transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              Generate Report
            </button>
          )}
        </div>
      )}

      {/* Loading indicator */}
      {isLast && isLoading && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-400">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400 [animation-delay:150ms]" />
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400 [animation-delay:300ms]" />
        </div>
      )}
    </div>
  );
}
