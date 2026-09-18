import * as Crypto from 'expo-crypto';
import nacl from 'tweetnacl';

import { logger } from '@/lib/logger';
import { secureStorageAdapter } from '@/lib/secure-storage';

/**
 * Application-layer encryption for the offline SQLite mirror (Phase 5C),
 * per PRODUCT_SPEC.md section 9 ("both photos and the local SQLite data
 * are encrypted at rest on the device").
 *
 * Why this instead of a fully-encrypted database file (e.g. SQLCipher):
 * this project has deliberately stayed on plain Expo managed workflow --
 * runnable in Expo Go -- through every phase so far (no `android`/`ios`
 * native directories, no custom dev client). A SQLCipher-backed SQLite
 * driver needs a custom native build, which would mean ejecting; that's a
 * large infrastructure change this phase didn't ask for and shouldn't
 * make unilaterally. The pragmatic, fully-disclosed alternative:
 *
 *  - Every free-text / potentially sensitive field written to the local
 *    mirror (observations, status reasons, photo captions) is encrypted
 *    with this module before it touches SQLite, and decrypted only in
 *    memory when read back.
 *  - Photo bytes are encrypted the same way before being written to local
 *    device storage (see offline-photos.ts).
 *  - Structural fields (ids, statuses, titles copied from the check
 *    library, timestamps, priorities) stay in plaintext -- none of those
 *    are property- or tenant-specific secrets, and keeping them queryable
 *    is what makes the local mirror usable as an actual database rather
 *    than an opaque blob.
 *
 * This is a deliberate, documented trade-off -- see the Phase 5C entry in
 * PRODUCT_SPEC.md's Open Decisions Log and DATABASE_SCHEMA.md. Flag it if
 * you'd rather invest in ejecting for full-database encryption instead.
 *
 * The primitive: tweetnacl's `secretbox` (XSalsa20-Poly1305 authenticated
 * encryption) -- a pure-JS, zero-native-code, widely audited
 * implementation, so it needs no native module and works unmodified in
 * Expo Go. The one thing tweetnacl needs from the host is a source of
 * cryptographically secure random bytes for keys/nonces; rather than
 * wiring up `nacl.setPRNG` (which needs a synchronous RNG), every key and
 * nonce below is generated explicitly via `expo-crypto`'s
 * `getRandomBytesAsync` and passed in, so `nacl.randomBytes()` itself is
 * never called.
 *
 * The symmetric key is generated once per install and stored in
 * `expo-secure-store` (iOS Keychain / Android Keystore) via the same
 * `secureStorageAdapter` already used for the Supabase auth session --
 * hardware-backed secure storage, exactly what section 3.6 requires.
 */

const KEY_STORAGE_KEY = 'capex.offline-mirror-encryption-key';

let cachedKey: Uint8Array | null = null;
let keyPromise: Promise<Uint8Array> | null = null;

// Self-contained base64 and UTF-8 codecs, deliberately not relying on
// `btoa`/`atob`/`TextEncoder`/`TextDecoder` globals. Those are DOM/web
// APIs; React Native's own `Libraries/` source has no polyfill for any of
// them (confirmed by grepping the installed react-native package), and
// whether Hermes happens to provide them as engine built-ins varies by
// version in ways that can't be confirmed without a real device. A few
// lines of dependency-free code here removes that whole class of "does
// this actually exist at runtime" risk.
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;

    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    result +=
      b1 === undefined ? '=' : BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    result += b2 === undefined ? '=' : BASE64_CHARS[b2 & 0x3f];
  }
  return result;
}

