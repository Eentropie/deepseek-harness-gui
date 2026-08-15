/**
 * A fresh Harness session already pins the Host's default permission preset.
 * Return only a real per-session override so the default is not replayed as a
 * visible `/permission ...` user turn before the first prompt.
 */
export function permissionOverrideForNewSession(
  selectedPreset: string,
  hostDefaultPreset: string,
): string | undefined {
  return selectedPreset === hostDefaultPreset ? undefined : selectedPreset
}
