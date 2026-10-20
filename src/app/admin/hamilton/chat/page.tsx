export const dynamic = "force-dynamic";
export const metadata = { title: "Hamilton Chat — Admin" };

import { requireAuth } from "@/lib/auth";
import { listConversations } from "@/lib/hamilton/chat-memory";
import { getHamiltonInstitutionContext } from "@/lib/hamilton/institution-context";
import { HamiltonChat } from "./hamilton-chat";

export default async function HamiltonChatPage({
  searchParams,
}: {
  searchParams: Promise<{ instId?: string; intent?: string }>;
}) {
  // Internal chat is restricted to operator accounts.
  const user = await requireAuth("operate");
  const params = await searchParams;

  const conversations = await listConversations(user.id, 30).catch(() => []);
  const {
    institution: selectedInstitution,
    error: selectedInstitutionError,
  } = await getHamiltonInstitutionContext(params.instId);

  return (
    <div className="admin-content">
      <HamiltonChat
        initialConversations={conversations}
        selectedInstitution={selectedInstitution}
        selectedInstitutionError={selectedInstitutionError}
        initialIntent={params.intent ?? null}
      />
    </div>
  );
}
