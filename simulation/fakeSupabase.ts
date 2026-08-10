/**
 * fakeSupabase — an in-memory stand-in for the Supabase client, good enough to
 * run the real training code paths against.
 *
 * WHY, AND WHAT IT IS NOT
 * -----------------------
 * The simulation harness has to exercise production's own reads and writes; it
 * must not reimplement them. That means production code needs a client, and
 * for the fast CI suite we want one with no Docker, no network, and no shared
 * state between runs.
 *
 * This is NOT a PostgREST clone and must never pretend to be. It implements the
 * operator subset the training paths actually use. **Anything it does not
 * understand throws.** That rule is the whole design: a fake that silently
 * returned `[]` for a query it failed to parse would hand the engine an empty
 * history and the harness would report a confident, entirely fictional
 * "prescription bug". Loud failure keeps simulation results trustworthy.
 *
 * It also does NOT enforce constraints, RLS, or triggers. The audit found those
 * to be load-bearing — `UNIQUE(exercise_block_id, set_number)` is what actually
 * prevents concurrent double-logging — so accounting invariants that depend on
 * them belong in the local-Supabase suite, not here. The declared uniqueness
 * below covers only the cases the driver relies on.
 */

export type Row = Record<string, unknown>;

/**
 * How an embedded select (`exercises (*)`, `workout_sessions!inner (...)`)
 * resolves. Only the relations the training paths traverse are declared;
 * an undeclared embed throws rather than resolving to null.
 */
interface Relation {
  /** Column on the OWNING table holding the key. */
  localKey: string;
  /** Table being joined to. */
  target: string;
  /** Column on the target table (almost always `id`). */
  targetKey: string;
}

const RELATIONS: Record<string, Record<string, Relation>> = {
  exercise_blocks: {
    exercises: { localKey: 'exercise_id', target: 'exercises', targetKey: 'id' },
    workout_sessions: {
      localKey: 'workout_session_id',
      target: 'workout_sessions',
      targetKey: 'id',
    },
    set_logs: { localKey: 'id', target: 'set_logs', targetKey: 'exercise_block_id' },
  },
  set_logs: {
    exercise_blocks: { localKey: 'exercise_block_id', target: 'exercise_blocks', targetKey: 'id' },
  },
  workout_sessions: {
    exercise_blocks: {
      localKey: 'id',
      target: 'exercise_blocks',
      targetKey: 'workout_session_id',
    },
  },
};

/** Embeds that return an ARRAY rather than a single row. */
const TO_MANY = new Set(['exercise_blocks.set_logs', 'workout_sessions.exercise_blocks']);

/** Columns whose value is generated on insert when the caller omits it. */
const GENERATED_ID_TABLES = new Set([
  'mesocycles',
  'workout_sessions',
  'exercise_blocks',
  'set_logs',
  'exercises',
  'weekly_fatigue_logs',
  'session_muscle_feedback',
  'joint_pain_events',
]);

function unsupported(what: string): never {
  throw new Error(
    `fakeSupabase: unsupported ${what}. Add it deliberately — do NOT make it return empty, ` +
      `or the simulation will report engine bugs that are really harness gaps.`
  );
}

// ---------------------------------------------------------------------------
// select() parsing
// ---------------------------------------------------------------------------

interface SelectField {
  name: string;
  inner?: boolean;
  children?: SelectField[];
}

/**
 * Parse a PostgREST select string into fields and embeds. Handles `*`, plain
 * columns, `alias (a, b)` embeds (nested), and the `!inner` modifier.
 */
