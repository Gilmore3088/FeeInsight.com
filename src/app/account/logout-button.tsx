import { SignOutForm } from "@/components/sign-out-form";

export function LogoutButton() {
  return (
    <SignOutForm
      next="/login"
      buttonClassName="text-[13px] font-medium text-[#6B6255] hover:text-[#A93D25] transition-colors"
    />
  );
}
