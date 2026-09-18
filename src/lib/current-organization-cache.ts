import * as SecureStore from 'expo-secure-store';

/**
 * Phase 23 addition: a small on-device cache of the signed-in user's own
 * `organization_id`, kept purely so the offline-mirror fallback
 * (offline-db.ts's `getAllLocalInspectionHeaders`, used by
 * inspections/index.tsx when there's no network) can filter to the right
 * organization even with no connectivity to ask Supabase.
 *
 * This is deliberately *not* the security boundary -- Supabase RLS
 * (`profiles.organization_id` / `current_organization_id()`, migration
 * 0001) is what actually enforces tenant isolation for every online query,
 * exactly like `checkThisDeviceRevoked()` in device-registration.ts is a
 * client-side belt on top of a real server-side boundary. This cache only
 * exists because the *local* SQLite mirror has no RLS of its own, so
 * without it a device that was previously signed in as a different
 * organization's user (a shared/reissued device) could show that other
 * org's mirrored inspections in the fully-offline fallback list.
 *
 * Populated once per session in auth-context.tsx's post-auth effect
 * (alongside device registration), and cleared on sign-out at the same
 * time the local mirror itself is cleared -- see auth-context.tsx's
 * `signOut()`.
 */
const CURRENT_ORGANIZATION_ID_KEY = 'current_organization_id_v1';

export async function cacheCurrentOrganizationId(organizationId: string): Promise<void> {
  await SecureStore.setItemAsync(CURRENT_ORGANIZATION_ID_KEY, organizationId);
}

export async function getCachedOrganizationId(): Promise<string | null> {
  return SecureStore.getItemAsync(CURRENT_ORGANIZATION_ID_KEY);
}

export async function clearCachedOrganizationId(): Promise<void> {
  await SecureStore.deleteItemAsync(CURRENT_ORGANIZATION_ID_KEY);
}
