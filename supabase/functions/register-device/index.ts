// Phase 10: device registration (PRODUCT_SPEC.md section 3.2,
// DATABASE_SCHEMA.md's "Device registration/replacement" design). Deploy
// this via the Supabase Dashboard's Edge Functions editor (Functions ->
// Deploy a new function -> paste this file as index.ts) rather than the
// CLI, per the same "avoid a Docker/CLI dependency" decision already
// made for migrations back in Phase 2 -- see CHANGELOG.md's Phase 10
// entry.
//
// Required project secrets (Dashboard -> Edge Functions -> this
// function -> Secrets, or project-wide secrets -- SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are already provided automatically by the
// platform to every Edge Function, so only this one needs to be added):
//   DEVICE_HMAC_SECRET       -- a long random string. Generate one with
//                               e.g. `openssl rand -hex 32` and never
//                               reuse it anywhere else. Rotating it later
//                               invalidates every previously-registered
//                               device's fingerprint match (they'd all
//                               look like "new" devices on next sign-in)
//                               -- fine operationally (the automatic
//                               replace-on-sign-in flow just runs for
//                               everyone once), but don't rotate it
//                               casually.
//
// Optional:
//   PLAY_INTEGRITY_MODE      -- 'bypass' (default if unset) or 'enforce'.
//                               See verifyPlayIntegrity()'s comment below
//                               for why this ships in 'bypass' mode and
//                               what has to be true before flipping it.
//
// This function deliberately does NOT verify a real Play Integrity
// token yet -- see verifyPlayIntegrity() below. Everything else here
// (JWT verification, HMAC fingerprinting, the transactional
// register_or_replace_device() call) is the real, final implementation.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'not_authenticated' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const hmacSecret = Deno.env.get('DEVICE_HMAC_SECRET');
    const playIntegrityMode = Deno.env.get('PLAY_INTEGRITY_MODE') ?? 'bypass';

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error('register-device: missing platform-provided Supabase env vars');
      return json({ error: 'server_misconfigured' }, 500);
    }
    if (!hmacSecret) {
      console.error('register-device: DEVICE_HMAC_SECRET is not set');
      return json({ error: 'server_misconfigured' }, 500);
    }

    let body: { appScopedId?: unknown; playIntegrityToken?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid_arguments' }, 400);
    }
    const appScopedId = body.appScopedId;
    const playIntegrityToken =
      typeof body.playIntegrityToken === 'string' ? body.playIntegrityToken : null;
    if (!appScopedId || typeof appScopedId !== 'string') {
      return json({ error: 'invalid_arguments' }, 400);
    }

    // Verify the caller's own identity using their JWT -- a plain anon-key
    // client with their Authorization header forwarded, never trusted
    // from an unauthenticated request.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: 'not_authenticated' }, 401);
    }

    // Service-role client for everything past this point -- looking up
    // the caller's organization and calling the SECURITY DEFINER
    // transaction function, both of which are intentionally locked out
    // for the plain `authenticated` role (see migration 0022).
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile, error: profileError } = await serviceClient
      .from('profiles')
      .select('organization_id')
      .eq('id', userData.user.id)
      .single();
    if (profileError || !profile) {
      return json({ error: 'profile_not_found' }, 404);
    }

    const verdict = await verifyPlayIntegrity(playIntegrityToken, playIntegrityMode);
    if (!verdict.accepted) {
      await serviceClient.from('security_events').insert({
        organization_id: profile.organization_id,
        user_id: userData.user.id,
        event_type: 'play_integrity_rejected',
        metadata: verdict.record,
      });
      return json({ error: 'play_integrity_rejected' }, 403);
    }

    const fingerprintHash = await hmacSha256Hex(appScopedId, hmacSecret);

    const { data: device, error: registerError } = await serviceClient.rpc(
      'register_or_replace_device',
      {
        p_organization_id: profile.organization_id,
        p_user_id: userData.user.id,
        p_fingerprint_hash: fingerprintHash,
        p_play_integrity_verdict: verdict.record,
      },
    );

    if (registerError) {
      const message = registerError.message ?? '';
      if (message.includes('device_slot_limit_reached')) {
        return json({ error: 'device_slot_limit_reached' }, 409);
      }
      console.error('register-device: register_or_replace_device failed', registerError);
      return json({ error: 'registration_failed' }, 500);
    }

    return json({ device }, 200);
  } catch (error) {
    console.error('register-device: unexpected error', error);
    return json({ error: 'unexpected_error' }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Play Integrity verification -- BYPASSED for now. See this project's
 * CHANGELOG.md Phase 10 entry and PRODUCT_SPEC.md section 3.2 for the
 * full reasoning; short version: getting a real integrity token requires
 * the native `com.google.android.play:integrity` library, which this
 * Expo-managed-workflow app can't call without a custom dev client, and
 * verifying one server-side requires a Google Cloud project linked to
 * the Play Console app -- neither exists yet (PRODUCT_SPEC.md's own
 * decision log deferred that linkage to "Phase 12 lead-up").
 *
 * In 'bypass' mode (the default), every registration is accepted, and the
 * verdict record honestly says so (`bypassed: true`) rather than
 * fabricating a fake "verified" result -- so `devices.play_integrity_verdict`
 * always tells the truth about whether a real check ever happened for
 * that row.
 *
 * Once the Play Console/Google Cloud linkage exists, replace this
 * function's body with a real call to
 * `https://playintegrity.googleapis.com/v1/{packageName}:decodeIntegrityToken`
 * (using a service-account credential, not the DEVICE_HMAC_SECRET), and
 * set the PLAY_INTEGRITY_MODE secret to 'enforce'. 'enforce' mode below
 * fails closed (rejects everything) rather than silently keep bypassing,
 * specifically so flipping the env var without also shipping the real
 * implementation is loud and obvious instead of quietly doing nothing.
 */
async function verifyPlayIntegrity(
  token: string | null,
  mode: string,
): Promise<{ accepted: boolean; record: Record<string, unknown> }> {
  if (mode === 'enforce') {
    return {
      accepted: false,
      record: {
        bypassed: false,
        rejected_reason: 'enforce_mode_not_implemented',
        checked_at: new Date().toISOString(),
      },
    };
  }
  return {
    accepted: true,
    record: {
      bypassed: true,
      reason: 'play_console_not_linked_yet',
      client_supplied_token_present: Boolean(token),
      checked_at: new Date().toISOString(),
    },
  };
}

async function hmacSha256Hex(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
