/**
 * Guard: with beginner mode on, the workout screen's pieces never show
 * "RIR", "e1RM", "MEV", "MRV" or "AMRAP" — on the strip, in the logger, in
 * the sheets they open, the rest timer, or the in-workout toasts/popups.
 * (ExerciseCard as a whole is covered in ExerciseCard.test.tsx "round 10".)
 *
 * Also pins the three-answer effort question's mapping onto chip values.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuggestionBanner, type EffortCheck } from '../SuggestionBanner';
import { SetLoggerRow } from '../SetLoggerRow';
import { RestTimer } from '../RestTimer';
import { SanityCheckToast } from '../SanityCheckToast';
import { prCelebrationCopy } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/prCelebrationCopy';
import { plainWorkoutText } from '@/lib/beginnerMode';
import { useUserStore } from '@/stores/userStore';
import type { User } from '@/types/schema';

jest.mock('@/lib/integrations/notifications', () => ({
  lightHaptic: jest.fn(() => Promise.resolve()),
}));

const JARGON = /\bRIR\b|e1RM|\bMEV\b|\bMRV\b|AMRAP/i;

function setBeginner(on: boolean) {
  useUserStore.setState({
    user: {
      id: 'u1',
      email: '',
      createdAt: '',
      goal: 'maintenance',
      experience: on ? 'novice' : 'intermediate',
      enhancedAthleteMode: false,
      preferences: {
        units: 'kg',
        restTimerDefault: 180,
        showFormCues: true,
        showWarmupSuggestions: true,
        beginnerMode: on,
      },
      volumeLandmarks: {},
    } as User,
    isLoading: false,
  });
}

afterEach(() => useUserStore.setState({ user: null }));

/** Visible text plus every accessible name/title in the subtree. */
function allWords(root: Element): string {
  const attrs = Array.from(root.querySelectorAll('[aria-label],[title]'))
    .map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`)
    .join(' ');
  return `${root.textContent ?? ''} ${attrs}`;
}

const effort: EffortCheck = {
  predictedRir: 2,
  weightLabel: '60 kg',
  reps: 8,
  softened: false,
  reasoning: [
    'Capacity anchor: ~80 kg estimated 1RM — your best set (e1RM).',
    'Rep-max curve (Epley): at 60 kg, that capacity predicts about 10 reps to failure (0 RIR).',
  ],
};

describe('beginner mode jargon guard', () => {
  it('SuggestionBanner: strip and sheet', async () => {
    setBeginner(true);
    const user = userEvent.setup();
    render(
      <SuggestionBanner
        weightLabel="60 kg"
        repsLabel="8–12"
        rir={0}
        reason="working weight from your ~80 kg est. 1RM"
        source="From your recent sets on this lift"
        explanation={[
          'Prescribed from your best estimated 1RM (80 kg) for 8–12 reps at 2 RIR.',
          'Last set: push to failure (AMRAP) so the app can calibrate how you rate effort.',
          'Deload session: held out of PRs, e1RM trends and next session’s weight suggestion.',
        ]}
        effortCheck={effort}
        why={{ ref: null, rule: 'from_recent' }}
      />
    );
    expect(allWords(document.body)).not.toMatch(JARGON);
    await user.click(screen.getByTestId('why-this-weight'));
    expect(allWords(document.body)).not.toMatch(JARGON);
  });

  it('SetLoggerRow: question, answers, prediction sheet and set-type sheet', async () => {
    setBeginner(true);
    const user = userEvent.setup();
    render(
      <SetLoggerRow
        setNumber={1}
        weight="60"
        reps="8"
        onWeightChange={jest.fn()}
        onRepsChange={jest.fn()}
        onLog={jest.fn()}
        targetRir={2}
        effortCheck={effort}
      />
    );
    expect(allWords(document.body)).not.toMatch(JARGON);
    await user.click(screen.getByRole('button', { name: 'How this prediction works' }));
    expect(allWords(document.body)).not.toMatch(JARGON);
    expect(screen.getByTestId('predicted-rir-reasoning')).not.toHaveTextContent(/1RM/);
  });

  it('RestTimer: first-rest note and the rest tooltip', async () => {
    setBeginner(true);
    const user = userEvent.setup();
    render(
      <RestTimer
        seconds={170}
        initialSeconds={180}
        isRunning
        isFinished={false}
        onAddTime={jest.fn()}
        onSkip={jest.fn()}
        showIntro
      />
    );
    expect(screen.getByTestId('rest-intro-note')).toHaveTextContent(
      'Rest about 3 min between sets. −15s / +15s to change.'
    );
    await user.click(screen.getByRole('button', { name: 'Learn more about Rest Between Sets' }));
    expect(document.body).toHaveTextContent('Longer rest (2+ minutes)');
    expect(allWords(document.body)).not.toMatch(JARGON);
  });

  it('SanityCheckToast: effort in words', () => {
    setBeginner(true);
    render(
      <SanityCheckToast
        layout="inline"
        check={{
          type: 'protect_tier_warning',
          severity: 'warning',
          message: 'Close to failure on Squat.',
          suggestion: 'Keep 2+ RIR on heavy compounds.',
        } as never}
        onDismiss={jest.fn()}
      />
    );
    expect(allWords(document.body)).not.toMatch(JARGON);
    expect(document.body).toHaveTextContent('Keep 2+ reps left on heavy compounds.');
  });

  it('PR popup copy: no e1RM', () => {
    const pr = { type: 'e1rm', value: 100, improvement: 3, previous: 97 } as const;
    const copy = prCelebrationCopy(pr, (kg) => `${kg} kg`, { beginner: true, set: { weightKg: 75, repCount: 10 } });
    expect(`${copy.title} ${copy.detail}`).not.toMatch(JARGON);
    expect(copy.detail).toBe('75 kg × 10 → estimated max 100 kg (was 97 kg)');
    // Off: the term rides along.
    expect(prCelebrationCopy(pr, (kg) => `${kg} kg`).detail).toBe('est. 1-rep max (e1RM) 100 kg (was 97 kg)');
  });

  it('plainWorkoutText keeps every number', () => {
    const line = 'Anchored to your last set: 60 kg × 8 at RPE 8. Its estimated 1RM (80 kg) sets 2 RIR; MRV 20.';
    const out = plainWorkoutText(line);
    expect(out).not.toMatch(JARGON);
    // Same numbers, in order ("1RM" is a name, not a number; "/10" is the scale).
    expect(out.replace(/\/10/g, '').match(/\d+/g)).toEqual(line.replace(/1RM/g, '').match(/\d+/g));
  });
});

describe('beginner effort question: three answers on existing chip values', () => {
  const base = {
    setNumber: 1,
    weight: '60',
    reps: '8',
    onWeightChange: jest.fn(),
    onRepsChange: jest.fn(),
  };

  it.each([
    ['That was hard', 1],
    ['A couple more', 2],
    ['Could do lots more', 4],
  ])('"%s" logs RIR %i as a lifter-chosen value', async (label, rir) => {
    setBeginner(true);
    const user = userEvent.setup();
    const onLog = jest.fn();
    render(<SetLoggerRow {...base} targetRir={3} onLog={onLog} />);
    expect(screen.getByText('How did that set feel?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: label }));
    await user.click(screen.getAllByRole('button', { name: 'Log set' })[0]);
    expect(onLog).toHaveBeenCalledTimes(1);
    const data = onLog.mock.calls[0][0];
    expect(data.feedback.repsInTank).toBe(rir);
    expect(data.rirExplicitlySelected).toBe(true);
    expect(data.feedback.rirSource).toBeUndefined();
  });

  it('an untouched preset logs exactly as on the five chips (target 3 stays 3)', async () => {
    const user = userEvent.setup();
    setBeginner(true);
    const onLog = jest.fn();
    render(<SetLoggerRow {...base} targetRir={3} onLog={onLog} />);
    // 3 has no answer of its own: "A couple more" is highlighted…
    expect(screen.getByRole('button', { name: 'A couple more' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getAllByRole('button', { name: 'Log set' })[0]);
    const beginnerData = onLog.mock.calls[0][0];

    // …but the logged value is the preset, identical to beginner mode off.
    setBeginner(false);
    const onLogOff = jest.fn();
    render(<SetLoggerRow {...base} setNumber={2} targetRir={3} onLog={onLogOff} />);
    await user.click(screen.getAllByRole('button', { name: 'Log set' })[1]);
    const offData = onLogOff.mock.calls[0][0];
    expect(beginnerData.feedback.repsInTank).toBe(3);
    expect(beginnerData.rpe).toBe(offData.rpe);
    expect(beginnerData.rirExplicitlySelected).toBe(false);
  });

  it('an untouched sensor prefill still logs rirSource "sensor"', async () => {
    setBeginner(true);
    const user = userEvent.setup();
    const onLog = jest.fn();
    render(
      <SetLoggerRow {...base} targetRir={2} onLog={onLog} sensorRirPrefill={{ nonce: 1, rir: 0 }} />
    );
    expect(screen.getByRole('button', { name: 'That was hard' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getAllByRole('button', { name: 'Log set' })[0]);
    const data = onLog.mock.calls[0][0];
    expect(data.feedback.repsInTank).toBe(0);
    expect(data.feedback.rirSource).toBe('sensor');
  });
});
