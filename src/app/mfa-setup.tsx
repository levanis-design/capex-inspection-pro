import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { useAuth } from '@/lib/auth-context';
import { startTotpEnrollment, verifyTotpEnrollment } from '@/lib/mfa';
import { colors, spacing, typography } from '@/theme';

/**
 * Mandatory two-factor setup for an org_admin who hasn't enrolled yet
 * (PRODUCT_SPEC.md section 3.6: "administrator MFA required"). Routed to
 * automatically by src/app/_layout.tsx whenever `mfaStatus === 'setup_required'`
 * -- there is no skip button, matching this being an MVP security
 * requirement rather than a suggestion. The only way out without
 * finishing setup is signing out.
 *
 * Shows the enrollment secret as plain text for manual entry rather than
 * a QR code -- see src/lib/mfa.ts's header comment for why.
 */
export default function MfaSetupScreen() {
  const { signOut, refreshMfaStatus } = useAuth();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    let isMounted = true;
    startTotpEnrollment().then((result) => {
      if (!isMounted) return;
      if (result.error) {
        setStartError(result.error);
        return;
      }
      setFactorId(result.factorId);
      setSecret(result.secret);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  async function handleVerify() {
    if (!factorId) return;
    setVerifyError(null);
    if (!code.trim()) {
      setVerifyError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setIsVerifying(true);
    const { error } = await verifyTotpEnrollment(factorId, code.trim());
    setIsVerifying(false);
    if (error) {
      setVerifyError(error);
      return;
    }
    await refreshMfaStatus();
  }

  return (
    <Screen>
      <View style={styles.content}>
        <Text style={typography.screenTitle}>Set up two-factor authentication</Text>
        <Text style={[typography.body, styles.subtitle]}>
          As an organization admin, a second sign-in factor is required before you can continue.
        </Text>

        {startError ? (
          <Text style={[typography.body, styles.errorText]}>{startError}</Text>
        ) : !secret ? (
          <Text style={typography.body}>Preparing setup…</Text>
        ) : (
          <>
            <View style={styles.instructions}>
              <Text style={typography.label}>1. Open your authenticator app</Text>
              <Text style={typography.caption}>
                Google Authenticator, Authy, 1Password, or any other TOTP app.
              </Text>
              <Text style={[typography.label, styles.instructionSpacer]}>
                2. Add a new account manually, using this key
              </Text>
              <View style={styles.secretBox}>
                <Text style={styles.secretText} selectable>
                  {secret}
                </Text>
              </View>
              <Text style={[typography.label, styles.instructionSpacer]}>
                3. Enter the 6-digit code it shows
              </Text>
            </View>

            <TextField
              label="6-digit code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
            />

            {verifyError ? (
              <Text style={[typography.body, styles.errorText]}>{verifyError}</Text>
            ) : null}

            <Button label="Verify & finish setup" onPress={handleVerify} loading={isVerifying} />
          </>
        )}

        <View style={styles.signOut}>
          <Button
            label="Sign out instead"
            variant="secondary"
            onPress={() => signOut({ force: true })}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  subtitle: {
    color: colors.textSecondary,
    marginTop: -spacing.md,
  },
  instructions: {
    gap: spacing.xs,
  },
  instructionSpacer: {
    marginTop: spacing.md,
  },
  secretBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
  },
  secretText: {
    ...typography.bodyStrong,
    letterSpacing: 2,
  },
  errorText: {
    color: colors.danger,
  },
  signOut: {
    marginTop: spacing.xl,
  },
});
