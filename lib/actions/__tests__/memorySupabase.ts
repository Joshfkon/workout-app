/**
 * A minimal in-memory Supabase stand-in for server-action tests. Supports the
 * query shapes the nutrition/activity actions use, generates ids for every
 * table, and honours `onConflict` on upsert. Anything it does not understand
 * throws, so a test can never pass on a silently ignored call.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

export interface MemorySupabase {
  // eslint-disable-next-line
  client: any;
  rows(table: string): Row[];
  seed(table: string, rows: Row[]): void;
}

export function createMemorySupabase(userId: string): MemorySupabase {
  const tables = new Map<string, Row[]>();
  let idCounter = 0;

  const rows = (table: string): Row[] => {
    let t = tables.get(table);
    if (!t) {
      t = [];
      tables.set(table, t);
    }
    return t;
  };

  const withId = (row: Row): Row => (row.id === undefined ? { id: `id-${++idCounter}`, ...row } : { ...row });

  class Builder implements PromiseLike<{ data: unknown; error: unknown }> {
    private filters: Filter[] = [];
    private orderBy: { column: string; ascending: boolean } | null = null;
    private limitTo: number | null = null;
    private returning = false;

    constructor(
      private table: string,
      private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete',
      private payload?: Row | Row[],
      private onConflict?: string
    ) {}

    select(_columns?: string) {
      this.returning = true;
      return this;
    }
    eq(column: string, value: unknown) {
      this.filters.push((r) => r[column] === value);
      return this;
    }
    gte(column: string, value: string | number) {
      this.filters.push((r) => (r[column] as string | number) >= value);
      return this;
    }
    lte(column: string, value: string | number) {
      this.filters.push((r) => (r[column] as string | number) <= value);
      return this;
    }
    in(column: string, values: unknown[]) {
      this.filters.push((r) => values.includes(r[column]));
      return this;
    }
    not(column: string, operator: string, value: unknown) {
      if (operator !== 'is' || value !== null) throw new Error(`memorySupabase: unsupported not(${operator})`);
      this.filters.push((r) => r[column] !== null && r[column] !== undefined);
      return this;
    }
    order(column: string, options?: { ascending?: boolean }) {
      this.orderBy = { column, ascending: options?.ascending ?? true };
      return this;
    }
    limit(n: number) {
      this.limitTo = n;
      return this;
    }

    private matching(): Row[] {
      return rows(this.table).filter((r) => this.filters.every((f) => f(r)));
    }

    private run(): { data: Row[] | null; error: { message: string } | null } {
      const table = rows(this.table);
      switch (this.op) {
        case 'select': {
          let out = this.matching();
          if (this.orderBy) {
            const { column, ascending } = this.orderBy;
            out = [...out].sort((a, b) => {
              const av = a[column] as string | number;
              const bv = b[column] as string | number;
              return (av < bv ? -1 : av > bv ? 1 : 0) * (ascending ? 1 : -1);
            });
          }
          if (this.limitTo != null) out = out.slice(0, this.limitTo);
          return { data: out.map((r) => ({ ...r })), error: null };
        }
        case 'insert': {
          const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
          const stored = incoming.map(withId);
          table.push(...stored);
          return { data: this.returning ? stored.map((r) => ({ ...r })) : null, error: null };
        }
        case 'upsert': {
          const keys = (this.onConflict ?? 'id').split(',').map((k) => k.trim());
          const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
          const stored = incoming.map((row) => {
            const existing = table.find((r) => keys.every((k) => r[k] === row[k]));
            if (existing) {
              Object.assign(existing, row);
              return existing;
            }
            const created = withId(row);
            table.push(created);
            return created;
          });
          return { data: this.returning ? stored.map((r) => ({ ...r })) : null, error: null };
        }
        case 'update': {
          const hit = this.matching();
          hit.forEach((r) => Object.assign(r, this.payload as Row));
          return { data: this.returning ? hit.map((r) => ({ ...r })) : null, error: null };
        }
        case 'delete': {
          const hit = new Set(this.matching());
          const kept = table.filter((r) => !hit.has(r));
          table.length = 0;
          table.push(...kept);
          return { data: null, error: null };
        }
      }
    }

    async maybeSingle() {
      const { data, error } = this.run();
      return { data: data?.[0] ?? null, error };
    }
    async single() {
      const { data, error } = this.run();
      if (!data || data.length !== 1) {
        return { data: null, error: error ?? { message: 'JSON object requested, multiple (or no) rows returned' } };
      }
      return { data: data[0], error: null };
    }
    then<A, B>(
      onFulfilled?: (value: { data: unknown; error: unknown }) => A | PromiseLike<A>,
      onRejected?: (reason: unknown) => B | PromiseLike<B>
    ): PromiseLike<A | B> {
      return Promise.resolve(this.run()).then(onFulfilled, onRejected);
    }
  }

  const client = {
    from(table: string) {
      return {
        select: (columns?: string) => new Builder(table, 'select').select(columns),
        insert: (payload: Row | Row[]) => new Builder(table, 'insert', payload),
        upsert: (payload: Row | Row[], options?: { onConflict?: string }) =>
          new Builder(table, 'upsert', payload, options?.onConflict),
        update: (payload: Row) => new Builder(table, 'update', payload),
        delete: () => new Builder(table, 'delete'),
      };
    },
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
  };

  return {
    client,
    rows,
    seed: (table, seedRows) => {
      rows(table).push(...seedRows.map(withId));
    },
  };
}
