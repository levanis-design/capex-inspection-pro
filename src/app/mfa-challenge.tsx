import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { useAuth } from '@/lib/auth-context';
import { challengeExistingFactor } from '@/lib/mfa';
import { colors, spacing, typography } from '@/theme';

/**
 * Second-factor challenge for a returning admin who already enrolled MFA
 * in an earlier session. Routed to by src/app/_layout.tsx whenever
 * `mfaStatus === 'challenge_required'` -- i.e. a session exists at AAL1
 * but the account has a verified TOTP factor, so AAL2 is required before
 * this counts as a complete sign-in (PRODUCT_SPEC.md section 3.3).
 */
export default function MfaChallengeScreen() {
  const { signOut, refreshMfaStatus } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  async function handleVerify() {
    setError(null);
    if (!code.trim()) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setIsVerifying(true);
    const { error: verifyError } = await challengeExistingFactor(code.trim());
    setIsVerifying(false);
    if (verifyError) {
      setError(verifyError);
      return;
    }
    await refreshMfaStatus();
  }

  return (
    <Screen>
      <View style={styles.content}>
        <Text style={typography.screenTitle}>Enter your two-factor code</Text>
        <Text style={[typography.body, styles.subtitle]}>
          Open your authenticator app and enter the current 6-digit code.
        </Text>

        <TextField
          label="6-digit code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={6}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
        />

        {error ? <Text style={[typography.body, styles.errorText]}>{error}</Text> : null}

        <Button label="Verify" onPress={handleVerify} loading={isVerifying} />

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
  errorText: {
    color: colors.danger,
  },
  signOut: {
    marginTop: spacing.xl,
  },
});
