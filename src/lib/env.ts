/**
 * Centralized, validated access to environment configuration.
 *
 * Expo only exposes variables prefixed with `EXPO_PUBLIC_` to client code,
 * and Metro replaces each `process.env.EXPO_PUBLIC_*` reference statically
 * at build time — which is why each variable is accessed by its literal
 * name below rather than through a dynamic `process.env[name]` lookup
 * (that pattern silently fails to inline in production builds).
 *
 * Nothing secret should ever live behind this prefix — see .env.example
 * for the security note on the Supabase service-role key, which must
 * NEVER be read here or shipped in the app bundle.
 *
 * Failing fast with a clear message beats a confusing runtime error deep
 * inside the Supabase client later.
 */

function requireEnvVar(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". Copy .env.example to .env, ` +
        'fill in your Supabase project values, and restart the Expo dev server ' +
        '(environment variables are only read at startup).',
    );
  }
  return value;
}

export const env = {
  supabaseUrl: requireEnvVar('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: requireEnvVar(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ),
};
