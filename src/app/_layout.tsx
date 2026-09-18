import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ErrorBoundary } from '@/components/error-boundary';
import { Screen } from '@/components/screen';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { colors, spacing, typography } from '@/theme';

SplashScreen.preventAutoHideAsync();

/** Keeps the native splash screen visible until the auth session restore resolves. */
function SplashScreenController() {
  const { isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  return null;
}

/**
 * Blocking screen for the one case device registration is allowed to
 * interrupt the app (PRODUCT_SPEC.md section 6's "Device registration...
 * blocking error state only if it fails" -- registration itself is
 * otherwise silent and never shown).
 */
function DeviceRegistrationErrorScreen({ error }: { error: string }) {
  const { retryDeviceRegistration, signOut } = useAuth();
  return (
    <Screen>
      <View style={styles.blockingContent}>
        <Text style={typography.screenTitle}>Couldn&apos;t register this device</Text>
        <Text style={[typography.body, styles.errorText]}>{error}</Text>
        <Button label="Try again" onPress={retryDeviceRegistration} />
        <Button label="Sign out" variant="secondary" onPress={() => signOut({ force: true })} />
      </View>
    </Screen>
  );
}

/**
 * Route protection. Four states, most restrictive first:
 *  - no session -> `(auth)` (sign in/up)
 *  - session, but AAL2 required and not yet reached this session ->
 *    `mfa-challenge` (an admin who already enrolled MFA in an earlier
 *    session)
 *  - session, AAL satisfied, but this org_admin has never enrolled MFA ->
 *    `mfa-setup` (mandatory, no skip)
 *  - session fully satisfied -> `(app)`
 * Expo Router redirects automatically whenever `session`/`mfaStatus`
 * changes. Device-registration failure (see `deviceRegistrationError`)
 * is handled separately below, as a blocking overlay rather than a
 * route, since it should never be reachable via back-navigation.
 */
function RootNavigator() {
  const { session, mfaStatus, deviceRegistrationError } = useAuth();

  if (session && mfaStatus === 'satisfied' && deviceRegistrationError) {
    return <DeviceRegistrationErrorScreen error={deviceRegistrationError} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={Boolean(session) && mfaStatus === 'satisfied'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={Boolean(session) && mfaStatus === 'challenge_required'}>
        <Stack.Screen name="mfa-challenge" />
      </Stack.Protected>
      <Stack.Protected guard={Boolean(session) && mfaStatus === 'setup_required'}>
        <Stack.Screen name="mfa-setup" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <SplashScreenController />
        <RootNavigator />
      </AuthProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  blockingContent: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  errorText: {
    color: colors.danger,
  },
});
