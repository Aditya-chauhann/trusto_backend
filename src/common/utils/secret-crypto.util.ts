import { CryptoUtil } from '../../modules/wallets/utils/crypto.util';

/** Encrypt a UTF-8 string for storage (AES-256-GCM). */
export function encryptSecret(
  plaintext: string,
  encryptionKeyHex: string,
): string {
  const payload = CryptoUtil.encrypt(
    Buffer.from(plaintext, 'utf-8'),
    encryptionKeyHex,
  );
  return `${payload.iv}:${payload.authTag}:${payload.encrypted}`;
}

/** Decrypt a string previously encrypted with {@link encryptSecret}. */
export function decryptSecret(
  stored: string,
  encryptionKeyHex: string,
): string {
  const [iv, authTag, encrypted] = stored.split(':');
  if (!iv || !authTag || !encrypted) {
    throw new Error('Malformed encrypted secret');
  }
  const buf = CryptoUtil.decrypt(encrypted, iv, authTag, encryptionKeyHex);
  return buf.toString('utf-8');
}
