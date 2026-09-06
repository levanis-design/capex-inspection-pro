import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { useAuth } from '@/lib/auth-context';
import { colors, spacing, typography } from '@/theme';

export default function SignInScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (!email || !password) {
      setError('Enter your email and password.');
      return;
    }
    setIsSubmitting(true);
    const { error: signInError } = await signIn(email.trim(), password);
    setIsSubmitting(false);
    if (signInError) {
      setError(signInError);
    }
    // On success, the root layout's Stack.Protected guard reacts to the
    // new session automatically and navigates into the (app) group —
    // there's no manual router.replace() needed here.
  }

  return (
    <Screen>
      <View style={styles.form}>
        <Text style={typography.screenTitle}>Capex Inspection Pro</Text>
        <Text style={[typography.body, styles.subtitle]}>Sign in to your organization</Text>

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
          autoComplete="password"
          textContentType="password"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button label="Sign in" onPress={handleSubmit} loading={isSubmitting} />

        <Link href="/(auth)/sign-up" style={styles.link}>
          <Text style={typography.body}>
            New here? <Text style={styles.linkText}>Create an organization</Text>
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