export function parseSelect(select: string): SelectField[] {
  const fields: SelectField[] = [];
  let i = 0;
  const s = select;

  const skipWs = () => {
    while (i < s.length && /[\s\n\r]/.test(s[i])) i++;
  };

  while (i < s.length) {
    skipWs();
    if (i >= s.length) break;
    if (s[i] === ',') {
      i++;
      continue;
    }
    let name = '';
    while (i < s.length && !/[\s,(]/.test(s[i])) name += s[i++];
    skipWs();

    let inner = false;
    if (name.endsWith('!inner')) {
      inner = true;
      name = name.slice(0, -'!inner'.length);
    }

    if (s[i] === '(') {
      let depth = 0;
      const start = ++i;
      depth = 1;
      while (i < s.length && depth > 0) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') depth--;
        if (depth > 0) i++;
      }
      const body = s.slice(start, i);
      i++; // closing paren
      fields.push({ name, inner, children: parseSelect(body) });
    } else if (name) {
      fields.push({ name });
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

type FilterOp = 'eq' | 'neq' | 'in' | 'is' | 'not_is' | 'gte' | 'lte' | 'gt' | 'lt';
interface Filter {
  path: string;
  op: FilterOp;
  value: unknown;
}

function valueAtPath(row: Row, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = row;
  for (const part of parts) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      // A filter through a to-many embed matches if ANY child matches; the
      // caller-facing semantics we need are "inner join filter".
      const hit = cur.find((c) => (c as Row)?.[part] !== undefined);
      cur = hit ? (hit as Row)[part] : undefined;
    } else {
      cur = (cur as Row)[part];
    }
  }
  return cur;
}

function matches(row: Row, f: Filter): boolean {
  const v = valueAtPath(row, f.path);
  switch (f.op) {
    case 'eq':
      return v === f.value;
    case 'neq':
      return v !== f.value;
    case 'in':
      return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
    case 'is':
      return f.value === null ? v === null || v === undefined : v === f.value;
    case 'not_is':
      return f.value === null ? v !== null && v !== undefined : v !== f.value;
    case 'gte':
      return v != null && (v as never) >= (f.value as never);
    case 'lte':
      return v != null && (v as never) <= (f.value as never);
    case 'gt':
      return v != null && (v as never) > (f.value as never);
    case 'lt':
      return v != null && (v as never) < (f.value as never);
    default:
      return unsupported(`filter op ${f.op}`);
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class FakeDb {
  private tables = new Map<string, Row[]>();
  private idCounter = 0;

  /** Deterministic surrogate ids — no randomness, so traces are replayable. */
  nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${String(this.idCounter).padStart(6, '0')}`;
  }

  rows(table: string): Row[] {
    let t = this.tables.get(table);
    if (!t) {
      t = [];
      this.tables.set(table, t);
    }
    return t;
  }

  /** Bootstrap data (users, exercise catalog, …). Bypasses the query layer. */
  seed(table: string, rows: Row[]): void {
    this.rows(table).push(...rows.map((r) => ({ ...r })));
  }

  snapshot(): Record<string, Row[]> {
    const out: Record<string, Row[]> = {};
    this.tables.forEach((rows, table) => {
      out[table] = rows.map((r) => ({ ...r }));
    });
    return out;
  }

  reset(): void {
    this.tables.clear();
    this.idCounter = 0;
  }
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

interface BuilderState {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  select?: string;
  payload?: Row | Row[];
  filters: Filter[];
  order?: { path: string; ascending: boolean };
  limit?: number;
  countMode?: 'exact';
  headOnly?: boolean;
  upsertOptions?: { onConflict?: string; ignoreDuplicates?: boolean };
  returning: boolean;
}

class Builder implements PromiseLike<{ data: unknown; error: unknown; count?: number }> {
  constructor(
    private db: FakeDb,
    private state: BuilderState,
    private onQuery?: (table: string, op: string) => void
  ) {}

  private clone(patch: Partial<BuilderState>): Builder {
    return new Builder(this.db, { ...this.state, ...patch }, this.onQuery);
  }

  private filter(op: FilterOp, path: string, value: unknown): Builder {
    return this.clone({ filters: [...this.state.filters, { path, op, value }] });
  }

  select(select = '*', opts?: { count?: 'exact'; head?: boolean }): Builder {
    return this.clone({
      select,
      countMode: opts?.count,
      headOnly: opts?.head,
      returning: true,
    });
  }
  eq(path: string, value: unknown) { return this.filter('eq', path, value); }
  neq(path: string, value: unknown) { return this.filter('neq', path, value); }
  in(path: string, value: unknown[]) { return this.filter('in', path, value); }
  is(path: string, value: unknown) { return this.filter('is', path, value); }
  gte(path: string, value: unknown) { return this.filter('gte', path, value); }
  lte(path: string, value: unknown) { return this.filter('lte', path, value); }
  gt(path: string, value: unknown) { return this.filter('gt', path, value); }
  lt(path: string, value: unknown) { return this.filter('lt', path, value); }
  not(path: string, op: string, value: unknown) {
    if (op !== 'is') unsupported(`not(${op})`);
    return this.filter('not_is', path, value);
  }
  order(path: string, opts?: { ascending?: boolean; referencedTable?: string }) {
    return this.clone({ order: { path, ascending: opts?.ascending ?? true } });
  }
  limit(n: number, _opts?: { referencedTable?: string }) {
    return this.clone({ limit: n });
  }

  async single() {
    const { data, error } = await this.run();
    const list = data as Row[];
    if (error) return { data: null, error };
    if (!list || list.length === 0) {
      return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
    }
    return { data: list[0], error: null };
  }

  async maybeSingle() {
    const { data, error } = await this.run();
    const list = data as Row[];
    if (error) return { data: null, error };
    return { data: list && list.length > 0 ? list[0] : null, error: null };
  }

  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    onfulfilled?: ((v: { data: unknown; error: unknown; count?: number }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  // -- execution ----------------------------------------------------------

  private async run(): Promise<{ data: unknown; error: unknown; count?: number }> {
    const { table, op } = this.state;
    this.onQuery?.(table, op);
    switch (op) {
      case 'select':
        return this.runSelect();
      case 'insert':
      case 'upsert':
        return this.runInsert();
      case 'update':
        return this.runUpdate();
      case 'delete':
        return this.runDelete();
      default:
        return unsupported(`operation ${op}`);
    }
  }

  /** Attach declared embeds so filters and projection can traverse them. */
  private hydrate(table: string, row: Row, fields: SelectField[]): Row {
    const out: Row = { ...row };
    for (const f of fields) {
      if (!f.children) continue;
      const rel = RELATIONS[table]?.[f.name];
      if (!rel) unsupported(`embed ${table}.${f.name}`);
      const key = row[rel.localKey];
      const targets = this.db
        .rows(rel.target)
        .filter((r) => r[rel.targetKey] === key)
        .map((r) => this.hydrate(rel.target, r, f.children!));
      out[f.name] = TO_MANY.has(`${table}.${f.name}`) ? targets : targets[0] ?? null;
    }
    return out;
  }

  private project(row: Row, fields: SelectField[]): Row {
    if (fields.some((f) => f.name === '*' && !f.children)) {
      // `*` plus embeds: whole row, and the embeds already hydrated onto it.
      const out: Row = { ...row };
      return out;
    }
    const out: Row = {};
    for (const f of fields) {
      out[f.name] = row[f.name];
    }
    return out;
  }

  /**
   * Reject unknown embeds up front, before any row is touched.
   *
   * Doing this lazily inside hydrate() meant a query against an EMPTY table
   * never validated at all and quietly returned [] — precisely the silent-gap
   * failure this module exists to prevent.
   */
  private validateEmbeds(table: string, fields: SelectField[]): void {
    for (const f of fields) {
      if (!f.children) continue;
      const rel = RELATIONS[table]?.[f.name];
      if (!rel) unsupported(`embed ${table}.${f.name}`);
      this.validateEmbeds(rel.target, f.children);
    }
  }

  private async runSelect() {
    const { table, select = '*', filters, order, limit, countMode, headOnly } = this.state;
    const fields = parseSelect(select);
    this.validateEmbeds(table, fields);

    let rows = this.db.rows(table).map((r) => this.hydrate(table, r, fields));

    // `!inner` drops rows whose required embed didn't resolve.
    for (const f of fields) {
      if (f.inner) rows = rows.filter((r) => r[f.name] != null);
    }
    for (const f of filters) rows = rows.filter((r) => matches(r, f));

    if (order) {
      // Embedded ordering arrives as `workout_sessions(completed_at)`.
      const m = /^(\w+)\((\w+)\)$/.exec(order.path);
      const path = m ? `${m[1]}.${m[2]}` : order.path;
      rows = [...rows].sort((a, b) => {
        const av = valueAtPath(a, path);
        const bv = valueAtPath(b, path);
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av < bv ? -1 : 1) * (order.ascending ? 1 : -1);
      });
    }

    const count = rows.length;
    if (limit != null) rows = rows.slice(0, limit);
    if (headOnly) return { data: null, error: null, count };

    return {
      data: rows.map((r) => this.project(r, fields)),
      error: null,
      ...(countMode ? { count } : {}),
    };
  }

  private async runInsert() {
    const { table, payload, upsertOptions, returning, select } = this.state;
    const incoming = (Array.isArray(payload) ? payload : [payload]) as Row[];
    const stored: Row[] = [];

    for (const raw of incoming) {
      const row: Row = { ...raw };
      if (row.id === undefined && GENERATED_ID_TABLES.has(table)) {
        row.id = this.db.nextId(table);
      }
      const existing = this.db.rows(table).find((r) => r.id === row.id);
      if (existing) {
        if (this.state.op === 'upsert') {
          if (upsertOptions?.ignoreDuplicates) {
            stored.push(existing);
            continue;
          }
          Object.assign(existing, row);
          stored.push(existing);
          continue;
        }
        return {
          data: null,
          error: {
            message: `duplicate key value violates unique constraint "${table}_pkey"`,
            code: '23505',
          },
        };
      }
      this.db.rows(table).push(row);
      stored.push(row);
    }

    if (!returning) return { data: null, error: null };
    const fields = parseSelect(select ?? '*');
    return { data: stored.map((r) => this.project(r, fields)), error: null };
  }

  private async runUpdate() {
    const { table, payload, filters, returning, select } = this.state;
    const patch = payload as Row;
    const touched: Row[] = [];
    for (const row of this.db.rows(table)) {
      if (filters.every((f) => matches(row, f))) {
        Object.assign(row, patch);
        touched.push(row);
      }
    }
    if (!returning) return { data: null, error: null };
    const fields = parseSelect(select ?? '*');
    return { data: touched.map((r) => this.project(r, fields)), error: null };
  }

  private async runDelete() {
    const { table, filters } = this.state;
    const kept: Row[] = [];
    const rows = this.db.rows(table);
    for (const row of rows) {
      if (!filters.every((f) => matches(row, f))) kept.push(row);
    }
    rows.length = 0;
    rows.push(...kept);
    return { data: null, error: null };
  }
}

export interface FakeSupabaseOptions {
  /** The signed-in user every `auth.getUser()` returns. */
  userId: string;
  /** Called on every query — used by tests to assert what production touched. */
  onQuery?: (table: string, op: string) => void;
}

export interface FakeSupabase {
  db: FakeDb;
  /** Cast to the untyped client shape production expects. */
  // eslint-disable-next-line
  client: any;
}

/**
 * An in-memory client plus the store behind it. One per simulation run — the
 * store is instance state, so parallel runs never share rows.
 */
export function createFakeSupabase(options: FakeSupabaseOptions): FakeSupabase {
  const db = new FakeDb();

  const client = {
    from(table: string) {
      const base = (op: BuilderState['op'], payload?: Row | Row[], upsertOptions?: BuilderState['upsertOptions']) =>
        new Builder(
          db,
          { table, op, payload, filters: [], returning: false, upsertOptions },
          options.onQuery
        );
      return {
        select: (select = '*', opts?: { count?: 'exact'; head?: boolean }) =>
          base('select').select(select, opts),
        insert: (payload: Row | Row[]) => base('insert', payload),
        upsert: (payload: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) =>
          base('upsert', payload, opts),
        update: (payload: Row) => base('update', payload),
        delete: () => base('delete'),
      };
    },
    auth: {
      getUser: async () => ({ data: { user: { id: options.userId } }, error: null }),
    },
  };

  return { db, client };
}
