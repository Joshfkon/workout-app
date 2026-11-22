/**
 * Thin wrapper over the Anthropic Messages API for the panel: one place for
 * the model choice, the usage/cost ledger, and a scripted fake for dry runs
 * that must not spend credits.
 */
import Anthropic from '@anthropic-ai/sdk';

/** $ per million tokens (first-party API). Cache writes bill at 1.25× input. */
export const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export const DEFAULT_MODEL = 'claude-opus-5-5';

export class Ledger {
  constructor() {
    this.calls = 0;
    this.byModel = {};
  }
  add(model, usage = {}) {
    this.calls += 1;
    const m = (this.byModel[model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    m.input += usage.input_tokens ?? 0;
    m.output += usage.output_tokens ?? 0;
    m.cacheRead += usage.cache_read_input_tokens ?? 0;
    m.cacheWrite += usage.cache_creation_input_tokens ?? 0;
  }
  dollars() {
    let total = 0;
    for (const [model, u] of Object.entries(this.byModel)) {
      const p = PRICES[model];
      if (!p) continue;
      total += (u.input * p.input + u.cacheWrite * p.input * 1.25 + u.cacheRead * p.cacheRead + u.output * p.output) / 1e6;
    }
    return total;
  }
  toJSON() {
    return { calls: this.calls, byModel: this.byModel, dollars: +this.dollars().toFixed(4) };
  }
}

/**
 * Real client. `call(params)` returns the Message; usage goes to the ledger.
 * Thinking stays on (it cannot be disabled on Opus 5.5); effort keeps it short.
 */
export function anthropicLLM({ model = DEFAULT_MODEL, effort = 'low', ledger = new Ledger() } = {}) {
  const client = new Anthropic();
  return {
    model,
    ledger,
    async call(params) {
      const msg = await client.messages.create({ model, max_tokens: 8000, output_config: { effort }, ...params });
      ledger.add(model, msg.usage);
      if (msg.stop_reason === 'refusal') throw new Error('model refused this step');
      return msg;
    },
  };
}

/**
 * Scripted stand-in for development (`--fake-llm`): taps the first few
 * buttons/links it sees, reports one friction, then finishes, and writes a
 * canned review. Exercises the whole pipeline at zero cost; its "findings"
 * mean nothing.
 */
export function fakeLLM({ ledger = new Ledger() } = {}) {
  let step = 0;
  return {
    model: 'fake',
    ledger,
    async call(params) {
      ledger.add('fake', {});
      const toolNames = params.tools.map((t) => t.name);
      const text = JSON.stringify(params.messages.at(-1).content);
      const use = (name, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `t${step}`, name, input }] });
      if (toolNames.includes('submit_review')) {
        return use('submit_review', {
          keep_using: 'Maybe, it was okay but I am not sure yet.',
          ease: 'Mostly easy to figure out, one or two confusing bits.',
          polish: 'It looks like a typical app.',
          pay: "I'm not sure whether I'd pay for this.",
          liked: 'Clean layout.',
          confusing: 'Not sure what some labels mean.',
          simpler: 'Fewer steps to get to the main action.',
        });
      }
      if (toolNames.includes('submit_readout')) {
        return use('submit_readout', { executive_summary: ['Fake readout.'], issues: [], liked_themes: [], simpler_themes: [] });
      }
      if (toolNames.includes('submit_stories')) {
        return use('submit_stories', {
          stories: [{ id: 'fake-story', title: 'Look around', goal: 'Open the app and look at Home.' }],
        });
      }
      step += 1;
      const ref = /\[ref=(e\d+)\]/.exec(text.slice(text.indexOf('button') > 0 ? text.indexOf('button') : 0))?.[1];
      if (step === 2) {
        return {
          stop_reason: 'tool_use',
          content: [
            { type: 'tool_use', id: `f${step}`, name: 'report_friction', input: { description: 'Fake friction: a label was unclear.', severity: 'minor', thought: 'Hmm.' } },
            { type: 'tool_use', id: `t${step}`, name: 'scroll', input: { direction: 'down', thought: 'Looking further down.' } },
          ],
        };
      }
      if (step >= 3 || !ref) return use('done', { outcome: 'completed', summary: 'Fake run finished.', thought: 'Done.' });
      return use('tap', { ref, thought: 'Trying this.' });
    },
  };
}

/** The tool_use blocks of a response, in order. */
export function toolUses(msg) {
  return msg.content.filter((b) => b.type === 'tool_use');
}
