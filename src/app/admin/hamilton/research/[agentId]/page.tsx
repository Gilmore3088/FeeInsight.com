export const dynamic = "force-dynamic";
import { requireAuth } from "@/lib/auth";
import { getHamilton } from "@/lib/research/agents";
import { listConversations } from "@/lib/research/history";
import { ResearchChat } from "./research-chat";

export default async function AgentChatPage() {
  const user = await requireAuth("operate");
  const agent = await getHamilton("admin");

  const conversations = await listConversations(user.id, "hamilton", 20);

  return (
    <div className="admin-content">
      <ResearchChat
        agentId="hamilton"
        agentName={agent.name}
        agentDescription={agent.description}
        exampleQuestions={agent.exampleQuestions}
        conversations={conversations.map((c) => ({
          id: c.id,
          title: c.title ?? "Untitled",
          updatedAt: c.updated_at,
        }))}
      />
    </div>
  );
}
