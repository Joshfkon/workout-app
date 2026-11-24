import { readFileSync } from 'node:fs';
import path from 'node:path';
import { X509Certificate, createPrivateKey, sign } from 'node:crypto';
import {
  APPLE_LEAF_OID,
  APPLE_ROOT_CA_G3_SHA256,
  AppleJwsError,
  derOid,
  verifyAppleJws,
} from '@/lib/apple/verifyJws';

const dir = path.join(__dirname, 'fixtures');
const pem = (f: string) => readFileSync(path.join(dir, f), 'utf8');
const der = (f: string) => new X509Certificate(pem(f)).raw.toString('base64');
const ROOT = new X509Certificate(pem('root.pem'));
const KEY = createPrivateKey(pem('TEST-ONLY-leaf-signing-key.pem'));
const trust = { trustedRootSha256: [ROOT.fingerprint256] };

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function makeJws(payload: object, opts: { leaf?: string; x5c?: string[]; alg?: string } = {}) {
  const header = { alg: opts.alg ?? 'ES256', x5c: opts.x5c ?? [der(opts.leaf ?? 'leaf.pem'), der('inter.pem'), der('root.pem')] };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const s = sign('sha256', Buffer.from(`${h}.${p}`), { key: KEY, dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${b64url(s)}`;
}

const tx = { transactionId: '2000001', originalTransactionId: '1000001', productId: 'app.hypertrack.workout.pro.monthly', bundleId: 'app.hypertrack.workout', environment: 'Sandbox', signedDate: Date.now() };

describe('verifyAppleJws', () => {
  it('encodes OIDs the way certificates store them', () => {
    expect(derOid(APPLE_LEAF_OID).toString('hex')).toBe('060a2a864886f76364060b01');
  });

  it('accepts a correctly chained, correctly signed payload', () => {
    expect(verifyAppleJws(makeJws(tx), trust)).toEqual(tx);
  });

  it('only trusts Apple Root CA - G3 by default', () => {
    expect(() => verifyAppleJws(makeJws(tx))).toThrow(/Apple Root CA - G3/);
    expect(APPLE_ROOT_CA_G3_SHA256.replace(/:/g, '')).toHaveLength(64);
  });

  it('rejects a payload changed after signing', () => {
    const [h, , s] = makeJws(tx).split('.');
    const forged = `${h}.${b64url(JSON.stringify({ ...tx, productId: 'app.hypertrack.workout.elite.yearly' }))}.${s}`;
    expect(() => verifyAppleJws(forged, trust)).toThrow(/signature/);
  });

  it('rejects a leaf without the App Store signing marker', () => {
    expect(() => verifyAppleJws(makeJws(tx, { leaf: 'leaf-no-oid.pem' }), trust)).toThrow(/marker/);
  });

  it('rejects a chain out of order or too short, and a non-ES256 alg', () => {
    expect(() => verifyAppleJws(makeJws(tx, { x5c: [der('inter.pem'), der('leaf.pem'), der('root.pem')] }), trust)).toThrow(AppleJwsError);
    expect(() => verifyAppleJws(makeJws(tx, { x5c: [der('leaf.pem'), der('root.pem')] }), trust)).toThrow(/three/);
    expect(() => verifyAppleJws(makeJws(tx, { alg: 'HS256' }), trust)).toThrow(/alg/);
  });

  it('rejects a payload signed outside the certificates’ validity', () => {
    expect(() => verifyAppleJws(makeJws({ ...tx, signedDate: Date.UTC(2000, 0, 1) }), trust)).toThrow(/valid/);
  });

  it('accepts Xcode-local test payloads only when allowed', () => {
    const xcode = makeJws({ ...tx, environment: 'Xcode' }, { x5c: [] });
    expect(() => verifyAppleJws(xcode, trust)).toThrow(/Xcode/);
    expect(verifyAppleJws(xcode, { allowXcodeEnvironment: true })).toMatchObject({ environment: 'Xcode' });
  });

  it('rejects garbage', () => {
    expect(() => verifyAppleJws('not.a.jws', trust)).toThrow(AppleJwsError);
    expect(() => verifyAppleJws('abc', trust)).toThrow(/three segments/);
  });
});
