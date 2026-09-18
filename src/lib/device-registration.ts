import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

/**
 * Phase 10: device registration (PRODUCT_SPEC.md section 3.2,
 * supabase/functions/register-device). This module owns exactly the
 * client-side half of that design: generating/persisting the app-scoped
 * identifier and calling the Edge Function. Everything else (HMAC
 * fingerprinting, the transactional register-or-replace logic, the
 * Play-Integrity-bypass note) lives server-side -- see that function's
 * header comment for the full picture, including why Play Integrity
 * itself isn't real yet.
 *
 * The app-scoped identifier is intentionally just a random UUID generated
 * once and stored in `expo-secure-store` -- not a hardware identifier of
 * any kind. Uninstalling the app clears SecureStore, so a fresh install
 * always gets a new id, which is exactly the "resets on uninstall/
 * reinstall by design" property PRODUCT_SPEC.md section 3.2 calls for.
 * The server never sees this raw value stored anywhere -- it's HMAC'd
 * immediately and only the digest (`fingerprint_hash`) is persisted.
 *
 * Phase 17 addition: `checkThisDeviceRevoked()` below, plus persisting
 * the server-assigned `devices.id` locally so that check has something
 * to ask about -- see that function's own comment and migration 0027's
 * header comment for the full "why this, and why not more" reasoning.
 */

const APP_SCOPED_ID_KEY = 'device_app_scoped_id_v1';

// Phase 17 addition: the server-side `devices.id` this app-scoped
// identifier last registered as. Not used for the fingerprint itself
// (that's still purely appScopedId, HMAC'd server-side) -- this is just
// so the app can later ask "is *this* device row still active?" without
// having to look it up by fingerprint. See checkThisDeviceRevoked() below.
const DEVICE_ROW_ID_KEY = 'device_row_id_v1';

async function getOrCreateAppScopedId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(APP_SCOPED_ID_KEY);
  if (existing) return existing;
  const fresh = Crypto.randomUUID();
  await SecureStore.setItemAsync(APP_SCOPED_ID_KEY, fresh);
  return fresh;
}

const DEVICE_ERROR_MESSAGES: Record<string, string> = {
  device_slot_limit_reached:
    'This organization has reached its device limit for its current plan. Contact your organization admin, or free a slot by revoking an old device under Settings → Devices & Security.',
  play_integrity_rejected: 'This device failed an integrity check and cannot be registered.',
  not_authenticated: 'We could not confirm your account. Try signing out and back in.',
  profile_not_found: 'We could not find your organization. Try signing out and back in.',
  server_misconfigured: 'Device registration is temporarily unavailable. Please try again later.',
  // Phase 22 addition -- see the malformed-response guard in
  // registerThisDevice() below.
  malformed_response: 'Device registration is temporarily unavailable. Please try again later.',
};

function friendlyDeviceError(rawMessage: string): string {
  for (const code of Object.keys(DEVICE_ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return DEVICE_ERROR_MESSAGES[code];
  }
  return 'Could not register this device. Please try again.';
}

export type DeviceRegistrationResult = { error: string | null };

/**
 * Registers (or, for a returning user on a new install/phone, silently
 * replaces) this device. Called once per fully-authenticated session --
 * see src/lib/auth-context.tsx -- after any required MFA challenge has
 * already been completed, per PRODUCT_SPEC.md section 3.3's "a normal
 * successful sign-in, plus MFA if enrolled, is treated as sufficient
 * re-verification" for this exact flow.
 *
 * `playIntegrityToken` is always sent as `null` for now -- obtaining a
 * real one requires the native Play Integrity Android library, which
 * isn't available from Expo Go / this project's plain managed workflow.
 * The Edge Function's bypass mode accepts a null token and records that
 * fact honestly in the stored verdict rather than pretending otherwise.
 */
export async function registerThisDevice(): Promise<DeviceRegistrationResult> {
  try {
    const appScopedId = await getOrCreateAppScopedId();
    const { data, error } = await supabase.functions.invoke('register-device', {
      body: { appScopedId, playIntegrityToken: null },
    });

    if (error) {
      logger.error('device-registration', 'register-device call failed', error);
      return { error: friendlyDeviceError(error.message ?? '') };
    }
    if (data?.error) {
      logger.warn('device-registration', 'register-device rejected', { code: data.error });
      return { error: friendlyDeviceError(data.error) };
    }

    const deviceId = data?.device?.id;
    // Phase 22 fix: neither `error` nor `data?.error` being set used to be
    // treated as unconditional success, even if `data` itself was `null`,
    // `{}`, or otherwise missing a usable `device.id` -- e.g. a
    // misconfigured Edge Function returning its default Supabase
    // boilerplate response. That silently "succeeded" without ever
    // persisting a device row id, so checkThisDeviceRevoked() above would
    // then always fail open (no id to check) for that install. A response
    // this malformed is not a real success, so it's now treated as an
    // error instead of being swallowed.
    if (typeof deviceId !== 'string' || deviceId.length === 0) {
      logger.error('device-registration', 'register-device returned a malformed response', {
        data,
      });
      return { error: friendlyDeviceError('malformed_response') };
    }

    await SecureStore.setItemAsync(DEVICE_ROW_ID_KEY, deviceId);
    return { error: null };
  } catch (error) {
    logger.error('device-registration', 'Unexpected error registering device', error);
    return { error: 'Could not register this device. Please try again.' };
  }
}

/**
 * Phase 17: closes the gap TEST_PLAN.md called out under "Device
 * registration and security" -- "nothing in the app currently checks
 * devices.status before allowing API calls, so a revoked device's
 * existing session keeps working until it naturally expires." This reads
 * the caller's own device row (already selectable per migration 0022's
 * `devices_select_own_or_admin` policy -- no new grant needed) and
 * reports whether it's been revoked.
 *
 * Deliberately fails "open" (returns false) on any error or missing
 * local device id -- this is a client-side belt on top of the real
 * role/RLS security boundary (see migration 0027's header comment), not
 * itself the security boundary, so a transient network hiccup here
 * should never be what signs someone out. Callers (the periodic
 * foreground check in (app)/_layout.tsx, and the top of every sync
 * attempt in offline-sync.ts) both treat `true` as "sign out now."
 */
export async function checkThisDeviceRevoked(): Promise<boolean> {
  try {
    const deviceId = await SecureStore.getItemAsync(DEVICE_ROW_ID_KEY);
    if (!deviceId) return false;

    const { data, error } = await supabase
      .from('devices')
      .select('status')
      .eq('id', deviceId)
      .maybeSingle();

    if (error) {
      logger.warn('device-registration', "Could not check this device's status", {
        message: error.message,
      });
      return false;
    }
    if (!data) return false;

    return data.status === 'revoked';
  } catch (error) {
    logger.error('device-registration', 'Unexpected error checking device status', error);
    return false;
  }
}