function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;

  for (let i = 0; i < clean.length; i++) {
    const charIndex = BASE64_CHARS.indexOf(clean[i]);
    if (charIndex === -1) continue;
    buffer = (buffer << 6) | charIndex;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

// Minimal UTF-8 encode/decode -- covers the full Unicode range (including
// surrogate pairs), which is all `TextEncoder`/`TextDecoder` do for our
// purposes (plain observation/reason/caption text).
function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let codePoint = text.codePointAt(i) as number;
    if (codePoint > 0xffff) i++; // consumed a surrogate pair

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

function utf8Decode(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      result += String.fromCodePoint(b0);
      i += 1;
    } else if ((b0 & 0xe0) === 0xc0) {
      const codePoint = ((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      result += String.fromCodePoint(codePoint);
      i += 2;
    } else if ((b0 & 0xf0) === 0xe0) {
      const codePoint = ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      result += String.fromCodePoint(codePoint);
      i += 3;
    } else {
      const codePoint =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      result += String.fromCodePoint(codePoint);
      i += 4;
    }
  }
  return result;
}

async function loadOrCreateKey(): Promise<Uint8Array> {
  const existing = await secureStorageAdapter.getItem(KEY_STORAGE_KEY);
  if (existing) {
    return base64ToBytes(existing);
  }

  const generated = await Crypto.getRandomBytesAsync(nacl.secretbox.keyLength);
  await secureStorageAdapter.setItem(KEY_STORAGE_KEY, bytesToBase64(generated));
  return generated;
}

/**
 * Returns the device's offline-mirror encryption key, generating and
 * persisting one on first use. Cached in memory for the life of the
 * process -- every call after the first resolves immediately.
 */
function getKey(): Promise<Uint8Array> {
  if (cachedKey) return Promise.resolve(cachedKey);
  if (!keyPromise) {
    keyPromise = loadOrCreateKey().then((key) => {
      cachedKey = key;
      return key;
    });
  }
  return keyPromise;
}

/**
 * Encrypts a UTF-8 string for storage in the local SQLite mirror.
 * Returns a compact `base64(nonce).base64(ciphertext)` envelope, safe to
 * store directly in a TEXT column.
 */
export async function encryptText(plainText: string): Promise<string> {
  const key = await getKey();
  const nonce = await Crypto.getRandomBytesAsync(nacl.secretbox.nonceLength);
  const messageBytes = utf8Encode(plainText);
  const box = nacl.secretbox(messageBytes, nonce, key);
  return `${bytesToBase64(nonce)}.${bytesToBase64(box)}`;
}

/**
 * Decrypts a value produced by `encryptText`. Returns `null` (and logs)
 * rather than throwing on a malformed envelope or a failed authentication
 * check, so a corrupted row can't crash the walkthrough screen -- callers
 * should treat `null` the same as "value unavailable".
 */
export async function decryptText(envelope: string): Promise<string | null> {
  const parts = envelope.split('.');
  if (parts.length !== 2) {
    logger.error('local-crypto', 'Malformed encrypted-text envelope', undefined, {
      partCount: parts.length,
    });
    return null;
  }
  try {
    const key = await getKey();
    const nonce = base64ToBytes(parts[0]);
    const box = base64ToBytes(parts[1]);
    const opened = nacl.secretbox.open(box, nonce, key);
    if (!opened) {
      logger.error('local-crypto', 'Failed to decrypt local text value (auth check failed)');
      return null;
    }
    return utf8Decode(opened);
  } catch (error) {
    logger.error('local-crypto', 'Failed to decrypt local text value', error);
    return null;
  }
}

/**
 * Encrypts raw bytes (a captured photo's file contents) for storage on
 * local device storage. The nonce is prepended to the returned buffer so
 * the encrypted file is fully self-contained -- no separate metadata file
 * to keep in sync with it.
 */
export async function encryptBytesForStorage(bytes: Uint8Array): Promise<Uint8Array> {
  const key = await getKey();
  const nonce = await Crypto.getRandomBytesAsync(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(bytes, nonce, key);
  const combined = new Uint8Array(nonce.length + box.length);
  combined.set(nonce, 0);
  combined.set(box, nonce.length);
  return combined;
}

/**
 * Reverses `encryptBytesForStorage`. Returns `null` (and logs) on a
 * corrupted/tampered file rather than throwing.
 */
export async function decryptBytesFromStorage(combined: Uint8Array): Promise<Uint8Array | null> {
  const nonceLength = nacl.secretbox.nonceLength;
  if (combined.length <= nonceLength) {
    logger.error('local-crypto', 'Encrypted photo file too short to contain a nonce');
    return null;
  }
  try {
    const key = await getKey();
    const nonce = combined.slice(0, nonceLength);
    const box = combined.slice(nonceLength);
    const opened = nacl.secretbox.open(box, nonce, key);
    if (!opened) {
      logger.error('local-crypto', 'Failed to decrypt local photo file (auth check failed)');
      return null;
    }
    return opened;
  } catch (error) {
    logger.error('local-crypto', 'Failed to decrypt local photo file', error);
    return null;
  }
}
