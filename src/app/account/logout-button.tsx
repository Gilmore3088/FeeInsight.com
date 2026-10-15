import { SignOutForm } from "@/components/sign-out-form";

export function LogoutButton() {
  return (
    <SignOutForm
      next="/login"
      buttonClassName="inline-flex min-h-9 items-center rounded-md border border-border bg-white px-3 text-[13px] font-medium text-ink hover:border-brick hover:text-brick transition-colors"
    />
  );
}
