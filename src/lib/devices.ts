import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

/**
 * Data access for the Devices & Security settings screen (Phase 10,
 * PRODUCT_SPEC.md section 6 / supabase/migrations/0022). Reads are plain
 * `.from()` selects -- RLS already scopes `devices` to "your own row, or
 * every row if you're org_admin" and `security_events` to "org_admin
 * only" (see migration 0022), so a non-admin calling `fetchDevices()`
 * simply gets back just their own device(s) with no extra filtering
 * needed here, and `fetchSecurityEvents()` returns nothing at all for a
 * non-admin rather than erroring. The one write here
 * (`revokeDevice()`) goes through `revoke_device()`, since `devices` has
 * no direct update policy for `authenticated`.
 */

export type DeviceRecord = {
  id: string;
  userId: string;
  userEmail: string | null;
  userFullName: string | null;
  fingerprintHash: string;
  status: string;
  registeredAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  replacedByDeviceId: string | null;
  playIntegrityVerdict: Record<string, unknown> | null;
};

type RawDeviceRow = {
  id: string;
  user_id: string;
  fingerprint_hash: string;
  status: string;
  registered_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  replaced_by_device_id: string | null;
  play_integrity_verdict: Record<string, unknown> | null;
  profiles:
    | { email: string; full_name: string | null }
    | { email: string; full_name: string | null }[]
    | null;
};

function mapDeviceRow(row: RawDeviceRow): DeviceRecord {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: profile?.email ?? null,
    userFullName: profile?.full_name ?? null,
    fingerprintHash: row.fingerprint_hash,
    status: row.status,
    registeredAt: row.registered_at,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
    replacedByDeviceId: row.replaced_by_device_id,
    playIntegrityVerdict: row.play_integrity_verdict,
  };
}

const DEVICE_SELECT =
  'id, user_id, fingerprint_hash, status, registered_at, revoked_at, revoked_reason, ' +
  'replaced_by_device_id, play_integrity_verdict, profiles(email, full_name)';

/**
 * For a non-admin, returns just their own device(s) (active and
 * revoked/replaced history). For an org_admin, returns every device in
 * the organization -- both cases are the same RLS-scoped query; see this
 * file's header comment.
 */
export async function fetchDevices(): Promise<{ devices: DeviceRecord[]; error: string | null }> {
  const { data, error } = await supabase
    .from('devices')
    .select(DEVICE_SELECT)
    .order('registered_at', { ascending: false });

  if (error) {
    logger.error('devices', 'Failed to load devices', error);
    return { devices: [], error: 'Could not load device information.' };
  }
  return {
    devices: ((data as unknown as RawDeviceRow[] | null) ?? []).map(mapDeviceRow),
    error: null,
  };
}

const DEVICE_ERROR_MESSAGES: Record<string, string> = {
  insufficient_permission: 'Only an organization admin can revoke a device.',
  device_not_found: 'Could not find that device.',
  not_authenticated: 'We could not confirm your account. Try signing out and back in.',
};

function friendlyDeviceActionError(rawMessage: string): string {
  for (const code of Object.keys(DEVICE_ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return DEVICE_ERROR_MESSAGES[code];
  }
  return 'Could not revoke this device. Please try again.';
}

export async function revokeDevice(
  deviceId: string,
  reason?: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('revoke_device', {
    p_device_id: deviceId,
    p_reason: reason ?? null,
  });
  if (error) {
    logger.warn('devices', 'revoke_device failed', { message: error.message });
    return { error: friendlyDeviceActionError(error.message) };
  }
  return { error: null };
}

export type SecurityEventRecord = {
  id: string;
  userId: string | null;
  userEmail: string | null;
  eventType: string;
  createdAt: string;
};

type RawSecurityEventRow = {
  id: string;
  user_id: string | null;
  event_type: string;
  created_at: string;
  profiles: { email: string } | { email: string }[] | null;
};

const SECURITY_EVENT_LIMIT = 50;

/**
 * The most recent security events for the caller's organization. RLS
 * (migration 0022) already restricts this to org_admin -- a non-admin
 * calling this simply gets an empty list back, not an error, so the
 * screen below only bothers rendering this section for an admin in the
 * first place.
 */
export async function fetchSecurityEvents(): Promise<{
  events: SecurityEventRecord[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('security_events')
    .select('id, user_id, event_type, created_at, profiles(email)')
    .order('created_at', { ascending: false })
    .limit(SECURITY_EVENT_LIMIT);

  if (error) {
    logger.error('devices', 'Failed to load security events', error);
    return { events: [], error: 'Could not load security events.' };
  }
  return {
    events: ((data as unknown as RawSecurityEventRow[] | null) ?? []).map((row) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        id: row.id,
        userId: row.user_id,
        userEmail: profile?.email ?? null,
        eventType: row.event_type,
        createdAt: row.created_at,
      };
    }),
    error: null,
  };
}
