import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** 密钥由部署注入，不从共享 APP_SECRET 或用户文件推导。 */
export class CredentialCipher {
  private readonly keys: Map<string, Buffer>;
  constructor(
    private readonly activeKeyId: string,
    keys: Readonly<Record<string, Buffer>>
  ) {
    this.keys = new Map(
      Object.entries(keys).map(([id, key]) => {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || key.length !== 32)
          throw new Error('Invalid credential encryption key configuration');
        return [id, Buffer.from(key)];
      })
    );
    if (!this.keys.has(activeKeyId)) throw new Error('Active encryption key is missing');
  }
  seal(plaintext: string, binding: string): string {
    if (!plaintext || !binding) throw new Error('Credential and binding are required');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.activeKeyId)!, iv);
    cipher.setAAD(Buffer.from(binding));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [
      'v1',
      this.activeKeyId,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }
  open(envelope: string, binding: string): string {
    try {
      const parts = envelope.split('.');
      if (
        parts.length !== 5 ||
        parts[0] !== 'v1' ||
        !binding ||
        parts.slice(2).some((p) => !p || !/^[A-Za-z0-9_-]+$/.test(p))
      )
        throw new Error();
      const key = this.keys.get(parts[1]);
      const iv = Buffer.from(parts[2], 'base64url');
      const tag = Buffer.from(parts[3], 'base64url');
      if (!key || iv.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(binding));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(parts[4], 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Credential decryption failed');
    }
  }
}
