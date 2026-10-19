"use server";

import { extractInstitutionCommand, setInstitutionFeeUrl } from "@/lib/institution-commands";

export async function updateFeeScheduleUrl(
  institutionId: number,
  url: string,
): Promise<{ success: boolean; error?: string }> {
  return setInstitutionFeeUrl(institutionId, url);
}

export async function extractInstitution(
  institutionId: number,
): Promise<{ success: boolean; jobId?: number; reused?: boolean; error?: string }> {
  return extractInstitutionCommand(institutionId);
}
