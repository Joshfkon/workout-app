# Synthetic user panel (`ux-panel/`)

AI personas use the real app in a phone-sized browser, say in their own words
what confused them and what they thought, and the harness turns that into a
readout like one you'd get from a moderated usability study. The output is a
ranked list of issues (how many participants hit each one, with screenshots and
quotes), task success, and score distributions you can compare **build vs.
build**.

The UX counterpart of `simulation/` (engine correctness) and `ux-audit/`
(scripted checks).

> **Scores are relative.** Participants are LLM personas and nothing here is
> calibrated against real people. Use the numbers to compare two builds and
> the issues to find friction. They are **not** predicted App Store ratings.

## Method: semantic similarity rating (SSR)

Based on Maier et al., *LLMs Reproduce Human Purchase Intent via Semantic
Similarity Elicitation of Likert Ratings* (arXiv 2510.08338).

1. **Personas** (`personas.json`, 20 to start) have goals, experience, patience
   and tech comfort, plus an `account` block used to seed a returning user.
2. **Journeys** (`journeys.mjs`) are phrased as a user would think of them
   ("log what you had for lunch"), never as UI steps:
   - `first-run`: sign up and onboard
   - `log-workout`: start and log a workout
   - `log-meal`: search, recents, find the scan entry point
   - `check-progress`
   - `find-setting`: change units

   **User stories** (`--journeys=stories`) are designer-style scenarios written
   for each persona, for example "Lena has 30 minutes and always does the same
   lifts: swap an exercise her garage can't do". They are generated once into
   `stories.json` and reused, so two builds face identical stories.
3. **The agent** (`lib/agent.mjs`) plays the persona at 390×844. Each step it
   sees a screenshot and the accessibility snapshot, and it gets no app
   documentation, so getting lost is a finding. It takes one action per step,
   flags friction on the screen where it happens, and gives up when that
   persona would.
4. **Free-text review**: afterwards the persona answers four questions in its
   own words, plus what it liked, what confused it, and how the task could
   have been simpler. It is never asked for a number.
5. **SSR scoring** (`lib/ssr.mjs`) embeds each answer and compares it with five
   anchor statements per question (`anchors.mjs`), using the paper's Eq. 7–9:
   `p(r) ∝ cos(anchor_r, answer) − min_r' cos(anchor_r', answer)`, with ε = 0
   and T = 1, averaged over 4 anchor sets. The four questions are likelihood
   to keep using, ease of use, perceived polish, and willingness to pay.
6. **Aggregation** (`lib/aggregate.mjs`):
   - Mean distribution per journey.
   - Friction reports are clustered per screen by embedding similarity and
     ranked by how many **distinct** personas hit each cluster.
   - Run-vs-run comparison uses the mean shift and KS similarity (paper
     Eq. 3), and sorts issues into new, gone and still present.
7. **Readout** (`lib/readout.mjs` + `lib/report.mjs`): one "researcher" LLM
   call writes the summary, issue titles and recommendations. It never counts
   or ranks anything; every number comes from the aggregation.

### Same as the paper / different from it

| | Paper | Here |
|---|---|---|
| Elicitation | Free text, "reply briefly" | Same |
| Mapping | Cosine → subtract min → normalise, ε = 0, T = 1, average over anchor sets | Same |
| Anchors | 6 sets, tuned on their 57 surveys; only 2 statements published | 4 sets per question, written for this panel, **untuned** |
| Questions | Purchase intent only (validated) | Keep-using, ease, polish, pay (**not validated** by the paper) |
| Stimulus | A static product concept | The persona actually uses the app |
| Personas | Real respondents' demographics, 1:1 | Hand-written behavioural personas |
| Samples | 2 per prompt at T = 0.5 | 1 per question (current models reject `temperature`) |
| Embeddings | OpenAI `text-embedding-3-small` | Local `bge-small-en-v1.5` (default) or `--embed=openai` |
| Validation | ~90 % of human test–retest correlation | None: no human baseline, so relative only |

### Embedding choice

The repo had no embeddings provider. Anthropic has no embeddings endpoint, and
the `openai` SDK here is pointed at xAI for coaching. The default is
**BAAI/bge-small-en-v1.5 running locally** through transformers.js. It costs
nothing, needs no key, is deterministic, and the model download is about
130 MB, once. On hand-written test answers it separated the Likert points
better than `all-MiniLM-L6-v2` and `all-mpnet-base-v2`. For example, "Honestly
no, I'm going back to Hevy" → 2.25 and "Yes! This is exactly what I needed" →
4.09; MiniLM gave 2.35 and 3.58.

