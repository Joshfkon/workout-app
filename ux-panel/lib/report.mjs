/**
 * Renders a run (and optionally a baseline run) as a self-contained HTML
 * readout, laid out like an internal usability-study report: summary, task
 * success, ranked issues with screenshots and quotes, what people liked,
 * participant snapshots, then the SSR score distributions with caveats.
 * Pure: run objects in, HTML string out.
 */
import { QUESTIONS, WEEK_QUESTIONS, RETIRED_QUESTION_LABELS, LEGACY_ANCHOR_HASHES } from '../anchors.mjs';
import { envTaintedTasks, compareRuns, comparableQuestions } from './aggregate.mjs';

const LABELS = { ...RETIRED_QUESTION_LABELS, ...Object.fromEntries(QUESTIONS.map((q) => [q.id, q.label])) };
const labelOf = (id) => LABELS[id] ?? id;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const signed = (x, d = 2) => (Number.isFinite(x) ? `${x > 0 ? '+' : ''}${x.toFixed(d)}` : '–');
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '–');

const LIKERT_COLORS = ['var(--l1)', 'var(--l2)', 'var(--l3)', 'var(--l4)', 'var(--l5)'];

function distBar(pmf) {
  return `<div class="dist" role="img" aria-label="${esc(pmf.map((p, i) => `${i + 1}: ${Math.round(p * 100)}%`).join(', '))}">${pmf
    .map((p, i) => `<span style="width:${(p * 100).toFixed(1)}%;background:${LIKERT_COLORS[i]}" title="${i + 1}: ${Math.round(p * 100)}%"></span>`)
    .join('')}</div>`;
}

const SEVERITY_LABEL = { blocker: 'Blocker', major: 'Major', minor: 'Minor' };

function issueCard(c, i, run, readoutIssue, shotPrefix) {
  const names = c.personas.map((id) => run.personas[id]?.name ?? id);
  const quotes = c.items.slice(0, 3).map((it) => {
    const who = run.personas[it.personaId]?.name ?? it.personaId;
    return `<blockquote>“${esc(it.text)}”<cite>— ${esc(who)}, ${esc(run.journeyLabels[it.journeyId] ?? it.journeyId)}</cite></blockquote>`;
  });
  const shotItem = c.items.find((it) => it.screenshot);
  const shot = shotItem ? `<img loading="lazy" src="${esc(`${shotPrefix}tasks/${shotItem.taskId}/${shotItem.screenshot}`)}" alt="Screen where ${esc(names[0])} hit this">` : '';
  const tainted = envTaintedTasks(c, run.results ?? []);
  const envNote = tainted.length
    ? `<p class="env-note"><strong>Check before acting:</strong> ${tainted.length === c.items.length ? 'every session' : `${tainted.length} of the sessions`} behind this issue also hit a local test-environment error (see <em>Test environment problems</em>). It may be the test setup, not the app.</p>`
    : '';
  return `<article class="issue sev-${esc(c.severity)}">
  <div class="issue-head"><span class="num">${i + 1}</span><h3>${esc(readoutIssue?.title || c.label)}</h3><span class="pill">${esc(SEVERITY_LABEL[c.severity] ?? c.severity)}</span></div>
  <p class="meta"><strong>${c.personaCount} of ${run.panel.personas}</strong> participants · <code>${esc(c.screen)}</code> · ${esc(c.journeys.map((j) => run.journeyLabels[j] ?? j).join(', '))}</p>
  ${envNote}<div class="issue-body"><div>${quotes.join('')}${readoutIssue?.recommendation ? `<p class="rec"><strong>Recommendation:</strong> ${esc(readoutIssue.recommendation)}</p>` : ''}<p class="who">Hit by: ${esc(names.join(', '))}</p></div>${shot}</div>
</article>`;
}

