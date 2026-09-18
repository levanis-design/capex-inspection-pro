import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { logger } from '@/lib/logger';

/**
 * A Supabase-compatible storage adapter backed entirely by
 * `expo-secure-store` (iOS Keychain / Android Keystore), so auth session
 * tokens never touch plain-file storage (e.g. AsyncStorage) — this is the
 * "secure token storage" requirement from PRODUCT_SPEC.md section 3.6.
 *
 * `expo-secure-store` limits each item to ~2KB on some Android versions,
 * but a Supabase session (access token + refresh token + user metadata)
 * can exceed that. This adapter transparently chunks large values across
 * multiple SecureStore entries so the size limit is invisible to callers.
 *
 * `expo-secure-store` has NO web implementation at all (its web build is
 * a literal `{}` — see `expo-secure-store/src/ExpoSecureStore.web.ts`), so
 * every `SecureStore.*Async` call on web throws
 * `TypeError: ExpoSecureStore.default.getValueWithKeyAsync is not a
 * function`. That's expected there, not a bug, since this app's shipped
 * target is mobile (web only ever comes up as an Expo dev-server preview).
 * We defensively treat any platform where the native module isn't wired up
 * the same way, so a stray native-linking issue degrades gracefully instead
 * of spamming errors on a ~30s timer (Supabase's auth auto-refresh tick).
 * In that case we fall back to an in-memory, non-persistent store: sessions
 * won't survive a full reload there, but we deliberately do NOT fall back to
 * something like `localStorage`, since that would silently weaken the
 * "secure storage only" contract this adapter exists to guarantee.
 */

const CHUNK_SIZE = 1800; // stays comfortably under the ~2048 byte Android limit
const CHUNK_COUNT_SUFFIX = '__chunks';

function chunkKey(key: string, index: number) {
  return `${key}__${index}`;
}

// Cache the availability check (it's async and never changes at runtime).
let availabilityCheck: Promise<boolean> | null = null;
let warnedUnavailable = false;

function isNativeSecureStoreAvailable(): Promise<boolean> {
  if (!availabilityCheck) {
    availabilityCheck =
      Platform.OS === 'web'
        ? Promise.resolve(false)
        : SecureStore.isAvailableAsync().catch(() => false);
  }
  return availabilityCheck;
}

function warnUnavailableOnce() {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  logger.warn(
    'secure-storage',
    Platform.OS === 'web'
      ? 'expo-secure-store has no web implementation; falling back to in-memory, non-persistent storage for this session.'
      : 'expo-secure-store native module is unavailable on this platform; falling back to in-memory, non-persistent storage for this session.',
  );
}

// In-memory fallback used only when native SecureStore isn't available.
const memoryStore = new Map<string, string>();

const memoryStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    return memoryStore.has(key) ? memoryStore.get(key)! : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    memoryStore.set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    memoryStore.delete(key);
  },
};

const nativeSecureStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    try {
      const countRaw = await SecureStore.getItemAsync(key + CHUNK_COUNT_SUFFIX);
      if (!countRaw) {
        // Falls back to a plain single-value read for anything written
        // before chunking existed, or for small values stored directly.
        return SecureStore.getItemAsync(key);
      }
      const count = parseInt(countRaw, 10);
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await SecureStore.getItemAsync(chunkKey(key, i));
        if (part === null) {
          logger.warn('secure-storage', `Missing chunk ${i} for key`, { key });
          return null;
        }
        parts.push(part);
      }
      return parts.join('');
    } catch (error) {
      logger.error('secure-storage', 'Failed to read secure storage item', error, { key });
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      // Clear any previous chunks before writing new ones, in case the
      // new value has fewer chunks than the old one did.
      await nativeSecureStorageAdapter.removeItem(key);

      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
        return;
      }

      const count = Math.ceil(value.length / CHUNK_SIZE);
      for (let i = 0; i < count; i++) {
        const part = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        await SecureStore.setItemAsync(chunkKey(key, i), part);
      }
      await SecureStore.setItemAsync(key + CHUNK_COUNT_SUFFIX, String(count));
    } catch (error) {
      logger.error('secure-storage', 'Failed to write secure storage item', error, { key });
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      const countRaw = await SecureStore.getItemAsync(key + CHUNK_COUNT_SUFFIX);
      if (countRaw) {
        const count = parseInt(countRaw, 10);
        for (let i = 0; i < count; i++) {
          await SecureStore.deleteItemAsync(chunkKey(key, i));
        }
        await SecureStore.deleteItemAsync(key + CHUNK_COUNT_SUFFIX);
      }
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      logger.error('secure-storage', 'Failed to remove secure storage item', error, { key });
    }
  },
};

export const secureStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (!(await isNativeSecureStoreAvailable())) {
      warnUnavailableOnce();
      return memoryStorageAdapter.getItem(key);
    }
    return nativeSecureStorageAdapter.getItem(key);
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!(await isNativeSecureStoreAvailable())) {
      warnUnavailableOnce();
      return memoryStorageAdapter.setItem(key, value);
    }
    return nativeSecureStorageAdapter.setItem(key, value);
  },

  async removeItem(key: string): Promise<void> {
    if (!(await isNativeSecureStoreAvailable())) {
      warnUnavailableOnce();
      return memoryStorageAdapter.removeItem(key);
    }
    return nativeSecureStorageAdapter.removeItem(key);
  },
};
