import { PropsWithChildren } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme';

type ScreenProps = PropsWithChildren<{
  style?: ViewStyle;
  /** Turn off the default horizontal padding for screens that need edge-to-edge content (e.g. lists). */
  noPadding?: boolean;
}>;

/**
 * Standard screen wrapper: safe-area aware, consistent background and
 * padding. Every top-level route screen should render its content inside
 * one of these rather than a bare `View`, so spacing stays consistent
 * across the app without every screen re-deriving it.
 */
export function Screen({ children, style, noPadding }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={[styles.content, !noPadding && styles.padded, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: spacing.lg,
  },
});
