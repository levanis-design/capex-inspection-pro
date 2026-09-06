import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';
import { secureStorageAdapter } from '@/lib/secure-storage';

/**
 * The single Supabase client for the app. Import this everywhere instead
 * of calling `createClient` again — one client keeps one auth session and
 * one realtime connection.
 *
 * Only ever use the public anon key here. The service-role key must never
 * appear in app code — see .env.example and PRODUCT_SPEC.md section 3.
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: secureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
