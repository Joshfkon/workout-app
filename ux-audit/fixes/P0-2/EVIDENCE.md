# The no-double-insert guarantee, for a skeptic

**Mechanism.** Every set's UUID is minted client-side (`crypto.randomUUID()`,
workout/[id]/page.tsx:1650) *before the first network attempt* — earlier than
the enqueue-time minimum you asked for. That same id travels with the row into
the direct online insert, into the IndexedDB outbox entry, and into every
flush retry. Flushes never "mark items done after a 200" as the source of
truth for dedupe — they apply with `upsert(row, { onConflict: 'id',
ignoreDuplicates: true })`, i.e. `INSERT … ON CONFLICT (id) DO NOTHING`. The
queue-entry delete after a success response is only garbage collection: if
the success response is lost, the entry stays queued and the retry's upsert
is a server-side no-op on the already-present primary key. So the design is
at-least-once delivery composed with idempotent apply, which yields
exactly-once *effect* regardless of where the connection dies — before the
request, mid-request, or after the server commit but before the ack. The one
thing this cannot survive is the client losing its IndexedDB *and* never
having reached the server (the set is then simply gone, not duplicated) —
duplication would require the same UUID to be inserted twice, which
`ON CONFLICT DO NOTHING` on the primary key excludes by construction.

**Tests** (lib/offline/__tests__/setOutbox.test.ts, "exactly-once effect
under ugly failures" — a stateful fake server that commits rows into a Set
*before* optionally dropping the response):

1. *Lost ack:* server commits, response drops, client retains the entry and
   reports failure; retry flush → server row count stays exactly 1, queue
   empties.
2. *App killed mid-flush:* post-kill state reconstructed (row committed
   server-side, queue delete never ran, second entry untouched); reopen +
   flush → 2 server rows total, no duplicate of the pre-kill row.
3. *Two tabs:* second module instance loaded via `jest.isolateModules`
   (separate in-flight mutex, shared IndexedDB driver + server), flushes
   raced with `Promise.all` → exactly one server row per entry.

Plus the earlier suite: sequential double-flush no-op, `ignoreDuplicates`
options asserted verbatim, network-vs-server error classification, retry
cap so a rejected row can't wedge the queue. 22 tests, all green.

**End-to-end:** ux-audit/fixes/P0-2/verification-log.txt — real browser,
Playwright network emulation: 3 sets offline → 0 DB rows → reconnect →
3 rows → page reload (second flush trigger) → still 3 rows.
