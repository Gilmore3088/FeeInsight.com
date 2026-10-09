import { SignOutForm } from "@/components/sign-out-form";

export function LogoutButton() {
  return (
    <SignOutForm
      next="/login"
      buttonClassName="inline-flex min-h-9 items-center rounded-md border border-[#E0D7C9] bg-white px-3 text-[13px] font-medium text-[#1A1815] hover:border-[#A93D25] hover:text-[#A93D25] transition-colors"
    />
  );
}
