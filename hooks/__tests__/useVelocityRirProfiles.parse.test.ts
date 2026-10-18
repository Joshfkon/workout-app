jest.mock('@/lib/supabase/client', () => ({ createUntypedClient: jest.fn() }));

import { parseLoggedRir } from '../useVelocityRirProfiles';

describe('parseLoggedRir (MVT label)', () => {
  it('reads repsInTank from jsonb or a JSON string', () => {
    expect(parseLoggedRir({ repsInTank: 1, form: 'clean' })).toBe(1);
    expect(parseLoggedRir(JSON.stringify({ repsInTank: 0, form: 'clean' }))).toBe(0);
    expect(parseLoggedRir(null)).toBeNull();
  });

  it('an untouched sensor prefill is not a label', () => {
    expect(parseLoggedRir({ repsInTank: 1, form: 'clean', rirSource: 'sensor' })).toBeNull();
    expect(parseLoggedRir(JSON.stringify({ repsInTank: 1, form: 'clean', rirSource: 'sensor' }))).toBeNull();
  });
});
