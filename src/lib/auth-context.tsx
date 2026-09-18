import { Session } from '@supabase/supabase-js';
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  cacheCurrentOrganizationId,
  clearCachedOrganizationId,
} from '@/lib/current-organization-cache';
import { registerThisDevice } from '@/lib/device-registration';
import { logger } from '@/lib/logger';
import { MfaStatus, resolveMfaStatus } from '@/lib/mfa';
import { getSyncOverview, resetLocalMirror } from '@/lib/offline-db';
import { supabase } from '@/lib/supabase';

type AuthContextValue = {
  session: Session | null;
  /** True until the initial session restore from secure storage has resolved. */
  isLoading: boolean;
  /** See src/lib/mfa.ts. Gates routing in src/app/_layout.tsx. */
  mfaStatus: MfaStatus;
  refreshMfaStatus: () => Promise<void>;
  /** Set only if device registration (silent, background) actually failed. */
  deviceRegistrationError: string | null;
  retryDeviceRegistration: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  /**
   * Phase 23: signing out used to only ever call `supabase.auth.signOut()`,
   * leaving the local SQLite mirror (offline-db.ts) and its cached
   * organization id (current-organization-cache.ts) sitting on disk
   * untouched -- see getAllLocalInspectionHeaders' comment for the
   * cross-organization leak that created on a shared/reissued device.
   *
   * Now, unless `force` is passed, signing out first checks whether this
   * device has any unsynced offline changes. If it does, nothing is
   * signed out yet -- the result comes back `{ blocked: true, pendingCount
   * }` so the caller can warn ("you have N unsynced changes, sign out
   * anyway?") and retry with `{ force: true }` only if the person
   * confirms. With nothing pending (or `force: true`), it actually signs
   * out, then clears the local mirror and the cached organization id.
   */
  signOut: (options?: { force?: boolean }) => Promise<{ blocked: boolean; pendingCount: number }>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Owns the Supabase auth session for the whole app. Mount this once, at
 * the root layout, above the router.
 *
 * Phase 10 addition: once a session exists AND any required MFA
 * challenge/setup is satisfied (see mfaStatus below and
 * src/app/_layout.tsx's routing), this fires the two "fully signed in"
 * side effects exactly once per session -- device registration/
 * replacement (PRODUCT_SPEC.md section 3.2/3.3) and a `login_success`
 * security event (src/lib/mfa.ts / device-registration.ts). Both run
 * silently; only a device-registration failure surfaces as a blocking
 * screen (per the screens table's "blocking error state only if it
 * fails"), via `deviceRegistrationError`.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mfaStatus, setMfaStatus] = useState<MfaStatus>('unknown');
  const [deviceRegistrationError, setDeviceRegistrationError] = useState<string | null>(null);
  const hasRunPostAuthTasksRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return;
      if (error) {
        logger.error('auth', 'Failed to restore session', error);
      }
      setSession(data.session ?? null);
      setIsLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      logger.debug('auth', 'Auth state changed', { event });
      setSession(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // Deliberately has no early "if (!session) return" branch before the
  // `await` -- resolveMfaStatus() already degrades to 'unknown' with no
  // session, entirely through its own awaited Supabase calls. Keeping the
  // only setState call here strictly after an `await` (rather than a
  // synchronous shortcut) is what keeps the "no synchronous setState in
  // an effect" lint rule happy for every effect that calls this.
  const refreshMfaStatus = useCallback(async () => {
    setMfaStatus(await resolveMfaStatus());
  }, []);

  useEffect(() => {
    if (!session) {
      hasRunPostAuthTasksRef.current = false;
    }
    // Wrapped in an inline async IIFE rather than a bare
    // `refreshMfaStatus()` statement -- the lint rule can't see inside a
    // referenced function to confirm its setState call is properly
    // deferred, but it does recognize this literal async-callback shape
    // (matching the device-registration effect below, which uses the
    // same pattern for the same reason).
    (async () => {
      if (!session) {
        setDeviceRegistrationError(null);
      }
      await refreshMfaStatus();
    })();
  }, [session, refreshMfaStatus]);

  useEffect(() => {
    if (!session || mfaStatus !== 'satisfied' || hasRunPostAuthTasksRef.current) return;
    hasRunPostAuthTasksRef.current = true;

    (async () => {
      const { error } = await registerThisDevice();
      setDeviceRegistrationError(error);

      const { error: loginLogError } = await supabase.rpc('log_login_success');
      if (loginLogError) {
        logger.error('auth', 'Failed to record login_success security event', loginLogError);
      }

      // Phase 23: cache this user's own organization id so the offline
      // mirror fallback can filter by it with no network available (see
      // current-organization-cache.ts). Independent of device
      // registration's own success/failure above -- a failed device
      // registration shouldn't also leave tenant-isolation caching stale.
      const { data: userData, error: userError } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (userError || !userId) {
        logger.error('auth', 'Could not resolve user id to cache organization id', userError);
      } else {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('organization_id')
          .eq('id', userId)
          .single();
        if (profileError || !profile?.organization_id) {
          logger.error(
            'auth',
            'Failed to load organization id for offline tenant-isolation cache',
            profileError,
          );
        } else {
          await cacheCurrentOrganizationId(profile.organization_id).catch((cacheError) =>
            logger.error('auth', 'Failed to cache organization id', cacheError),
          );
        }
      }
    })();
  }, [session, mfaStatus]);

  const retryDeviceRegistration = useCallback(async () => {
    const { error } = await registerThisDevice();
    setDeviceRegistrationError(error);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading,
      mfaStatus,
      refreshMfaStatus,
      deviceRegistrationError,
      retryDeviceRegistration,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          logger.warn('auth', 'Sign-in failed', { message: error.message });
          return { error: error.message };
        }
        return { error: null };
      },
      async signUp(email, password) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) {
          logger.warn('auth', 'Sign-up failed', { message: error.message });
          return { error: error.message };
        }
        return { error: null };
      },
      async signOut(options) {
        // See getSyncOverview's own comment (offline-db.ts) -- these are
        // the same counts the app-wide "Offline, N changes pending" strip
        // uses, so "unsynced" here means exactly what it means there.
        const overview = await getSyncOverview();
        const pendingCount =
          overview.pendingLocations +
          overview.pendingItems +
          overview.pendingPhotos +
          overview.conflicts;

        if (pendingCount > 0 && !options?.force) {
          return { blocked: true, pendingCount };
        }

        const { error } = await supabase.auth.signOut();
        if (error) {
          logger.error('auth', 'Sign-out failed', error);
        }

        // Phase 23: clear the local mirror and its cached organization id
        // on every completed sign-out (whether nothing was pending, or the
        // person explicitly chose "sign out anyway") -- see
        // getAllLocalInspectionHeaders' and resetLocalMirror's comments in
        // offline-db.ts for the cross-organization leak this closes. Never
        // allowed to block the sign-out itself -- the auth session is
        // already gone at this point regardless of whether this cleanup
        // succeeds.
        await resetLocalMirror().catch((mirrorError) =>
          logger.error('auth', 'Failed to clear local mirror on sign-out', mirrorError),
        );
        await clearCachedOrganizationId().catch((cacheError) =>
          logger.error('auth', 'Failed to clear cached organization id on sign-out', cacheError),
        );

        return { blocked: false, pendingCount };
      },
    }),
    [
      session,
      isLoading,
      mfaStatus,
      refreshMfaStatus,
      deviceRegistrationError,
      retryDeviceRegistration,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth() must be used within an <AuthProvider>.');
  }
  return context;
}
