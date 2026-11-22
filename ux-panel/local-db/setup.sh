#!/usr/bin/env bash
# Bring up a LOCAL Supabase for the synthetic user panel and replay the repo's
# migrations onto it. Never points at production.
#
# Why not plain `supabase start`? The migration history does not replay
# cleanly from an empty DB (see fixups.sql), and `supabase start` aborts on
# the first failure. This replays each file in its own transaction, retries
# the failures leniently (statement by statement), then applies fixups.sql and
# the exercise seed.
#
# Usage: ux-panel/local-db/setup.sh            (needs Docker, ~7 GB of images)
#        ux-panel/local-db/setup.sh --stop
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${UX_PANEL_SUPABASE_WORKDIR:-$REPO/ux-panel/.local-supabase}"
DB=supabase_db_Dec_WorkoutApp
EXCLUDE=studio,imgproxy,edge-runtime,logflare,vector,supavisor,realtime,storage-api,postgres-meta,mailpit

if [[ "${1:-}" == "--stop" ]]; then
  supabase stop --workdir "$WORK" --no-backup
  exit 0
fi

rm -rf "$WORK" && mkdir -p "$WORK/supabase/migrations"
cp "$REPO/supabase/config.toml" "$WORK/supabase/"
[[ -d "$REPO/supabase/templates" ]] && cp -R "$REPO/supabase/templates" "$WORK/supabase/"
: > "$WORK/supabase/seed.sql"
supabase start --workdir "$WORK" -x "$EXCLUDE"

psql_db() { docker exec -i "$DB" psql -U postgres -d postgres "$@"; }
failed=()
for f in "$REPO"/supabase/migrations/*.sql; do
  if ! psql_db -v ON_ERROR_STOP=1 -q -1 < "$f" > /dev/null 2>&1; then
    failed+=("$f")
    psql_db -q < "$f" > /dev/null 2>&1 || true   # lenient retry: keep what applies
  fi
done
echo "migrations that needed a lenient retry: ${#failed[@]}"
for f in "${failed[@]}"; do echo "  $(basename "$f")"; done
psql_db -q < "$REPO/ux-panel/local-db/fixups.sql"
psql_db -q < "$REPO/supabase/seed.sql" > /dev/null
echo "exercises seeded: $(psql_db -tAc 'select count(*) from exercises')"
echo
echo "Local env for the dev server (write to .env.local):"
supabase status --workdir "$WORK" -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)='
