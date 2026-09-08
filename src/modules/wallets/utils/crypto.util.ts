import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

export class CryptoUtil {
  /**
   * Shard a private key into two shards using XOR
   * @param privateKey The string private key to split
   * @returns Two shards as Buffers
   */
  static splitKey(privateKey: string): { shard1: Buffer; shard2: Buffer } {
    const keyBuf = Buffer.from(privateKey, 'utf-8');
    const shard1 = randomBytes(keyBuf.length);
    const shard2 = Buffer.alloc(keyBuf.length);

    for (let i = 0; i < keyBuf.length; i++) {
      shard2[i] = keyBuf[i] ^ shard1[i];
    }

    return { shard1, shard2 };
  }

  /**
   * Reconstruct the private key from two shards
   */
  static reconstructKey(shard1: Buffer, shard2: Buffer): string {
    if (shard1.length !== shard2.length) {
      throw new Error('Shards must be of equal length');
    }

    const keyBuf = Buffer.alloc(shard1.length);
    for (let i = 0; i < shard1.length; i++) {
      keyBuf[i] = shard1[i] ^ shard2[i];
    }

    return keyBuf.toString('utf-8');
  }

  /**
   * Encrypt a buffer using AES-256-GCM
   */
  static encrypt(
    data: Buffer,
    encryptionKeyHex: string,
  ): { encrypted: string; iv: string; authTag: string } {
    const key = Buffer.from(encryptionKeyHex, 'hex');
    if (key.length !== 32) {
      throw new Error('Encryption key must be 32 bytes (64 hex characters)');
    }

    const iv = randomBytes(12); // GCM recommended IV size
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(data);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      encrypted: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
    };
  }

  /**
   * Decrypt an AES-256-GCM encrypted payload
   */
  static decrypt(
    encryptedHex: string,
    ivHex: string,
    authTagHex: string,
    encryptionKeyHex: string,
  ): Buffer {
    const key = Buffer.from(encryptionKeyHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encryptedText = Buffer.from(encryptedHex, 'hex');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted;
  }
}
