import { requireAuth } from "@/lib/auth";
import { DataOperations } from "./data-operations";
import { RoomHeader } from "../room-hub";

export const dynamic = "force-dynamic";

/** The Data room: what is live and the jobs that keep it right. Its screens are in the room menu. */
export default async function DataPage() {
  await requireAuth("view");
  return (
    <div className="space-y-8">
      <RoomHeader room="data" />

      <DataOperations />
    </div>
  );
}
