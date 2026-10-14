import { SignOutForm } from "@/components/sign-out-form";

export function LogoutButton() {
  return (
    <SignOutForm
      next="/admin/login"
      className="contents"
      buttonClassName="inline-flex items-center justify-center min-h-11 min-w-11 px-2.5 rounded-md text-sm text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
    />
  );
}
