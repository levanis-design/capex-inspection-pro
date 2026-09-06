import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { useAuth } from '@/lib/auth-context';
import { colors, spacing, typography } from '@/theme';

/**
 * Phase 2 scope note: this screen creates the Supabase Auth user only.
 * Per PRODUCT_SPEC.md section 4 (self-serve onboarding), signing up should
 * also create a new Free-plan `organizations` row and a matching
 * `profiles` row with role `org_admin`. That step is implemented in
 * Phase 3 as a database trigger/function once the `organizations` and
 * `profiles` tables exist — it is intentionally not wired up yet.
 */
export default function SignUpScreen() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [didSubmit, setDidSubmit] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (!email || !password) {
      setError('Enter an email and password.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setIsSubmitting(true);
    const { error: signUpError } = await signUp(email.trim(), password);
    setIsSubmitting(false);
    if (signUpError) {
      setError(signUpError);
      return;
    }
    setDidSubmit(true);
  }

  if (didSubmit) {
    return (
      <Screen>
        <View style={styles.form}>
          <Text style={typography.screenTitle}>Check your email</Text>
          <Text style={typography.body}>
            We sent a verification link to {email}. Verify your email, then come back and sign in.
          </Text>
          <Link href="/(auth)/sign-in" asChild>
            <Button label="Back to sign in" onPress={() => {}} variant="secondary" />
          </Link>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.form}>
        <Text style={typography.screenTitle}>Create your organization</Text>
        <Text style={[typography.body, styles.subtitle]}>
          Starts on the Free plan: 1 user, 1 property, 1 device.
        </Text>

        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <TextField
          label="Confirm password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button label="Create account" onPress={handleSubmit} loading={isSubmitting} />

        <Link href="/(auth)/sign-in" style={styles.link}>
          <Text style={typography.body}>
            Already have an account? <Text style={styles.linkText}>Sign in</Text>
          </Text>
        </Link>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.lg,
  },
  subtitle: {
    color: colors.textSecondary,
    marginTop: -spacing.md,
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
  link: {
    alignSelf: 'center',
    marginTop: spacing.md,
  },
  linkText: {
    color: colors.slate,
    fontWeight: '700',
  },
});
