Throwaway test chain for `verifyJws.test.ts`, generated with openssl:
root → intermediate (Apple WWDR marker OID 1.2.840.113635.100.6.2.1) →
leaf (App Store signing marker OID 1.2.840.113635.100.6.11.1), plus a leaf
without the marker. The key is a test-only key for this fake chain; it has
nothing to do with Apple or HyperTrack's real signing. Tests trust this root
by passing its fingerprint; production only trusts Apple Root CA - G3.
