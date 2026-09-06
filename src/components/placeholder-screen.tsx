import { StyleSheet, Text } from 'react-native';

import { Screen } from '@/components/screen';
import { colors, spacing, typography } from '@/theme';

type PlaceholderScreenProps = {
  title: string;
  /** Which phase (from README.md/CHANGELOG.md) builds this screen out. */
  phaseNote: string;
};

/**
 * Temporary content for a tab whose real screen hasn't been built yet.
 * Every usage names the phase that replaces it, so it's obvious from
 * reading the code that this is intentionally unfinished, not a bug.
 */
export function PlaceholderScreen({ title, phaseNote }: PlaceholderScreenProps) {
  return (
    <Screen>
      <Text style={typography.screenTitle}>{title}</Text>
      <Text style={[typography.body, styles.note]}>{phaseNote}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {
    marginTop: spacing.md,
    color: colors.textSecondary,
  },
});