function completionTable(run, base) {
  const rows = Object.entries(run.completion)
    .map(([j, c]) => {
      const steps = run.results.filter((r) => r.journeyId === j && r.outcome === 'completed').map((r) => r.steps).sort((a, b) => a - b);
      const median = steps.length ? steps[Math.floor(steps.length / 2)] : NaN;
      const b = base?.completion?.[j];
      return `<tr><th scope="row">${esc(run.journeyLabels[j] ?? j)}</th><td>${c.completed}/${c.ran} <span class="muted">(${pct(c.completed, c.ran)})</span></td><td>${c.gaveUp}</td><td>${c.errored || 0}</td><td>${Number.isFinite(median) ? median : '–'}</td>${base ? `<td>${b ? pct(b.completed, b.ran) : '–'}</td>` : ''}</tr>`;
    })
    .join('');
  return `<div class="tw"><table><thead><tr><th>Task</th><th>Completed</th><th>Gave up</th><th>Harness error</th><th>Median actions (completed)</th>${base ? '<th>Baseline completed</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** One score cell: distribution bar, mean, sharper mean, and the change vs baseline. */
function scoreCell(s, d) {
  if (!s?.n) return '<td class="muted">–</td>';
  const sharp = s.sharp ? ` <span class="muted" title="Sharper scoring (lower temperature): same answers, less pulled toward 3">sharp ${fmt(s.sharp.mean)}</span>` : '';
  const delta = d && Number.isFinite(d.delta)
    ? `<div class="small"><span class="delta ${d.delta > 0 ? 'up' : d.delta < 0 ? 'down' : ''}">${signed(d.delta)}</span>${Number.isFinite(d.sharpDelta) ? ` <span class="muted">sharp ${signed(d.sharpDelta)}</span>` : ''} <span class="muted">KS ${fmt(d.ks)}</span></div>`
    : '';
  return `<td>${distBar(s.pmf)}<div class="score">${fmt(s.mean)}${sharp} <span class="muted">n=${s.n}</span></div>${delta}</td>`;
}

function scoresSection(run, cmp) {
  const journeys = Object.keys(run.scores);
  const qs = Object.keys(run.scores.all ?? run.scores[journeys[0]] ?? {});
  const head = `<tr><th>Task</th>${qs.map((q) => `<th>${esc(labelOf(q))}</th>`).join('')}</tr>`;
  const rows = journeys
    .map((j) => `<tr><th scope="row">${esc(j === 'all' ? 'All tasks' : run.journeyLabels[j] ?? j)}</th>${qs.map((q) => scoreCell(run.scores[j][q], cmp?.scores?.[j]?.[q])).join('')}</tr>`)
    .join('');
  return `<div class="tw"><table class="scores"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
<p class="legend">${[1, 2, 3, 4, 5].map((n) => `<span><i style="background:${LIKERT_COLORS[n - 1]}"></i>${n}</span>`).join('')} Each bar is the panel's SSR distribution over 1–5; the number is its mean${run.sharpTemperature ? `, and "sharp" is the same answers scored at T = ${run.sharpTemperature}, which pulls less toward 3` : ''}.${cmp ? ' Δ is this build minus the baseline; KS similarity 1.00 means identical distributions.' : ''}</p>`;
}

