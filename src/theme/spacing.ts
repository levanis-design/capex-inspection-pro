/**
 * A single spacing scale keeps layout consistent and makes touch targets
 * predictable across screens. Values are in density-independent pixels.
 *
 * PRODUCT_SPEC.md requires large touch targets for field use — `touchTarget`
 * below is the minimum tappable size for any interactive element (buttons,
 * checklist status controls, list rows), meeting common accessibility
 * guidance for gloved/one-handed field use.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const touchTarget = {
  minHeight: 48,
  minWidth: 48,
} as const;
