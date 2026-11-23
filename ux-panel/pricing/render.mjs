/**
 * Renders pricing.json as a self-contained HTML readout. Pure: object in,
 * HTML string out. Every number is labelled RELATIVE: synthetic personas
 * rank options against each other; they do not forecast take-up or revenue
 * (PRICING_STUDY.md, "Why relative, not absolute").
 */
import { shares } from '../personas/pricing.mjs';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const money = (x) => (Number.isFinite(x) ? `$${x.toFixed(2)}` : '–');
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '–');
const num = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '–');

/** Categorical slots in fixed order (dataviz reference palette), by group id. */
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)'];

function groupRows(analysis, kind) {
  return Object.entries(analysis.groups).filter(([, g]) => (kind === 'all' ? g.kind === 'all' : g.kind === kind));
}

/** Van Westendorp ranges on a shared $ axis: bar = acceptable range, dot = OPP. */
function vwTable(analysis) {
  const rows = Object.entries(analysis.groups);
  const max = Math.max(15, ...rows.map(([, g]) => g.vw.pme ?? 0), ...rows.map(([, g]) => g.vw.medians?.tooExpensive ?? 0)) * 1.05;
  const x = (v) => (100 * v) / max;
  const tr = rows
    .map(([, g]) => {
      const v = g.vw;
      const bar =
        v.pmc != null && v.pme != null
          ? `<svg class="range" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="Acceptable ${money(v.pmc)} to ${money(v.pme)}, optimal ${money(v.opp)}"><rect x="${x(v.pmc).toFixed(2)}" y="3" width="${Math.max(0.6, x(v.pme) - x(v.pmc)).toFixed(2)}" height="4" rx="2" fill="var(--s1)"><title>Acceptable ${money(v.pmc)}–${money(v.pme)}</title></rect>${v.opp != null ? `<circle cx="${x(v.opp).toFixed(2)}" cy="5" r="2.4" fill="var(--fg)" stroke="var(--card)" stroke-width="0.8" vector-effect="non-scaling-stroke"><title>Optimal price point ${money(v.opp)}</title></circle>` : ''}</svg>`
          : '<span class="muted">too few complete answers</span>';
      return `<tr><th scope="row">${esc(g.label)}</th><td>${v.n}${v.dropped ? ` <span class="muted">(${v.dropped} dropped)</span>` : ''}</td><td>${money(v.pmc)}–${money(v.pme)}</td><td><strong>${money(v.opp)}</strong></td><td>${money(v.ipp)}</td><td class="bar">${bar}</td></tr>`;
    })
    .join('');
  const ticks = [0, 5, 10, 15, 20, 25, 30, 40, 50].filter((t) => t <= max);
  return `<div class="tw"><table><thead><tr><th>Group</th><th>n</th><th>Acceptable range</th><th>Optimal (OPP)</th><th>Indifference</th><th class="bar">Range on $0–$${Math.round(max)} <span class="axis">${ticks.map((t) => `<i style="left:${x(t)}%">$${t}</i>`).join('')}</span></th></tr></thead><tbody>${tr}</tbody></table></div>`;
}

