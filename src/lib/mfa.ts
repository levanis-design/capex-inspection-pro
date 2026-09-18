import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

/**
 * Phase 10: MFA enrollment/challenge (PRODUCT_SPEC.md section 3.6:
 * "administrator (org_admin) MFA required"). Built entirely on Supabase
 * Auth's own built-in TOTP support (`supabase.auth.mfa.*`) -- no custom
 * backend code needed for MFA itself, unlike device registration.
 *
 * Important distinction, so this doesn't get mistaken for the actual
 * security boundary: the real second-factor guarantee is Supabase Auth's
 * own Authenticator Assurance Level (AAL) on the session's JWT --
 * `getAuthenticatorAssuranceLevel()` below reads that directly. This
 * module's `log_mfa_enrolled()` RPC call and `profiles.mfa_enrolled`
 * column are just this app's own bookkeeping (so the app knows to show
 * the mandatory setup screen, and so the Devices & Security screen has
 * something to display) -- they mirror a fact Supabase Auth already
 * established, they don't create it.
 *
 * QR-code enrollment is deliberately not offered -- Supabase returns the
 * QR as an SVG string, and rendering that in React Native needs either
 * react-native-svg or a WebView, a new dependency for one screen. Manual
 * secret entry (which every TOTP app supports as a fallback anyway) is
 * simpler and dependency-free, so that's the only path built here. Worth
 * revisiting if a QR flow turns out to matter more than expected.
 */

export type MfaStatus =
  | 'unknown'
  | 'challenge_required' // returning session, factor enrolled, AAL2 not yet reached this session
  | 'setup_required' // org_admin, no verified factor yet
  | 'satisfied';

/**
 * Determines what (if anything) must happen before this session counts
 * as fully authenticated. Called by auth-context.tsx whenever the
 * session changes, and again after a challenge/enrollment completes.
 */
export async function resolveMfaStatus(): Promise<MfaStatus> {
  const { data: aalData, error: aalError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError) {
    logger.error('mfa', 'Failed to read authenticator assurance level', aalError);
    return 'unknown';
  }
  if (aalData.nextLevel === 'aal2' && aalData.currentLevel !== 'aal2') {
    return 'challenge_required';
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userError || !userId) {
    logger.error('mfa', 'Failed to load current user for MFA gating', userError);
    return 'unknown';
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, mfa_enrolled')
    .eq('id', userId)
    .single();
  if (profileError || !profile) {
    logger.error('mfa', 'Failed to load profile for MFA gating', profileError);
    return 'unknown';
  }

  if (profile.role === 'org_admin' && !profile.mfa_enrolled) {
    return 'setup_required';
  }
  return 'satisfied';
}

export type EnrollmentStart = {
  factorId: string | null;
  secret: string | null;
  error: string | null;
};

/** Starts TOTP enrollment. Returns the manual-entry secret for the user's authenticator app. */
export async function startTotpEnrollment(): Promise<EnrollmentStart> {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
  if (error || !data) {
    logger.error('mfa', 'Failed to start TOTP enrollment', error);
    return { factorId: null, secret: null, error: error?.message ?? 'Could not start setup.' };
  }
  return { factorId: data.id, secret: data.totp.secret, error: null };
}

/** Verifies the 6-digit code from the authenticator app and finalizes enrollment. */
export async function verifyTotpEnrollment(
  factorId: string,
  code: string,
): Promise<{ error: string | null }> {
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (challengeError || !challenge) {
    logger.error('mfa', 'Failed to start enrollment challenge', challengeError);
    return { error: challengeError?.message ?? 'Could not verify that code.' };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) {
    return { error: verifyError.message };
  }

  const { error: recordError } = await supabase.rpc('log_mfa_enrolled');
  if (recordError) {
    // The factor is genuinely enrolled at this point (Supabase Auth
    // already confirmed it) -- this is just our own bookkeeping failing
    // to record, not the enrollment itself. Logged, not surfaced as an
    // error to the user, since asking them to "try enrolling again"
    // would be misleading.
    logger.error('mfa', 'Enrolled but failed to record mfa_enrolled', recordError);
  }

  return { error: null };
}

/**
 * Completes an AAL2 challenge for a factor enrolled in an earlier
 * session (the ordinary sign-in case for an admin who already set up
 * MFA). Cancelling out of this leaves the session at AAL1, so
 * mfaStatus stays 'challenge_required' -- there's no way to reach the
 * app without completing it.
 */
export async function challengeExistingFactor(code: string): Promise<{ error: string | null }> {
  const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError || !factorsData) {
    logger.error('mfa', 'Failed to list factors for challenge', factorsError);
    return { error: factorsError?.message ?? 'Could not load your two-factor method.' };
  }
  const factor = factorsData.totp.find((f) => f.status === 'verified');
  if (!factor) {
    return { error: 'No verified two-factor method found on this account.' };
  }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: factor.id,
  });
  if (challengeError || !challenge) {
    logger.error('mfa', 'Failed to start sign-in challenge', challengeError);
    return { error: challengeError?.message ?? 'Could not verify that code.' };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code,
  });
  if (verifyError) {
    return { error: verifyError.message };
  }
  return { error: null };
}
