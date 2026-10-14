import { NextResponse, type NextRequest } from "next/server";

/**
 * Outreach drafts link to /institution/{id}/market (src/lib/agents/growth/outreach.ts), the free
 * market snapshot. Until that page ships (draft PR 669, waiting on design review) the link
 * would 404, so it lands on the institution's profile instead, keeping the UTM tags for
 * visit tracking. PR 669 replaces this file with the snapshot page.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const target = new URL(request.url);
  target.pathname = /^\d+$/.test(id) ? `/institution/${id}` : "/institutions";
  // Temporary (307): the snapshot page will take this address over.
  return NextResponse.redirect(target, 307);
}
