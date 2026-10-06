export const dynamic = "force-dynamic";

/**
 * /admin/agents. The admin shell's room menu already lists every Agents screen,
 * so this layout adds no navigation of its own; each page carries its own title.
 */
export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
