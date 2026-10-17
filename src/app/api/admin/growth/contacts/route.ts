import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { contactsCsv, contactsSchemaReady, leadersCsvLines, listProspectContacts, listProspectLeaders } from "@/lib/agents/growth/contacts";
import { getBuyerCoverage } from "@/lib/data-store/competitor-coverage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The prospect contacts NIELSEN found, then the named leaders printed without an address, as a CSV for James. Read-only. */
async function handleGET() {
  const user = await getCurrentUser();
  // Admins only: these are people's work addresses, not product data.
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = (await contactsSchemaReady()) ? await listProspectContacts() : [];
  // Market coverage is extra columns; the list still downloads without it.
  const coverage = await getBuyerCoverage([...new Set(rows.map((row) => row.institution_id))]).catch(() => new Map());
  const leaders = (await contactsSchemaReady()) ? await listProspectLeaders() : [];
  const day = new Date().toISOString().slice(0, 10);
  const csv = contactsCsv(rows, coverage) + leadersCsvLines(leaders).map((line) => `${line}\n`).join("");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prospect-contacts-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

export const GET = withApiRoutePolicy("api.admin.growth.contacts", "GET", handleGET);
