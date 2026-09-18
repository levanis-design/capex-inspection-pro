import { useCallback, useEffect, useState } from 'react';

import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

export type CurrentOrganization = {
  role: string;
  organizationName: string;
  planTier: string;
  propertySlotLimit: number;
};

type State = {
  data: CurrentOrganization | null;
  isLoading: boolean;
  error: string | null;
};

const INITIAL_STATE: State = { data: null, isLoading: true, error: null };

/**
 * Pure fetch, no React state — this is what actually talks to Supabase.
 * Keeping it outside the hook means the effect below only ever calls
 * setState from inside a `.then()` continuation (same pattern as
 * auth-context.tsx's session restore), never synchronously in the effect
 * body itself.
 */
async function fetchOrganization(): Promise<State> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userError || !userId) {
    return { data: null, isLoading: false, error: 'Not signed in.' };
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('role, organizations(name, plan_tier, property_slot_limit)')
    .eq('id', userId)
    .single();

  if (error || !data) {
    logger.error('organization', 'Failed to load organization', error);
    return { data: null, isLoading: false, error: 'Could not load organization details.' };
  }

  // Defensive: a to-one relationship normally embeds as a single object,
  // but guard against an array shape too since this query is untyped (no
  // generated Supabase types are wired up yet).
  const row = data as {
    role: string;
    organizations:
      | { name: string; plan_tier: string; property_slot_limit: number }
      | { name: string; plan_tier: string; property_slot_limit: number }[]
      | null;
  };
  const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;

  if (!org) {
    return { data: null, isLoading: false, error: 'Could not load organization details.' };
  }

  return {
    data: {
      role: row.role,
      organizationName: org.name,
      planTier: org.plan_tier,
      propertySlotLimit: org.property_slot_limit,
    },
    isLoading: false,
    error: null,
  };
}

/**
 * Loads the signed-in user's role plus their organization's name and plan
 * limits, via the profiles -> organizations relationship (see migration
 * 0001). Both tables are RLS-scoped to the caller's own org, so this never
 * needs an organization_id passed in explicitly — `profiles.id = auth.uid()`
 * is enough.
 *
 * Used by the Settings screen (org name/plan tier) and the Properties list
 * (property_slot_limit, to show usage and disable "Add" at the limit).
 */
export function useCurrentOrganization() {
  const [state, setState] = useState<State>(INITIAL_STATE);

  useEffect(() => {
    let isMounted = true;

    fetchOrganization().then((result) => {
      if (!isMounted) return;
      setState(result);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    const result = await fetchOrganization();
    setState(result);
  }, []);

  return { ...state, refetch };
}