/** Take-rate curves: one line per group, price on x, take-rate on y. */
function lineChart(series, prices, { yLabel = 'Share saying yes', valueFn = (r) => r.yesShare } = {}) {
  const W = 640;
  const H = 260;
  const L = 44;
  const R = 110;
  const T = 26;
  const B = 34;
  const vals = series.flatMap((s) => s.rows.map(valueFn)).filter(Number.isFinite);
  const yMax = Math.min(1, Math.max(0.1, ...vals) * 1.15);
  const px = (p) => L + ((p - prices[0]) / (prices.at(-1) - prices[0] || 1)) * (W - L - R);
  const py = (v) => T + (1 - v / yMax) * (H - T - B);
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => f * yMax)
    .map((v) => `<line x1="${L}" x2="${W - R}" y1="${py(v)}" y2="${py(v)}" class="grid"/><text x="${L - 6}" y="${py(v) + 4}" text-anchor="end" class="tick">${pct(v)}</text>`)
    .join('');
  const xt = prices.map((p) => `<text x="${px(p)}" y="${H - B + 18}" text-anchor="middle" class="tick">${money(p)}</text>`).join('');
  // End-of-line labels, nudged apart (≥ 13px) so equal end values don't overprint.
  const ends = series
    .map((s, i) => {
      const last = s.rows.filter((r) => Number.isFinite(valueFn(r))).at(-1);
      return last ? { i, x: px(last.price) + 8, y: py(valueFn(last)) + 4 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 13);
  const labelAt = Object.fromEntries(ends.map((e) => [e.i, e]));
  const lines = series
    .map((s, i) => {
      const pts = s.rows.filter((r) => Number.isFinite(valueFn(r)));
      if (!pts.length) return '';
      const color = SERIES[i % SERIES.length];
      const d = pts.map((r, k) => `${k ? 'L' : 'M'}${px(r.price).toFixed(1)},${py(valueFn(r)).toFixed(1)}`).join('');
      const tip = (r) => `<title>${esc(s.label)} at ${money(r.price)}: ${pct(valueFn(r))} (n=${r.n})</title>`;
      return `<g><path d="${d}" fill="none" stroke="${color}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="5 4"' : ''}/>${pts
        .map((r) => `<circle cx="${px(r.price).toFixed(1)}" cy="${py(valueFn(r)).toFixed(1)}" r="4" fill="${color}" stroke="var(--card)" stroke-width="2">${tip(r)}</circle><circle cx="${px(r.price).toFixed(1)}" cy="${py(valueFn(r)).toFixed(1)}" r="11" fill="transparent">${tip(r)}</circle>`)
        .join('')}<text x="${labelAt[i].x}" y="${labelAt[i].y.toFixed(1)}" class="dlabel">${esc(s.label)}</text></g>`;
    })
    .join('');
  const legend = series.map((s, i) => `<span><i style="background:${SERIES[i % SERIES.length]}"></i>${esc(s.label)}</span>`).join('');
  return `<figure><svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(yLabel)} by monthly price">${grid}${xt}${lines}<text x="${L}" y="${T - 12}" class="tick">${esc(yLabel)}</text></svg><figcaption class="legend">${legend}</figcaption></figure>`;
}

function ggSection(analysis) {
  const groups = [...groupRows(analysis, 'all'), ...groupRows(analysis, 'segment')];
  const prices = analysis.groups.all.gg.map((r) => r.price);
  const chart = lineChart(
    groups.map(([, g], i) => ({ label: g.label, rows: g.gg, dashed: i === 0 })),
    prices,
  );
  const head = `<tr><th>Group</th>${prices.map((p) => `<th>${money(p)}</th>`).join('')}</tr>`;
  const rows = (fn) => groups.map(([, g]) => `<tr><th scope="row">${esc(g.label)} <span class="muted">n=${g.n}</span></th>${g.gg.map(fn).join('')}</tr>`).join('');
  const best = (g) => Math.max(...g.gg.map((r) => r.index).filter(Number.isFinite));
  return `${chart}
<h3>Share saying yes · SSR take-rate (top-two-box mass)</h3>
<div class="tw"><table><thead>${head}</thead><tbody>${rows((r) => `<td>${pct(r.take)} <span class="muted">· ${pct(r.yesShare)} yes</span></td>`)}</tbody></table></div>
<h3>Relative revenue per 100 personas (index: best price in the row = 100)</h3>
<div class="tw"><table><thead>${head}</thead><tbody>${groups
    .map(([, g]) => `<tr><th scope="row">${esc(g.label)}</th>${g.gg.map((r) => `<td class="${r.index === best(g) ? 'best' : ''}">${num(r.index)} <span class="muted">· $${num(r.revenuePer100)}</span></td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>
<p class="note">Revenue = price × share saying yes × 100 personas, per month (the SSR take-rate keeps a floor of mass on "yes" even for a flat no, which would always favour the top price). It ranks prices within a group; it is not money anyone will pay.</p>`;
}

function plansSection(analysis) {
  const groups = [...groupRows(analysis, 'all'), ...groupRows(analysis, 'segment')];
  const a = analysis.groups.all;
  const annualHead = `<tr><th>Group</th>${a.annual.map((r) => `<th>${r.multiple}× monthly</th>`).join('')}<th>Median acceptable monthly</th></tr>`;
  const annual = groups.map(([, g]) => `<tr><th scope="row">${esc(g.label)}</th>${g.annual.map((r) => `<td>${pct(r.take)} <span class="muted">· ${pct(r.yesShare)} yes · avg ${money(r.meanPrice)}</span></td>`).join('')}<td>${money(g.acceptableMedian)}</td></tr>`).join('');
  const lifeHead = `<tr><th>Group</th>${a.lifetime.map((r) => `<th>${money(r.price)} once</th>`).join('')}</tr>`;
  const life = groups.map(([, g]) => `<tr><th scope="row">${esc(g.label)}</th>${g.lifetime.map((r) => `<td>${pct(r.take)} <span class="muted">· ${pct(r.yesShare)} yes</span></td>`).join('')}</tr>`).join('');
  return `<h3>Annual, at 4×, 6× and 8× each persona's acceptable monthly price</h3><div class="tw"><table><thead>${annualHead}</thead><tbody>${annual}</tbody></table></div>
<p class="note">A persona's acceptable monthly price is the highest Gabor-Granger price they said yes to (else their "bargain" threshold, else the lowest tested price), so the offered annual prices differ per persona; "avg" is the mean offer.</p>
<h3>Lifetime</h3><div class="tw"><table><thead>${lifeHead}</thead><tbody>${life}</tbody></table></div>`;
}

function packagesSection(analysis, design) {
  const groups = [...groupRows(analysis, 'all'), ...groupRows(analysis, 'segment'), ...groupRows(analysis, 'experience')];
  const ids = [...design.packages.map((v) => v.id), 'none', 'unclear'];
  const name = (id) => design.packages.find((v) => v.id === id)?.name ?? (id === 'none' ? 'None' : 'Unclear');
  const color = (i) => (i < design.packages.length ? SERIES[i] : i === design.packages.length ? 'var(--neutral)' : 'var(--line)');
  const stacked = (g) =>
    `<div class="stack" role="img" aria-label="${esc(ids.map((id) => `${name(id)} ${pct(g.packages.shares[id])}`).join(', '))}">${ids
      .map((id, i) => (g.packages.shares[id] > 0 ? `<span style="width:${(g.packages.shares[id] * 100).toFixed(1)}%;background:${color(i)}" title="${esc(`${name(id)}: ${pct(g.packages.shares[id])}`)}"></span>` : ''))
      .join('')}</div>`;
  const legend = ids.map((id, i) => `<span><i style="background:${color(i)}"></i>${esc(id === 'none' || id === 'unclear' ? name(id) : `${id} ${name(id)}`)}</span>`).join('');
  const rows = groups
    .map(([, g]) => `<tr><th scope="row">${esc(g.label)} <span class="muted">n=${g.n}</span></th><td class="bar">${stacked(g)}</td>${ids.map((id) => `<td>${pct(g.packages.shares[id])}</td>`).join('')}</tr>`)
    .join('');
  const variants = design.packages.map((v) => `<li><strong>${v.id}</strong> ${esc(v.name)}, ${money(v.price)}/month: ${esc(v.features.join('; '))}</li>`).join('');
  const t = analysis.tipping;
  const list = (pairs) => (pairs.length ? `<ol>${pairs.map(([k, c]) => `<li>${esc(k)} <span class="muted">(${c})</span></li>`).join('')}</ol>` : '<p class="muted">None.</p>');
  const feat = analysis.features.map((f) => `<tr><th scope="row">${esc(f.feature)}</th><td><div class="hbar"><span style="width:${(100 * (f.score || 0)).toFixed(1)}%"></span></div></td><td>${num(f.score, 2)}</td></tr>`).join('');
  const takeHead = `<tr><th>Group</th>${design.packages.map((v) => `<th>${v.id}</th>`).join('')}</tr>`;
  const takeRows = groups.map(([, g]) => `<tr><th scope="row">${esc(g.label)}</th>${design.packages.map((v) => `<td>${pct(g.packages.take[v.id])} <span class="muted">· ${pct(g.packages.yesShare[v.id])} yes</span></td>`).join('')}</tr>`).join('');
  return `<ul class="variants">${variants}</ul>
<h3>Which one they'd pay for ("would you pay, and for which?")</h3>
<p class="legend">${legend}</p>
<div class="tw"><table><thead><tr><th>Group</th><th class="bar">Share</th>${ids.map((id) => `<th>${esc(id === 'none' ? 'None' : id === 'unclear' ? '?' : id)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
<h3>Would pay for each option (take-rate · share saying yes)</h3>
<div class="tw"><table><thead>${takeHead}</thead><tbody>${takeRows}</tbody></table></div>
<div class="two"><div><h3>What tips a "no" into a "yes"</h3><p class="note">${t.noOnBase} personas would not pay for today's Pro (V1). Of them, how many would pay for each other option, by what it adds:</p>${list(t.byVariant)}</div>
<div><h3>"The one thing that would make me pay"</h3><p class="note">Answers of those same ${t.noOnBase}, matched to the nearest feature by embedding similarity:</p>${list(t.oneThing)}</div></div>
<h3>Feature ranking (Borda: 1 = always first, 0 = always last)</h3>
<div class="tw"><table><tbody>${feat}</tbody></table></div>`;
}

function quotaCheck(run) {
  const ps = run.personas;
  const q = run.quotas;
  const row = (label, target, obs) => `<tr><th scope="row">${esc(label)}</th>${Object.keys(target).map((k) => `<td>${esc(k)} ${pct(obs[k] ?? 0)} <span class="muted">(${pct(target[k] / Object.values(target).reduce((s, x) => s + x, 0))})</span></td>`).join('')}</tr>`;
  const rows = [
    row('Segment', q.segment, shares(ps, 'segment')),
    row('Income', q.income, shares(ps, 'income')),
    row('Experience', q.experience, shares(ps, 'experienceLevel')),
    ...Object.keys(q.segment).map((s) => row(`Gender · ${s}`, q.gender[s], shares(ps, 'gender', (p) => p.pricing.segment === s))),
    ...Object.keys(q.segment).map((s) => row(`Age · ${s}`, q.age[s], shares(ps, 'ageBand', (p) => p.pricing.segment === s))),
    ...Object.keys(q.segment).map((s) => row(`Current app · ${s}`, q.currentApp[s], shares(ps, 'currentApp', (p) => p.pricing.segment === s))),
  ];
  return `<div class="tw"><table class="small"><tbody>${rows.join('')}</tbody></table></div><p class="note">Observed share (target in brackets). Quotas live in <code>ux-panel/personas/pricing.mjs</code>.</p>`;
}

function tierBlock(title, analysis, design, intro = '') {
  return `<section><h2>${esc(title)}</h2>${intro}
<h3>Van Westendorp: acceptable monthly price per segment and experience</h3>${vwTable(analysis)}
<p class="note">Acceptable range = marginal cheapness (too cheap ∩ not cheap) to marginal expensiveness (too expensive ∩ not expensive); the dot is the optimal price point (too cheap ∩ too expensive). Answers whose four thresholds were missing or out of order are dropped.</p>
<h3>Gabor-Granger: would they start a subscription at each price?</h3>${ggSection(analysis)}
${plansSection(analysis)}
<h3>Package variants</h3>${packagesSection(analysis, design)}</section>`;
}

export function renderPricingReport(run) {
  const a = run.analysis.survey;
  const r = a.recommendation;
  const design = run.design;
  const agree = run.analysis.tierAgreement;
  const hands = run.analysis.handsOn;
  const kpi = (label, value, sub = '') => `<div class="kpi"><div class="kl">${esc(label)}</div><div class="kv">${value}</div><div class="ks">${sub}</div></div>`;
  const pkgName = (id) => (id ? `${id} ${esc(design.packages.find((v) => v.id === id)?.name ?? '')}` : '–');
  const competitors = design.competitors.map((c) => `${esc(c.name)} ${money(c.monthly)}/mo · ${money(c.yearly)}/yr`).join(' · ');
  const agreeText = agree
    ? `<p>For the ${hands.n} personas who used the app first, the price order ${agree.priceOrder == null ? 'could not be compared' : `correlates ρ = ${agree.priceOrder.toFixed(2)} with their survey answers`}, the package order ρ = ${agree.packageOrder == null ? '–' : agree.packageOrder.toFixed(2)}; recommended price ${agree.samePrice ? 'is the same' : `differs (${money(hands.recommendation.price)} after use)`}, package ${agree.samePackage ? 'is the same' : `differs (${pkgName(hands.recommendation.package)} after use)`}. ${agree.samePrice && agree.samePackage ? '' : 'Where they disagree, the plan says to trust hands-on.'}</p>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pricing Study Readout</title>
<style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6a65;--card:#fff;--line:#e4e1d8;--neutral:#b9b6ac;--warn:#a15c00;
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--s6:#008300;--s7:#6250d6}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#141413;--fg:#ecebe6;--muted:#a09e96;--card:#1a1a19;--line:#34332f;--neutral:#5b5a55;--warn:#e0a54a;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#0ca30c;--s7:#9085e9}}
:root[data-theme="dark"]{--bg:#141413;--fg:#ecebe6;--muted:#a09e96;--card:#1a1a19;--line:#34332f;--neutral:#5b5a55;--warn:#e0a54a;--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--s6:#0ca30c;--s7:#9085e9}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1060px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:20px;margin:36px 0 8px;padding-top:12px;border-top:1px solid var(--line)}h3{font-size:15.5px;margin:22px 0 8px}
.muted,.note{color:var(--muted)}.note{font-size:13.5px}.caveat{border:1px dashed var(--warn);border-radius:10px;padding:10px 14px;margin:14px 0;background:var(--card)}
.summary{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;font-size:16px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:14px 0}.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px}.kl{font-size:12.5px;color:var(--muted)}.kv{font-size:19px;font-weight:650;line-height:1.25}.ks{font-size:12.5px;color:var(--muted)}
.tw{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:middle;white-space:nowrap}thead th{font-weight:600;color:var(--muted);font-size:12.5px}tbody tr:last-child>*{border-bottom:0}
td.best{font-weight:700}td.bar,th.bar{min-width:220px;width:30%;position:relative}.range{width:100%;height:14px;display:block}
.axis{position:relative;display:block;height:14px;margin-top:2px}.axis i{position:absolute;font-style:normal;font-size:10.5px;transform:translateX(-50%);font-weight:400}
.chart{width:100%;height:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}.grid{stroke:var(--line);stroke-width:1}.tick{fill:var(--muted);font-size:11px}.dlabel{fill:var(--fg);font-size:11.5px}
figure{margin:0}.legend{display:flex;flex-wrap:wrap;gap:12px;font-size:13px;color:var(--muted);margin:6px 0}.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.stack{display:flex;height:12px;border-radius:4px;overflow:hidden;gap:2px;background:var(--card)}.stack span{display:block;height:100%}
.hbar{background:var(--line);border-radius:4px;height:8px;min-width:160px}.hbar span{display:block;height:100%;background:var(--s1);border-radius:4px}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}.variants{padding-left:18px}.small td{white-space:normal}
details{margin-top:10px}summary{cursor:pointer;color:var(--muted)}
</style></head><body><main>
<h1>Pricing study${run.label ? `: ${esc(run.label)}` : ''}</h1>
<p class="muted">Run ${esc(run.runId)} · ${esc(run.createdAt?.slice(0, 16).replace('T', ' '))} · ${run.n} synthetic personas (seed ${esc(run.seed)}) · model ${esc(run.model)} · embeddings ${esc(run.embed)} · tour shown as ${run.tour.mode === 'images' ? 'screenshots' : 'captions + visible text'} · cost ≈ $${num(run.cost?.dollars + (run.handsOnRun?.cost?.dollars ?? 0), 2)}</p>
<div class="caveat"><strong>Relative, not a forecast.</strong> These are language-model personas, not customers. Their price answers are plausible but unreliable in absolute terms and compressed toward the middle; read every number as "option A beats option B for segment X", never as a take-up or revenue prediction. Confirm the winner with a real price test.${run.model === 'fake' ? ' <strong>This run used the scripted fake model: its numbers mean nothing.</strong>' : ''}</div>
<h2>Summary</h2>
<div class="kpis">${kpi('Recommended monthly price', money(r.price), r.inRange == null ? '' : r.inRange ? 'inside the acceptable range' : 'outside the acceptable range')}${kpi('Runner-up price', money(r.priceRunnerUp))}${kpi('Recommended package', pkgName(r.package))}${kpi('Runner-up package', pkgName(r.packageRunnerUp))}${kpi('Served worst', esc(r.worstSegment ?? '–'), 'at the recommended price')}</div>
<p class="summary">${esc(r.summary)}</p>
${agreeText}
${Number.isFinite(a.stanceAgreement?.rate) ? `<p class="note">Check on the scoring: on the ${a.stanceAgreement.n} would-buy answers that opened with a clear Yes or No, the SSR score agreed ${pct(a.stanceAgreement.rate)} of the time${a.stanceAgreement.rate < 0.85 ? '. That is low: trust the "yes" shares (which use the stated Yes/No) over the take-rates' : ''}.</p>` : ''}
${run.errors?.length ? `<p class="note">${run.errors.length} persona(s) failed and are left out: ${esc(run.errors.map((e) => `${e.personaId} (${e.tier})`).join(', '))}.</p>` : ''}
${tierBlock(`Survey tier: ${a.n} personas read the tour`, a, design)}
${hands ? tierBlock(`Hands-on tier: ${hands.n} personas used the app first`, hands, design, `<p class="note">The same questions, asked after the core journeys and the end-of-week review (<code>hands-on/report.html</code>). A small, quota-balanced subset: compare its ORDER of options with the survey's, not its levels.</p>`) : ''}
<section><h2>Method</h2>
<p>Each persona read a tour of six screens of the current build${run.tour.mode === 'images' ? ' (screenshots)' : ' (captions and visible text)'}, its own background and typical week, and this competitor price list in every prompt: ${competitors}. Questions were answered in free text. Price thresholds were parsed from the text; would-buy answers were mapped onto five anchor statements by semantic similarity (SSR, arXiv 2510.08338). Gabor-Granger prices were asked in a random order per persona, with the design stated openly. Take-rate is the panel's mean SSR mass on "probably / definitely yes"; "yes" counts a persona whose sharper (T = ${run.sharpTemperature}) score puts at least half its mass there.</p>
<p class="note">Anchor hashes: ${esc(Object.entries(run.anchorHashes).map(([k, v]) => `${k} ${v}`).join(' · '))}. Compare two runs only when these and the embeddings match.</p>
<h3>Sample vs quotas</h3>${quotaCheck(run)}
<details><summary>All ${run.personas.length} personas</summary><div class="tw"><table class="small"><tbody>${run.personas.map((p) => `<tr><th scope="row">${esc(p.name)}, ${p.age}</th><td>${esc(p.pricing.segment)} · ${esc(p.pricing.experienceLevel)} · ${esc(p.pricing.income)}</td><td>${esc(p.summary)}</td></tr>`).join('')}</tbody></table></div></details>
</section>
</main></body></html>`;
}
