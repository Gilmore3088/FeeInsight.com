/** Sign-in and registration render without the site header; UtilityShell gives each its main landmark. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
