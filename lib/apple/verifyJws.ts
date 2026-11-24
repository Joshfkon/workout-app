/**
 * Verify an App Store signed payload (StoreKit 2 `jwsRepresentation`, or an
 * App Store Server Notification V2 `signedPayload` and the JWS fields inside
 * it) and return its decoded body. SERVER ONLY.
 *
 * Apple signs these as ES256 JWS with the certificate chain in the header's
 * `x5c`: leaf → Apple Worldwide Developer Relations intermediate → Apple Root
 * CA - G3. We check, without a network call or an API key:
 *  1. the chain has three certificates and the root is Apple Root CA - G3,
 *     pinned by its SHA-256 fingerprint (Apple's published root list);
 *  2. each certificate is issued and signed by the next, and was valid when
 *     the payload was signed;
 *  3. the leaf and intermediate carry Apple's App Store receipt-signing
 *     marker OIDs (the same checks Apple's app-store-server-library makes);
 *  4. the JWS signature verifies with the leaf's key.
 *
 * Xcode's local StoreKit testing signs with a throwaway local certificate
 * that cannot chain to Apple. Those payloads (environment "Xcode") are only
 * accepted when `allowXcodeEnvironment` is set, which the routes do outside
 * production only.
 */
import { X509Certificate, verify as cryptoVerify } from 'node:crypto';

/** SHA-256 of Apple Root CA - G3 (support.apple.com root certificate list). */
export const APPLE_ROOT_CA_G3_SHA256 =
  '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79';

/** Marker extension on Apple's App Store receipt-signing leaf certificate. */
export const APPLE_LEAF_OID = '1.2.840.113635.100.6.11.1';
/** Marker extension on the Apple WWDR intermediate certificate. */
export const APPLE_INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1';

export class AppleJwsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppleJwsError';
  }
}

export interface VerifyOptions {
  /** Root fingerprints to accept (tests pass their own). Defaults to G3. */
  trustedRootSha256?: readonly string[];
  /** Accept Xcode-local test payloads unverified (never in production). */
  allowXcodeEnvironment?: boolean;
  /** Fallback validity instant when the payload carries no signedDate. */
  now?: Date;
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function normFingerprint(f: string): string {
  return f.replace(/[^0-9a-f]/gi, '').toUpperCase();
}

/** DER encoding of an OBJECT IDENTIFIER (tag 0x06), to find it in a cert. */
export function derOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const bytes: number[] = [40 * parts[0] + parts[1]];
  for (const n of parts.slice(2)) {
    const chunk: number[] = [n & 0x7f];
    let v = Math.floor(n / 128);
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    bytes.push(...chunk);
  }
  return Buffer.from([0x06, bytes.length, ...bytes]);
}

function hasOid(cert: X509Certificate, oid: string): boolean {
  return cert.raw.includes(derOid(oid));
}

function validAt(cert: X509Certificate, at: Date): boolean {
  return new Date(cert.validFrom) <= at && at <= new Date(cert.validTo);
}

/** Decode a JWS segment as JSON without verifying anything. */
function decodeSegment<T>(segment: string, what: string): T {
  try {
    return JSON.parse(b64urlToBuffer(segment).toString('utf8')) as T;
  } catch {
    throw new AppleJwsError(`Malformed JWS ${what}`);
  }
}

/** Root pinned, each certificate issued and signed by the next, Apple's marker OIDs, valid at `at`. */
function verifyChain(chain: X509Certificate[], trustedRoots: readonly string[], at: Date): void {
  const [leaf, intermediate, root] = chain;
  if (!trustedRoots.map(normFingerprint).includes(normFingerprint(root.fingerprint256))) {
    throw new AppleJwsError('JWS root certificate is not Apple Root CA - G3');
  }
  if (!root.verify(root.publicKey)) throw new AppleJwsError('Root certificate is not self-signed');
  if (!intermediate.checkIssued(root) || !intermediate.verify(root.publicKey)) {
    throw new AppleJwsError('Intermediate certificate is not issued by the root');
  }
  if (!leaf.checkIssued(intermediate) || !leaf.verify(intermediate.publicKey)) {
    throw new AppleJwsError('Leaf certificate is not issued by the intermediate');
  }
  if (!hasOid(intermediate, APPLE_INTERMEDIATE_OID)) throw new AppleJwsError('Intermediate lacks the Apple WWDR marker');
  if (!hasOid(leaf, APPLE_LEAF_OID)) throw new AppleJwsError('Leaf lacks the App Store receipt-signing marker');
  for (const cert of chain) {
    if (!validAt(cert, at)) throw new AppleJwsError('A certificate in the chain was not valid when the payload was signed');
  }
}

export function verifyAppleJws<T extends object>(jws: string, options: VerifyOptions = {}): T {
  if (typeof jws !== 'string') throw new AppleJwsError('JWS must be a string');
  const segments = jws.split('.');
  if (segments.length !== 3) throw new AppleJwsError('JWS must have three segments');
  const [h, p, s] = segments;
  const header = decodeSegment<{ alg?: string; x5c?: string[] }>(h, 'header');
  const payload = decodeSegment<T & { environment?: string; signedDate?: number }>(p, 'payload');

  if (payload.environment === 'Xcode' || payload.environment === 'LocalTesting') {
    if (options.allowXcodeEnvironment) return payload;
    throw new AppleJwsError('Xcode test transactions are not accepted here');
  }

  if (header.alg !== 'ES256') throw new AppleJwsError(`Unexpected JWS alg ${header.alg}`);
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length !== 3) throw new AppleJwsError('JWS x5c must hold three certificates');

  let chain: X509Certificate[];
  try {
    chain = x5c.map((c) => new X509Certificate(Buffer.from(c, 'base64')));
  } catch {
    throw new AppleJwsError('JWS x5c holds an unreadable certificate');
  }
  verifyChain(chain, options.trustedRootSha256 ?? [APPLE_ROOT_CA_G3_SHA256],
    typeof payload.signedDate === 'number' ? new Date(payload.signedDate) : options.now ?? new Date());
  const leaf = chain[0];

  const ok = cryptoVerify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' },
    b64urlToBuffer(s)
  );
  if (!ok) throw new AppleJwsError('JWS signature does not verify');
  return payload;
}