`--embed=openai` (needs `OPENAI_API_KEY`) uses the paper's model. Runs scored
with different embeddings or anchors are never compared: the report refuses,
because each run records the provider and a hash of `anchors.mjs`.

## Setup

The panel runs against a **local** dev server and a **local** Supabase. It
refuses any non-local Supabase URL, and any non-local `--base-url` unless you
pass `--allow-remote-preview`. It never touches production.

```bash
cd ux-panel && npm install && cd ..   # embedding runtime (kept out of the app's deps)
npx playwright install chromium-headless-shell
ux-panel/local-db/setup.sh            # Docker (Colima works), ~7 GB of images
```

`setup.sh` prints the local URL and keys. Put them in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key>
SUPABASE_SERVICE_ROLE_KEY=<local service role key>
```

Then:

```bash
npx next dev -p 3100                   # the build under test
node ux-panel/local-db/check-env.mjs   # should print "No schema errors"
ant auth login                         # or export ANTHROPIC_API_KEY=… (real runs only)
```

**Why not `supabase start` + `db reset`?** The migration history doesn't
replay on an empty database:
- Two migration files are stubs (`20241209000005_extended_user_profile.sql`
  and `20241217000007_hydration_and_equipment.sql` contain only ` */`).
- Two more lose their `CREATE TABLE` to older tables with the same name.

`setup.sh` replays each migration in its own transaction, retries failures
statement by statement, and then applies `local-db/fixups.sql`.
`check-env.mjs` crawls the main screens and lists any remaining "missing
column/table" errors. Runs also record them per session, and the report lists
them under *Test environment problems*, so a persona's complaint caused by
local drift isn't mistaken for a design issue.

## Running

```bash
node ux-panel/run.mjs --dry-run --fake-llm        # free: 2 personas × 1 journey, scripted agent
node ux-panel/run.mjs --dry-run                   # 2 × log-meal with the real model
node ux-panel/run.mjs --personas=5 --label="build 7"
node ux-panel/run.mjs --journeys=stories          # persona user stories
node ux-panel/run.mjs --estimate --personas=all   # cost only, no run
```

| Flag | Default | |
|---|---|---|
| `--personas` | `all` (`2` with `--dry-run`) | count (first N) or comma-separated ids |
| `--journeys` | `core` (`log-meal` with `--dry-run`) | `core`, `stories`, `all`, or comma-separated ids |
| `--model` | `claude-opus-5-5` | persona, review and readout model |
| `--effort` | `low` | thinking effort per step |
| `--embed` | `local` | `local` or `openai` |
| `--concurrency` | `2` | parallel browser sessions |
| `--yes` | | skip the spend confirmation |
| `--base-url` | `http://localhost:3100` | |

Every real run prints a cost estimate and asks before spending. It then makes
one tiny API call before creating any accounts, and stops the whole run at the
first billing or auth error.

