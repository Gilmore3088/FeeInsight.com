// Example site headers for each product.
import { Logo, AppIcon, Button } from "@/brand/components";

export function BankFeeIndexHeader() {
  return (
    <header className="flex items-center justify-between border-b border-border px-fi-8 py-fi-4">
      <a href="/" aria-label="Bank Fee Index home">
        <Logo mark="bank-fee-index-wordmark" height={28} title="" />
      </a>
      <Button variant="primary">Compare fees</Button>
    </header>
  );
}

export function HamiltonHeader() {
  return (
    <header className="flex items-center justify-between border-b border-border px-fi-8 py-fi-4">
      <a href="/" className="flex items-center gap-fi-3" aria-label="Hamilton home">
        <Logo mark="hamilton-wordmark" height={28} title="" />
      </a>
      <Button variant="brick">Book a demo</Button>
    </header>
  );
}

export function HamiltonChatAvatar() {
  return <AppIcon brand="hamilton" size={32} title="Hamilton" />;
}
