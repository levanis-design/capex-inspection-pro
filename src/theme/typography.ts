import { Platform } from 'react-native';

import { colors } from '@/theme/colors';

/**
 * Type scale for a clear, field-readable hierarchy. Keep the number of
 * distinct styles small and reused everywhere — this is what keeps the
 * app feeling consistent rather than "decorative."
 */

const fontFamily = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

export const typography = {
  screenTitle: {
    fontFamily,
    fontSize: 24,
    fontWeight: '700' as const,
    color: colors.textPrimary,
  },
  sectionTitle: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  body: {
    fontFamily,
    fontSize: 16,
    fontWeight: '400' as const,
    color: colors.textPrimary,
  },
  bodyStrong: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  caption: {
    fontFamily,
    fontSize: 13,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
  label: {
    fontFamily,
    fontSize: 14,
    fontWeight: '600' as const,
    color: colors.textSecondary,
  },
} as const;
