import { Session } from '@supabase/supabase-js';
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';

import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

type AuthContextValue = {
  session: Session | null;
  /** True until the initial session restore from secure storage has resolved. */
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Owns the Supabase auth session for the whole app. Mount this once, at
 * the root layout, above the router.
 *
 * Phase 2 scope: email/password session management only. Phase 3 will
 * extend this (or a sibling provider) to load the signed-in user's
 * `profiles` row — organization, role, plan entitlement — once the
 * database schema from DATABASE_SCHEMA.md exists. Screens should not
 * assume a profile/role is available yet.
 *
 * Device registration (PRODUCT_SPEC.md section 3.2) and MFA enrollment
 * are also not implemented here yet — they land in Phase 2's security
 * follow-up work once the backend Edge Functions exist, and are called
 * out again in Phase 10.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading,
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
      async signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) {
          logger.error('auth', 'Sign-out failed', error);
        }
      },
    }),
    [session, isLoading],
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
