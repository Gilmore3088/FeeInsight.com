"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG } from "@/lib/admin-dashboard-cache";
import { isWriteCommand, parseCrewCommand } from "@/lib/agents/crew-commands";
import { answerCrewCommand, executeCrewWrite, type CrewReply } from "@/lib/agents/crew-execute";

const MAX_COMMAND_LENGTH = 200;

function errorReply(error: unknown): CrewReply {
  return { speaker: "Atlas", lines: [`Something went wrong: ${error instanceof Error ? error.message : String(error)}`] };
}

/** Answer a crew command. Writes only come back as a proposal to confirm. */
export async function askCrew(text: string): Promise<CrewReply> {
  await requireAuth("operate");
  const commandText = String(text ?? "").slice(0, MAX_COMMAND_LENGTH);
  try {
    return await answerCrewCommand(parseCrewCommand(commandText), commandText);
  } catch (error) {
    return errorReply(error);
  }
}

/**
 * Carry out a confirmed write. The original text is parsed again here, so the
 * client can never confirm anything other than what the parser understood.
 */
export async function confirmCrewCommand(commandText: string): Promise<CrewReply> {
  const text = String(commandText ?? "").slice(0, MAX_COMMAND_LENGTH);
  const command = parseCrewCommand(text);
  if (!isWriteCommand(command)) {
    return { speaker: "Atlas", lines: ["There was nothing to confirm."] };
  }
  const user = await requireAuth(command.kind === "pause" ? "cancel_jobs" : "trigger_jobs");
  try {
    const reply = await executeCrewWrite(command, user.username);
    updateTag(ADMIN_ATLAS_COMMAND_CENTER_CACHE_TAG);
    revalidatePath("/admin");
    return reply;
  } catch (error) {
    return errorReply(error);
  }
}
