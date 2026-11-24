import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { X509Certificate, createPrivateKey, sign } from 'node:crypto';
import {
  APPLE_LEAF_OID,
  APPLE_ROOT_CA_G3_SHA256,
  AppleJwsError,
  derOid,
  verifyAppleJws,
} from '@/lib/apple/verifyJws';

/**
 * A throwaway chain made with openssl for this run (nothing committed: *.pem
 * is gitignored, and no key should live in the repo): root → intermediate
 * with Apple's WWDR marker OID → leaf with the App Store signing marker OID,
 * plus a leaf without the marker. Tests trust this root by fingerprint;
 * production trusts only Apple Root CA - G3.
 */
const dir = mkdtempSync(path.join(tmpdir(), 'apple-jws-'));
const EXT = `[ca]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
[inter]
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
1.2.840.113635.100.6.2.1=ASN1:NULL
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
[leaf]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
1.2.840.113635.100.6.11.1=ASN1:NULL
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
[leafnooid]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
`;
function makeChain() {
  writeFileSync(path.join(dir, 'ext.cnf'), EXT);
  const sh = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe' });
  for (const k of ['root', 'inter', 'leaf']) sh(`openssl ecparam -name prime256v1 -genkey -noout -out ${k}.key`);
  sh('openssl req -x509 -new -key root.key -subj "/CN=Test Root CA" -days 36500 -set_serial 1 -extensions ca -config ext.cnf -out root.pem');
  sh('openssl req -new -key inter.key -subj "/CN=Test WWDR Intermediate" -out inter.csr');
  sh('openssl x509 -req -in inter.csr -CA root.pem -CAkey root.key -set_serial 2 -days 36500 -extfile ext.cnf -extensions inter -out inter.pem');
  sh('openssl req -new -key leaf.key -subj "/CN=Test StoreKit Signing" -out leaf.csr');
  sh('openssl x509 -req -in leaf.csr -CA inter.pem -CAkey inter.key -set_serial 3 -days 36500 -extfile ext.cnf -extensions leaf -out leaf.pem');
  sh('openssl x509 -req -in leaf.csr -CA inter.pem -CAkey inter.key -set_serial 4 -days 36500 -extfile ext.cnf -extensions leafnooid -out leaf-no-oid.pem');
}
makeChain();
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const pem = (f: string) => readFileSync(path.join(dir, f), 'utf8');
const der = (f: string) => new X509Certificate(pem(f)).raw.toString('base64');
const ROOT = new X509Certificate(pem('root.pem'));
const KEY = createPrivateKey(pem('leaf.key'));
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
