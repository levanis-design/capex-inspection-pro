/**
 * The app's color palette, per PRODUCT_SPEC.md's UX requirements:
 * professional, restrained, field-friendly, high contrast, and never
 * relying on color alone to convey status (every status also gets a
 * text/icon label wherever it's used).
 *
 * Import colors from here rather than hard-coding hex values in
 * components — this is the one place branding/contrast adjustments
 * happen later.
 */

export const colors = {
  // Base palette
  slate: '#1E293B', // deep slate blue — primary brand/navigation color
  slateDark: '#0F172A',
  white: '#FFFFFF',
  amber: '#D97706', // warm amber accent

  // Status colors (always paired with a text/icon label, never color alone)
  statusScheduled: '#2563EB', // blue
  statusInProgress: '#D97706', // amber
  statusCritical: '#DC2626', // red — P1 / critical conditions
  statusSatisfactory: '#16A34A', // green — satisfactory / completed
  statusNeutral: '#6B7280', // neutral gray — not applicable / archived

  // Priority colors (P1-P4) — distinct from generic status colors so a
  // finding's priority and an inspection's status are never visually
  // ambiguous with each other
  priorityP1: '#DC2626',
  priorityP2: '#D97706',
  priorityP3: '#2563EB',
  priorityP4: '#6B7280',

  // Surfaces & text
  background: '#F8FAFC',
  surface: '#FFFFFF',
  border: '#E2E8F0',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textInverse: '#FFFFFF',
  textDisabled: '#94A3B8',

  // Semantic aliases used by components
  danger: '#DC2626',
  success: '#16A34A',
  warning: '#D97706',
  info: '#2563EB',
} as const;

export type ColorToken = keyof typeof colors;
