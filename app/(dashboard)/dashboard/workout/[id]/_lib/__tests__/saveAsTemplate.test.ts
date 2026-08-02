import { saveSessionAsTemplate } from '../saveAsTemplate';
import type { TemplateExerciseDraft } from '@/services/templateFromSession';

/**
 * Guards the "Save as template" write:
 *  1. The exercise rows are stamped with the new template's id.
 *  2. A failed exercise insert rolls the parent template back — an empty
 *     template the user never asked for is worse than no template.
 *  3. Nothing is written for an unnamed or empty save.
 */

interface Recorded {
  table: string;
  op: 'insert' | 'delete';
  payload?: unknown;
}

function makeClient(options: { templateId?: string; exerciseError?: Error } = {}) {
  const { templateId = 'tmpl-1', exerciseError } = options;
  const calls: Recorded[] = [];

  const client = {
    from(table: string) {
      return {
        insert(payload: unknown) {
          calls.push({ table, op: 'insert', payload });
          if (table === 'workout_template_exercises') {
            return Promise.resolve({ data: null, error: exerciseError ?? null });
          }
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: templateId }, error: null }),
            }),
          };
        },
        delete() {
          return {
            eq: (_column: string, value: string) => {
              calls.push({ table, op: 'delete', payload: value });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };

  // The helper takes the app's untyped supabase client; this fake stands in.
  return { client: client as unknown as Parameters<typeof saveSessionAsTemplate>[0], calls };
}

const DRAFT: TemplateExerciseDraft = {
  exercise_id: 'ex-1',
  exercise_name: 'Bench Press',
  exercise_type: 'rep_based',
  sort_order: 0,
  default_sets: 3,
  default_reps: '8-12',
  default_weight: 60,
  default_rest_seconds: 120,
  notes: null,
};

describe('saveSessionAsTemplate', () => {
  it('creates the template and stamps its id onto every exercise row', async () => {
    const { client, calls } = makeClient({ templateId: 'tmpl-7' });

    const result = await saveSessionAsTemplate(client, {
      userId: 'user-1',
      name: '  Push  ',
      folderId: 'folder-3',
      exercises: [DRAFT, { ...DRAFT, exercise_id: 'ex-2', sort_order: 1 }],
    });

    expect(result).toEqual({ templateId: 'tmpl-7' });

    const templateInsert = calls.find((c) => c.table === 'workout_templates');
    expect(templateInsert?.payload).toMatchObject({
      user_id: 'user-1',
      name: 'Push', // trimmed
      folder_id: 'folder-3',
      notes: null,
    });

    const exerciseInsert = calls.find((c) => c.table === 'workout_template_exercises');
    expect(exerciseInsert?.payload).toEqual([
      { ...DRAFT, template_id: 'tmpl-7' },
      { ...DRAFT, exercise_id: 'ex-2', sort_order: 1, template_id: 'tmpl-7' },
    ]);
  });

  it('deletes the template again when its exercises fail to insert', async () => {
    const { client, calls } = makeClient({
      templateId: 'tmpl-9',
      exerciseError: new Error('insert failed'),
    });

    await expect(
      saveSessionAsTemplate(client, {
        userId: 'user-1',
        name: 'Pull',
        folderId: null,
        exercises: [DRAFT],
      })
    ).rejects.toThrow('insert failed');

    expect(calls).toContainEqual({
      table: 'workout_templates',
      op: 'delete',
      payload: 'tmpl-9',
    });
  });

  it('refuses to write an unnamed template', async () => {
    const { client, calls } = makeClient();
    await expect(
      saveSessionAsTemplate(client, {
        userId: 'user-1',
        name: '   ',
        folderId: null,
        exercises: [DRAFT],
      })
    ).rejects.toThrow(/name is required/i);
    expect(calls).toHaveLength(0);
  });

  it('refuses to write a template with no exercises', async () => {
    const { client, calls } = makeClient();
    await expect(
      saveSessionAsTemplate(client, {
        userId: 'user-1',
        name: 'Empty',
        folderId: null,
        exercises: [],
      })
    ).rejects.toThrow(/no exercises/i);
    expect(calls).toHaveLength(0);
  });
});
