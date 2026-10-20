import "server-only";
import crypto from "node:crypto";

if (typeof window !== "undefined") {
  throw new Error("This module can only be executed in a server environment.");
}

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // 96-bit nonce for GCM
const AUTH_TAG_LENGTH_BYTES = 16; // 128-bit authentication tag
const KEY_LENGTH_HEX_CHARS = 64; // 32 bytes represented as 64 hex characters
const VERSION_PREFIX = "v1";

/**
 * Validates that an encryption key is a valid 64-character hexadecimal string (32 bytes).
 * Throws a sanitized Error if the key is missing, malformed, or of invalid length.
 */
export function validateEncryptionKey(keyHex?: string): Buffer {
  const keyToValidate = keyHex || process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY;

  if (!keyToValidate) {
    throw new Error(
      "Missing encryption key. INSTAGRAM_TOKEN_ENCRYPTION_KEY must be configured."
    );
  }

  if (typeof keyToValidate !== "string" || keyToValidate.length !== KEY_LENGTH_HEX_CHARS) {
    throw new Error(
      "Invalid encryption key length. INSTAGRAM_TOKEN_ENCRYPTION_KEY must be exactly a 64-character hexadecimal string (32 bytes)."
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(keyToValidate)) {
    throw new Error(
      "Malformed encryption key. INSTAGRAM_TOKEN_ENCRYPTION_KEY must contain only hexadecimal characters."
    );
  }

  return Buffer.from(keyToValidate, "hex");
}

/**
 * Encrypts a sensitive string (e.g. Meta access token) using AES-256-GCM.
 * Generates a fresh cryptographically random 12-byte IV for every encryption.
 * Returns a versioned serialized payload: "v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
export function encryptToken(plaintext: string, keyHex?: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("Cannot encrypt empty or invalid plaintext value.");
  }

  const keyBuffer = validateEncryptionKey(keyHex);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);

  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${VERSION_PREFIX}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a versioned AES-256-GCM payload.
 * Validates payload structure and authentication tag before returning plaintext.
 * Fails securely if payload has been tampered with or corrupted.
 */
export function decryptToken(serialized: string, keyHex?: string): string {
  if (typeof serialized !== "string" || !serialized.trim()) {
    throw new Error("Invalid serialized payload: expected a non-empty string.");
  }

  const parts = serialized.trim().split(":");
  if (parts.length !== 4) {
    throw new Error(
      "Malformed encrypted payload structure. Expected 'v1:<iv>:<tag>:<ciphertext>'."
    );
  }

  const [version, ivHex, tagHex, ciphertextHex] = parts;

  if (version !== VERSION_PREFIX) {
    throw new Error(`Unsupported encrypted payload version: '${version}'.`);
  }

  if (!/^[0-9a-fA-F]{24}$/.test(ivHex)) {
    throw new Error("Malformed encrypted payload: invalid IV encoding or length.");
  }

  if (!/^[0-9a-fA-F]{32}$/.test(tagHex)) {
    throw new Error(
      "Malformed encrypted payload: invalid authentication tag encoding or length."
    );
  }

  if (!/^[0-9a-fA-F]+$/.test(ciphertextHex) || ciphertextHex.length % 2 !== 0) {
    throw new Error(
      "Malformed encrypted payload: invalid ciphertext hex encoding."
    );
  }

  const keyBuffer = validateEncryptionKey(keyHex);
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv, {
      authTagLength: AUTH_TAG_LENGTH_BYTES,
    });

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch {
    throw new Error(
      "Failed to decrypt token: authentication tag validation failed or payload corrupted."
    );
  }
}
