import { useEffect, useState } from 'react';

import * as Network from 'expo-network';

/**
 * Thin wrapper around `expo-network` -- chosen over the community
 * `@react-native-community/netinfo` package specifically because it's an
 * official `expo-*` module, so it's guaranteed to work in Expo Go without
 * any native linking step, consistent with every other dependency this
 * project has added (see local-crypto.ts's header comment for the same
 * reasoning applied to encryption).
 */

export type ConnectivityState = {
  isOnline: boolean;
};

function toConnectivityState(state: Network.NetworkState): ConnectivityState {
  // `isInternetReachable` is the stronger signal (confirmed internet
  // access, not just an active radio/link per expo-network's own docs),
  // but it can briefly read `undefined` right after a change before the
  // OS finishes probing -- fall back to `isConnected` rather than
  // treating that transient `undefined` as offline.
  const isOnline = state.isInternetReachable ?? state.isConnected ?? false;
  return { isOnline };
}

/**
 * React hook for the current connectivity state, updating live as the
 * device's network changes. Used by the walkthrough screen's
 * online/offline indicator and by the sync engine to know when it's safe
 * to attempt a drain.
 */
export function useConnectivity(): ConnectivityState {
  const [state, setState] = useState<ConnectivityState>({ isOnline: true });

  useEffect(() => {
    let isMounted = true;

    Network.getNetworkStateAsync().then((networkState) => {
      if (isMounted) setState(toConnectivityState(networkState));
    });

    const subscription = Network.addNetworkStateListener((networkState) => {
      setState(toConnectivityState(networkState));
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  return state;
}

/** One-shot connectivity check, for call sites outside a component (e.g. the sync engine's retry loop). */
export async function isCurrentlyOnline(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync();
  return toConnectivityState(state).isOnline;
}
