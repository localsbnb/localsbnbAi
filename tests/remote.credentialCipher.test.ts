import { randomBytes } from 'node:crypto';
import { CredentialCipher } from '../src/remote/oauth/credentialCipher';
it('encrypts nondeterministically and binds credentials to the owning grant',()=>{
  const c=new CredentialCipher('key1',{key1:randomBytes(32)});
  const a=c.seal('test-secret','user1/camp1/grant1');
  expect(a).not.toContain('test-secret');
  expect(a).not.toBe(c.seal('test-secret','user1/camp1/grant1'));
  expect(c.open(a,'user1/camp1/grant1')).toBe('test-secret');
  expect(()=>c.open(a,'user2/camp1/grant1')).toThrow('Credential decryption failed');
});
it('supports reading with retained keys after rotation',()=>{
  const old=randomBytes(32), next=randomBytes(32);
  const before=new CredentialCipher('old',{old});
  const after=new CredentialCipher('next',{old,next});
  const encrypted=before.seal('test-secret','binding');
  expect(after.open(encrypted,'binding')).toBe('test-secret');
  expect(after.seal('test-secret','binding')).toMatch(/^v1.next\./);
  expect(()=>new CredentialCipher('next',{next}).open(encrypted,'binding')).toThrow('decryption failed');
});
it('rejects ciphertext tampering and wrong keys without exposing input',()=>{
  const c=new CredentialCipher('key1',{key1:randomBytes(32)});
  const envelope=c.seal('test-secret','binding');
  const parts=envelope.split('.');const bytes=Buffer.from(parts[4],'base64url');bytes[0]^=1;parts[4]=bytes.toString('base64url');
  expect(()=>c.open(parts.join('.'),'binding')).toThrow(/^Credential decryption failed$/);
  expect(()=>new CredentialCipher('key1',{key1:randomBytes(32)}).open(envelope,'binding')).toThrow('decryption failed');
});
it.each([0,16,31,33])('rejects invalid key length %s',length=>{
  expect(()=>new CredentialCipher('key1',{key1:Buffer.alloc(length)})).toThrow('configuration');
});