**Credentials:** `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) if set,
otherwise the [`ant` CLI](https://github.com/anthropics/anthropic-cli) login
(`ant auth login`). The token is fetched per run and never written to disk.

Output goes to `ux-panel/runs/<id>/`:
- `report.html`: the readout
- `run.json`: everything, including per-persona pmfs and the issue clusters
- `tasks/<persona>__<journey>/`: a screenshot per step, plus `result.json`
  with the action log and review

### Comparing two builds

```bash
node ux-panel/run.mjs --label="before"   # build A
# …switch branch / deploy build B to :3100…
node ux-panel/run.mjs --label="after"
node ux-panel/report.mjs ux-panel/runs/<after> --baseline=ux-panel/runs/<before>
```

Use the same personas, journeys, model, anchors and stories for both runs.
With 1 sample per persona, treat mean shifts under about 0.3 as noise. Look at
the issue diff (new, gone, still present) first.

### Cost (estimates; calibrate from a real run's `run.json → cost`)

Measured: the first real run (Sonnet, 5 personas × core, 24 sessions) cost
**$2.42**. That was 255 calls at about 5.4k input and 195 output tokens each,
using 43 % of the step budget. The estimates below are calibrated on it and
still run a little high, because cache reads aren't modelled.

| | 2 × 1 dry run | 5 personas × core | 20 × core | 20 × 3 stories |
|---|---|---|---|---|
| Opus 5.5 | ~$0.63 | ~$6.3 (≤ $13) | ~$26 (≤ $55) | ~$15 (≤ $30) |
| Sonnet 5.5 | ~$0.32 | ~$3.2 (≤ $6.7) | ~$13 (≤ $28) | ~$7 (≤ $15) |
| Haiku 5.5 | ~$0.02 | ~$0.2 | ~$0.7 | ~$0.4 |

**Rerunning only what the test environment broke.** When the report lists
*Test environment problems*, fix the local DB (add to `local-db/fixups.sql`)
and rerun with `--reuse=<runDir>`. Sessions that finished without any
environment error are copied over; only the rest run (and cost) again. Add
`--rerun=<taskId>,…` to force specific sessions to run again, for example
ones broken by a harness bug that's since been fixed.

### Synthetic accounts

Accounts are created only in the local Supabase. Emails look like
`uxpanel+<persona>-<journey>-<run>@synthetic-panel.test` (a reserved TLD), and
`user_metadata.synthetic_panel = true`. Returning personas get a seeded
profile and a few weeks of workouts, weigh-ins and meals. First-run personas
sign up through the app's own form. Remove them with:

```bash
node ux-panel/cleanup.mjs              # all panel accounts
node ux-panel/cleanup.mjs --run=<id>
```

## Checking the anchors against real people

```bash
node ux-panel/calibrate.mjs      # free: local embeddings, no LLM calls
```

The anchor statements in `anchors.mjs` are hand-written, and the paper's
were tuned on real survey data. `calibrate.mjs` checks ours against real
people. It pulls up to 500 recent public US App Store reviews each of Hevy,
Strong and MacroFactor (text plus the reviewer's own stars), scores every
review with the same SSR pipeline, and reports:
- the **Spearman ρ** between the SSR score and the stars, on a sample capped
  at 40 per star level so five-star reviews don't dominate;
- the mean SSR score at each star level, and whether it rises monotonically;
- ρ for **each anchor set alone**, to find weak sets worth rewriting;
- **KS similarity** per app between the predicted and the real star
  distribution, the paper's own metric.

Review text is cached in `.cache/` and never committed. Only aggregates go to
`calibration/latest.json`.

First result (2026-11-22, 1,482 reviews, bge-small, T = 1):

| | ρ vs stars | mean score 1★ → 5★ | KS (Hevy / Strong / MacroFactor) |
|---|---|---|---|
| keep_using | **0.77** | 2.63 → 4.09, monotonic | 0.60 / 0.89 / 0.79 |
| ease | 0.72 | 2.36 → 3.65, monotonic | 0.44 / 0.73 / 0.64 |
| polish | 0.67 | 2.33 → 3.37, monotonic | 0.35 / 0.67 / 0.57 |
| pay | 0.75 | 2.36 → 3.80, monotonic | 0.47 / 0.75 / 0.67 |

Stars measure overall satisfaction, so they label `keep_using` best and the
other three only loosely. The ordering is right, but the scale is
**compressed**: a 1★ review lands near 2.6, not 1. A temperature sweep on
`keep_using` raised the mean KS from 0.76 at T = 1 to 0.89 at T = 0.3, with
5★ reviews moving up to 4.63. The low end barely moves, which points to the
negative anchors. Real 1★ reviews complain about bugs and subscriptions, not
"I'd stop using it". The default stays at the paper's T = 1 until the anchors
are revised, since changing T makes new runs incomparable with old ones.

## Limits

- The personas are ours, not a sample of real users, and the paper found that
  persona demographics matter.
- The local stack has no camera, no wearables, no Stripe, and no third-party
  food APIs unless their keys are in `.env.local`. Check an issue's screenshot
  before acting on it.
- The paper validated SSR only for purchase intent. The usability questions
  are a reasonable extension, not a validated one.
- One sample per persona per question, so individual scores are noisy. The
  distribution over the panel is what's meaningful.

## Tests

`ux-panel/__tests__/` covers the SSR mapping, aggregation and clustering,
run comparison, and report rendering. They run in the normal `npm test`.