/** End-of-week verdicts: one per participant, relative to what they use now. */
function weekSection(run, cmp, baseline) {
  if (!run.weekScores?.all) return '';
  const all = run.weekScores.all;
  const qs = WEEK_QUESTIONS.filter((q) => all[q.id]);
  const table = `<div class="tw"><table class="scores"><thead><tr><th></th>${qs.map((q) => `<th>${esc(q.label)}</th>`).join('')}</tr></thead><tbody><tr><th scope="row">All participants</th>${qs
    .map((q) => scoreCell(all[q.id], cmp?.weekScores?.all?.[q.id]))
    .join('')}</tr></tbody></table></div>`;
  const rows = (run.weekReviews ?? [])
    .map((w) => {
      const p = run.personas[w.personaId] ?? { name: w.personaId };
      const m = (q) => (w.scores?.[q] ? fmt(w.scores[q].reduce((s, x, i) => s + x * (i + 1), 0), 1) : '–');
      return `<tr><th scope="row">${esc(p.name)}</th><td class="small"><strong>“${esc(w.review.switch)}”</strong> <span class="muted">(${m('switch')})</span>${w.review.switch_why ? `<div>${esc(w.review.switch_why)}</div>` : ''}</td><td class="small"><strong>“${esc(w.review.pay_price)}”</strong> <span class="muted">(${m('pay_price')})</span>${w.review.pay_price_why ? `<div>${esc(w.review.pay_price_why)}</div>` : ''}</td><td class="small">${esc(w.review.dealbreaker)}</td></tr>`;
    })
    .join('');
  const note = baseline && !baseline.weekScores ? '<p class="muted small">The baseline run predates the end-of-week review, so there is nothing to compare these with yet.</p>' : '';
  return `<h2>End of week: would they switch?</h2>
<p class="muted">After all of their sessions, each participant gave one verdict, judged against what they use now (another app, a notebook, or nothing) and against the real ${esc(qs.find((q) => q.id === 'pay_price')?.label.replace('Would pay ', '') ?? 'price')}.</p>
${table}${note}
<div class="tw" style="margin-top:12px"><table class="people"><thead><tr><th>Participant</th><th>Would they switch?</th><th>Would they pay?</th><th>Dealbreaker</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function participants(run) {
  const ids = Object.keys(run.personas);
  const journeys = Object.keys(run.completion);
  const icon = { completed: '<span class="ok" title="Completed">✓</span>', gave_up: '<span class="bad" title="Gave up">✕</span>', error: '<span class="muted" title="Harness error">!</span>' };
  const rows = ids
    .map((id) => {
      const p = run.personas[id];
      const rs = run.results.filter((r) => r.personaId === id);
      if (!rs.length) return '';
      const week = run.weekReviews?.find((w) => w.personaId === id)?.review.switch;
      const quote = week ?? rs.find((r) => r.review?.keep_using)?.review.keep_using ?? '';
      return `<tr><th scope="row">${esc(p.name)}, ${esc(p.age)}<div class="muted small">${esc(p.tagline)}</div></th>${journeys
        .map((j) => {
          const r = rs.find((x) => x.journeyId === j);
          return `<td class="c">${r ? icon[r.outcome] ?? '' : ''}</td>`;
        })
        .join('')}<td class="small">“${esc(quote)}”</td></tr>`;
    })
    .join('');
  return `<div class="tw"><table class="people"><thead><tr><th>Participant</th>${journeys.map((j) => `<th class="c">${esc(run.journeyLabels[j] ?? j)}</th>`).join('')}<th>${run.weekReviews?.length ? 'Would they switch?' : 'Would they keep using it?'}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function changesSection(cmp, run, baseline, basePrefix) {
  const { persisting, added, resolved } = cmp.frictions;
  const li = (c, extra = '') => `<li><strong>${esc(c.label)}</strong> <span class="muted">(${c.personaCount} participants · <code>${esc(c.screen)}</code>)</span>${extra}</li>`;
  return `<div class="grid3">
  <div><h3>New in this build (${added.length})</h3><ul>${added.slice(0, 10).map((c) => li(c)).join('') || '<li class="muted">None</li>'}</ul></div>
  <div><h3>Gone since baseline (${resolved.length})</h3><ul>${resolved.slice(0, 10).map((c) => li(c)).join('') || '<li class="muted">None</li>'}</ul></div>
  <div><h3>Still present (${persisting.length})</h3><ul>${persisting.slice(0, 10).map((p) => li(p.b, ` <span class="delta ${p.personaDelta < 0 ? 'up' : p.personaDelta > 0 ? 'down' : ''}">${signed(p.personaDelta, 0)} participants</span>`)).join('') || '<li class="muted">None</li>'}</ul></div>
</div>`;
}

function envSection(run) {
  const errs = new Map();
  for (const r of run.results) for (const e of r.envErrors ?? []) errs.set(e, (errs.get(e) ?? 0) + 1);
  const failed = run.results.filter((r) => r.outcome === 'error');
  if (!errs.size && !failed.length) return '';
  return `<h2>Test environment problems</h2><p class="muted">These come from the local test setup, not the app's design. Issues on the same screens may be caused by them.</p><ul>${[...errs]
    .map(([m, n]) => `<li><code>${esc(m)}</code> <span class="muted">(${n} session${n === 1 ? '' : 's'})</span></li>`)
    .join('')}${failed.map((r) => `<li>Session <code>${esc(r.taskId)}</code> did not run: ${esc(r.error)}</li>`).join('')}</ul>`;
}

export function renderReport(run, { baseline = null, basePrefix = '' } = {}) {
  // Frictions compare whenever the embedding model matches; scores only on
  // questions whose anchors match (ease and polish carry across the move to
  // end-of-week reviews; the week questions start fresh).
  const comparable = !!baseline && baseline.embed === run.embed;
  const sharedQs = comparable ? comparableQuestions(baseline, run, LEGACY_ANCHOR_HASHES) : [];
  const cmp = comparable ? compareRuns(baseline, run, { questions: sharedQs }) : null;
  const runQs = [...Object.keys(run.scores?.all ?? {}), ...Object.keys(run.weekScores?.all ?? {})];
  const notShared = runQs.filter((q) => !sharedQs.includes(q));
  const headline = run.weekScores?.all?.switch ? 'switch' : 'keep_using';
  const headCell = (run.weekScores?.all ?? run.scores.all ?? {})[headline];
  const headDelta = (headline === 'switch' ? cmp?.weekScores?.all : cmp?.scores?.all)?.[headline]?.delta;
  const ro = run.readout ?? { executive_summary: [], issues: [], liked_themes: [], simpler_themes: [] };
  const roByIndex = Object.fromEntries((ro.issues ?? []).map((x) => [x.index, x]));
  const issues = run.frictions.slice(0, 15);
  const totalSessions = run.results.length;
  const completed = run.results.filter((r) => r.outcome === 'completed').length;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HyperTrack Panel Readout</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6a65;--card:#fff;--line:#e4e1d8;--accent:#3d5afe;--ok:#1b7f4b;--bad:#b3261e;--warn:#a15c00;
--l1:#c2412d;--l2:#e39b7f;--l3:#c9c6bd;--l4:#7fb08f;--l5:#2e7d4f}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#141413;--fg:#ecebe6;--muted:#a09e96;--card:#1e1e1c;--line:#34332f;--accent:#8c9eff;--ok:#5cc28a;--bad:#ef7a6f;--warn:#e0a54a;--l3:#5b5a55}}
:root[data-theme="dark"]{--bg:#141413;--fg:#ecebe6;--muted:#a09e96;--card:#1e1e1c;--line:#34332f;--accent:#8c9eff;--ok:#5cc28a;--bad:#ef7a6f;--warn:#e0a54a;--l3:#5b5a55}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:32px 16px 64px}h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px;padding-top:8px;border-top:1px solid var(--line)}h3{font-size:16px;margin:0}
.muted{color:var(--muted)}.small{font-size:13px}code{font-size:12.5px;background:var(--line);padding:1px 5px;border-radius:4px}
.banner{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--warn);padding:10px 14px;border-radius:8px;margin:16px 0}
.kpis{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px;min-width:150px}.kpi b{display:block;font-size:24px}
table{width:100%;border-collapse:collapse;background:var(--card)}.tw{border:1px solid var(--line);border-radius:10px;overflow-x:auto}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}thead th{font-size:12.5px;color:var(--muted);font-weight:600}td.c,th.c{text-align:center}
.issue{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0;border-left:4px solid var(--line)}
.sev-blocker{border-left-color:var(--bad)}.sev-major{border-left-color:var(--warn)}.issue-head{display:flex;gap:10px;align-items:center}
.num{font-weight:700;color:var(--muted)}.pill{margin-left:auto;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:2px 8px}
.meta{margin:6px 0 10px;color:var(--muted);font-size:13.5px}.issue-body{display:grid;grid-template-columns:1fr 180px;gap:16px}
.issue-body img{width:180px;border-radius:12px;border:1px solid var(--line)}blockquote{margin:0 0 8px;padding-left:10px;border-left:3px solid var(--line)}
cite{display:block;font-style:normal;font-size:12.5px;color:var(--muted)}.rec{background:var(--bg);padding:8px 10px;border-radius:8px}.who{font-size:12.5px;color:var(--muted)}.env-note{border:1px dashed var(--warn);color:var(--fg);padding:6px 10px;border-radius:8px;font-size:13.5px}
.dist{display:flex;height:12px;border-radius:6px;overflow:hidden;min-width:120px}.dist span{display:block;height:100%}.score{font-size:13px;margin-top:4px}
.legend{font-size:12.5px;color:var(--muted)}.legend span{margin-right:10px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.delta.up{color:var(--ok)}.delta.down{color:var(--bad)}.ok{color:var(--ok);font-weight:700}.bad{color:var(--bad);font-weight:700}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.grid3>div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
ul{padding-left:20px}
@media (max-width:700px){.issue-body{grid-template-columns:1fr}.issue-body img{width:100%;max-width:260px}.grid3{grid-template-columns:1fr}}
</style></head><body><main>
<h1>HyperTrack synthetic panel readout</h1>
<p class="muted">${esc(run.label || run.runId)}${run.lens ? ` · <strong>${esc(run.lens)} lens</strong>` : ''} · ${esc(run.createdAt.slice(0, 16).replace('T', ' '))} · build <code>${esc(run.gitSha || 'unknown')}</code>${baseline ? ` · compared with <code>${esc(baseline.label || baseline.runId)}</code>` : ''}</p>
<div class="banner"><strong>Read this as relative, not absolute.</strong> Participants are AI personas, not people, and the scores are semantic-similarity ratings (Maier et al., arXiv 2510.08338) without a human baseline. They are useful for comparing builds and for finding friction; they are <em>not</em> predicted App Store ratings.${baseline && !comparable ? ' <strong>The baseline used a different embedding model, so scores and issues are not compared.</strong>' : ''}${comparable && notShared.length ? ` <strong>Scores are compared only where both runs asked the same question with the same reference statements${sharedQs.length ? ` (${esc(sharedQs.map(labelOf).join(', '))})` : ''}; ${esc(notShared.map(labelOf).join(', '))} ${notShared.length === 1 ? 'is' : 'are'} new or changed since the baseline.</strong>` : ''}${
  baseline && comparable && (baseline.lens ?? null) !== (run.lens ?? null)
    ? ` <strong>The two runs used different lenses (${esc(baseline.lens ?? 'none')} vs ${esc(run.lens ?? 'none')}): personas were asked to look for different things, so treat score shifts with extra care.</strong>`
    : ''
}</div>
<div class="kpis">
 <div class="kpi"><span class="muted">Participants</span><b>${run.panel.personas}</b></div>
 <div class="kpi"><span class="muted">Sessions</span><b>${totalSessions}</b></div>
 <div class="kpi"><span class="muted">Tasks completed</span><b>${pct(completed, totalSessions)}</b></div>
 <div class="kpi"><span class="muted">Distinct issues</span><b>${run.frictions.length}</b></div>
 <div class="kpi"><span class="muted">${esc(headline === 'switch' ? 'Would switch (mean, 1–5)' : 'Keep-using (mean, 1–5)')}</span><b>${fmt(headCell?.mean)}</b>${headCell?.sharp ? `<span class="muted small">sharp ${fmt(headCell.sharp.mean)}</span> ` : ''}${Number.isFinite(headDelta) ? `<span class="delta ${headDelta >= 0 ? 'up' : 'down'}">${signed(headDelta)}</span>` : ''}</div>
</div>
${ro.executive_summary?.length ? `<h2>Summary</h2><ul>${ro.executive_summary.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
${cmp ? `<h2>What changed since the baseline</h2>${changesSection(cmp, run, baseline, basePrefix)}` : ''}
<h2>Task success</h2>${completionTable(run, cmp ? baseline : null)}
<h2>Top issues</h2><p class="muted">Ranked by how many participants hit the same problem on the same screen (similar complaints are grouped by meaning), then by severity.</p>
${issues.map((c, i) => issueCard(c, i, run, roByIndex[i + 1], '')).join('') || '<p class="muted">No issues reported.</p>'}
${ro.liked_themes?.length ? `<h2>What participants liked</h2><ul>${ro.liked_themes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
${ro.simpler_themes?.length ? `<h2>How tasks could be simpler</h2><ul>${ro.simpler_themes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
${weekSection(run, cmp, baseline)}
<h2>Participants</h2>${participants(run)}
<h2>Scores per task</h2>${scoresSection(run, cmp)}
${envSection(run)}
<h2>Method</h2>
<p class="small">Each participant is an LLM persona (<code>${esc(run.model)}</code>) driving the real app in a 390×844 browser against a local database, using only the on-screen accessibility tree and screenshots. After each task it writes a free-text review of that task${run.weekReviews?.length ? ', and after all of its tasks one end-of-week verdict on switching and paying, judged against what it uses now' : ''}; each answer is embedded (<code>${esc(run.embed)}</code>) and compared with ${QUESTIONS[0].anchorSets.length} sets of five reference statements per question, giving a 1–5 distribution (SSR, minimum-similarity subtraction, ε = 0, T = 1, averaged over sets${run.sharpTemperature ? `; the "sharp" figures use T = ${run.sharpTemperature}` : ''}). Issues are participant-reported friction, clustered per screen by embedding similarity. Anchor set hash <code>${esc(run.anchorsHash)}</code>${run.storiesHash ? `, stories hash <code>${esc(run.storiesHash)}</code>` : ''}. Run cost ≈ $${fmt(run.cost?.dollars)}.</p>
<p class="small muted">Known limits: personas are written by us, not sampled from real users; the paper validated SSR only for purchase intent against human surveys, not for usability questions; some friction can come from the local test setup (no camera, no third-party food APIs) — check the screenshot before acting on an issue.</p>
</main></body></html>`;
}
