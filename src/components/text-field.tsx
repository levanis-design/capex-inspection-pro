import { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

import { colors, radius, spacing, touchTarget, typography } from '@/theme';

type TextFieldProps = TextInputProps & {
  label: string;
  errorMessage?: string;
};

/**
 * Labeled text input with a consistent error-message slot. Using one
 * component for every text field means validation styling stays
 * consistent instead of being re-implemented per screen.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, errorMessage, style, ...inputProps },
  ref,
) {
  return (
    <View style={styles.container}>
      <Text style={typography.label}>{label}</Text>
      <TextInput
        ref={ref}
        style={[styles.input, errorMessage ? styles.inputError : undefined, style]}
        placeholderTextColor={colors.textDisabled}
        accessibilityLabel={label}
        {...inputProps}
      />
      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  input: {
    ...typography.body,
    minHeight: touchTarget.minHeight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  inputError: {
    borderColor: colors.danger,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
  },
});
