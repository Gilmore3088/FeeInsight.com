import { buildLlmsTxt } from "@/lib/llms-txt";

export const dynamic = "force-static";

/** /llms.txt (llmstxt.org): the site map for AI assistants; content in `src/lib/llms-txt.ts`. */
export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
  });
}
