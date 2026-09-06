/**
 * A single, small logging wrapper so the rest of the app never calls
 * `console.*` directly. That gives us one place to:
 *  - silence debug-level noise in production builds
 *  - later swap in a remote crash/log reporting service (e.g. Sentry)
 *    without touching every call site
 *  - avoid ever accidentally logging secrets (raw device identifiers,
 *    tokens, passwords) — see the `redact` helper below
 *
 * This is intentionally minimal for Phase 2. It gets a remote sink wired
 * up in a later phase once we've chosen a provider.
 */

type LogContext = Record<string, unknown> | undefined;

const isDev = __DEV__;

function format(scope: string, message: string, context: LogContext) {
  const time = new Date().toISOString();
  return context
    ? ([`[${time}] [${scope}] ${message}`, context] as const)
    : ([`[${time}] [${scope}] ${message}`] as const);
}

export const logger = {
  debug(scope: string, message: string, context?: LogContext) {
    if (!isDev) return;
    console.debug(...format(scope, message, context));
  },
  info(scope: string, message: string, context?: LogContext) {
    console.info(...format(scope, message, context));
  },
  warn(scope: string, message: string, context?: LogContext) {
    console.warn(...format(scope, message, context));
  },
  error(scope: string, message: string, error?: unknown, context?: LogContext) {
    console.error(...format(scope, message, context), error);
  },
};

/**
 * Strips known-sensitive keys before logging an object. Use this on
 * anything that might contain a token, password, or device identifier
 * before it ever reaches `logger.*`. Security events and audit entries
 * must never contain raw secrets, per PRODUCT_SPEC.md section 3.
 */
export function redact<T extends Record<string, unknown>>(
  value: T,
  sensitiveKeys: string[] = ['password', 'token', 'accessToken', 'refreshToken', 'fingerprint'],
): T {
  const clone: Record<string, unknown> = { ...value };
  for (const key of sensitiveKeys) {
    if (key in clone) clone[key] = '[redacted]';
  }
  return clone as T;
}
