import {
  isMissingColumnError,
  selectWithOptionalColumn,
} from '../columnFallback';

describe('isMissingColumnError', () => {
  it('matches Postgres 42703 naming the column', () => {
    expect(
      isMissingColumnError(
        { code: '42703', message: 'column exercise_blocks.equipment_changed does not exist' },
        'equipment_changed'
      )
    ).toBe(true);
  });

  it('rejects 42703 for a DIFFERENT column', () => {
    expect(
      isMissingColumnError(
        { code: '42703', message: 'column exercise_blocks.some_other_col does not exist' },
        'equipment_changed'
      )
    ).toBe(false);
  });

  it('rejects other error codes even when the message mentions the column', () => {
    expect(
      isMissingColumnError(
        { code: '42501', message: 'permission denied for equipment_changed' },
        'equipment_changed'
      )
    ).toBe(false);
  });

  it('rejects null / undefined errors', () => {
    expect(isMissingColumnError(null, 'equipment_changed')).toBe(false);
    expect(isMissingColumnError(undefined, 'equipment_changed')).toBe(false);
  });
});

describe('selectWithOptionalColumn', () => {
  const missingColumnError = {
    code: '42703',
    message: 'column exercise_blocks.equipment_changed does not exist',
  };

  it('returns first-attempt data without retrying when the column exists', async () => {
    const run = jest.fn().mockResolvedValue({ data: [{ id: 1 }], error: null });

    const result = await selectWithOptionalColumn('equipment_changed', run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(true);
    expect(result).toEqual({ data: [{ id: 1 }], error: null, columnMissing: false });
  });

  it('retries without the column when the database does not have it yet', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: missingColumnError })
      .mockResolvedValueOnce({ data: [{ id: 2 }], error: null });

    const result = await selectWithOptionalColumn('equipment_changed', run);

    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(1, true);
    expect(run).toHaveBeenNthCalledWith(2, false);
    expect(result).toEqual({ data: [{ id: 2 }], error: null, columnMissing: true });
  });

  it('surfaces unrelated errors without retrying', async () => {
    const rlsError = { code: '42501', message: 'permission denied' };
    const run = jest.fn().mockResolvedValue({ data: null, error: rlsError });

    const result = await selectWithOptionalColumn('equipment_changed', run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: null, error: rlsError, columnMissing: false });
  });

  it('surfaces a fallback failure as the final error', async () => {
    const secondError = { code: '57014', message: 'canceling statement' };
    const run = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: missingColumnError })
      .mockResolvedValueOnce({ data: null, error: secondError });

    const result = await selectWithOptionalColumn('equipment_changed', run);

    expect(run).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ data: null, error: secondError, columnMissing: true });
  });
});
