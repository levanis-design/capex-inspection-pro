import { Component, PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { logger } from '@/lib/logger';
import { colors, spacing, typography } from '@/theme';

type ErrorBoundaryState = {
  error: Error | null;
};

/**
 * Catches render-time errors anywhere below it in the tree and shows a
 * recoverable fallback screen instead of a blank crashed app. This
 * matters especially in the field: an inspector mid-inspection should
 * never lose their work to an unhandled render error with no way back.
 *
 * Note: this only catches React render errors, not errors inside async
 * code (network calls, promise rejections) — those are handled at their
 * call sites with try/catch and `logger.error`.
 */
export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    logger.error('error-boundary', 'Unhandled render error', error, {
      componentStack: info.componentStack ?? undefined,
    });
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={typography.sectionTitle}>Something went wrong</Text>
          <Text style={[typography.body, styles.message]}>
            An unexpected error occurred. Your inspection data is saved locally and has not been
            lost. Try again, and if this keeps happening, contact support with a screenshot of this
            screen.
          </Text>
          <Button label="Try again" onPress={this.handleReset} />
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  message: {
    textAlign: 'center',
    color: colors.textSecondary,
  },
});
