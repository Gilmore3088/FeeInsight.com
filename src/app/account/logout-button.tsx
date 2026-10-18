import { SignOutForm } from "@/components/sign-out-form";

export function LogoutButton() {
  return (
    <SignOutForm
      next="/login"
      buttonClassName="inline-flex min-h-11 items-center rounded-md border border-control-border bg-surface-0 px-4 text-[14px] font-medium text-ink transition-colors hover:bg-surface-200"
    />
  );
}
