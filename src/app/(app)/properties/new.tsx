import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { colors, spacing, typography } from '@/theme';

// Maps the exception codes raised by create_property() (see
// supabase/migrations/0003_properties.sql) to messages a non-technical
// user can act on. Postgrest surfaces the raised message as-is, so we
// match on substring rather than requiring an exact string.
const ERROR_MESSAGES: Record<string, string> = {
  property_slot_limit_reached:
    "You've reached your plan's property limit. Contact us to add more properties on a paid plan.",
  insufficient_permission: 'Only an organization admin or portfolio manager can add properties.',
  name_required: 'Property name is required.',
  not_authenticated:
    'We could not confirm your account and organization. Try signing out and back in — if this keeps happening, contact support.',
};

function friendlyError(rawMessage: string): string {
  for (const code of Object.keys(ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return ERROR_MESSAGES[code];
  }
  return 'Something went wrong creating the property. Please try again.';
}

/**
 * Create-property form. Only collects the fields useful at setup time —
 * portfolio/facility-contact fields from the schema are left for a later
 * "edit property" screen rather than crowding this one form.
 *
 * All validation that actually matters (the Free-plan property limit,
 * required name, role permission) is enforced server-side by
 * create_property() — this screen's checks are just for fast feedback.
 */
export default function NewPropertyScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (!name.trim()) {
      setError('Property name is required.');
      return;
    }

    setIsSubmitting(true);
    const { error: rpcError } = await supabase.rpc('create_property', {
      p_payload: {
        name: name.trim(),
        street_address: streetAddress.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        zip: zip.trim() || null,
        notes: notes.trim() || null,
      },
    });
    setIsSubmitting(false);

    if (rpcError) {
      logger.warn('properties', 'create_property failed', { message: rpcError.message });
      setError(friendlyError(rpcError.message));
      return;
    }

    router.back();
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={[typography.body, styles.subtitle]}>
          Basic details now — buildings, areas, and components come next once this property is
          created.
        </Text>

        <TextField label="Property name" value={name} onChangeText={setName} autoFocus />
        <TextField label="Street address" value={streetAddress} onChangeText={setStreetAddress} />
        <TextField label="City" value={city} onChangeText={setCity} />
        <TextField
          label="State"
          value={state}
          onChangeText={setState}
          autoCapitalize="characters"
        />
        <TextField label="ZIP" value={zip} onChangeText={setZip} keyboardType="number-pad" />
        <TextField
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
          style={styles.notesInput}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button label="Create property" onPress={handleSubmit} loading={isSubmitting} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  subtitle: {
    color: colors.textSecondary,
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
});
