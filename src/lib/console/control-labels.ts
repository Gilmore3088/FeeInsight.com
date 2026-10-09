/**
 * The one wording for the provider stop (the `global` automation control), so
 * Controls, Spend guard and Today never describe the same switch differently.
 * null means the control could not be read; that is never shown as a setting.
 */
export function providerStopLabel(enabled: boolean | null): string {
  if (enabled === null) return "Couldn't read the control";
  return enabled ? "Provider calls allowed (stop off)" : "Stopped (stop on)";
}
