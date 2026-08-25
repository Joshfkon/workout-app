/**
 * Bodyweight classification — is this exercise loaded by the lifter's own body?
 *
 * Split out of bodyweightService so the question has one answer everywhere:
 * the session mapping, the workout card, and anything else that has to decide
 * whether to ask for an external load.
 */

import { deriveEquipmentClass, type EquipmentClass } from '@/services/equipmentClass';

/**
 * Everything the classifier can read off an exercise. Both casings are
 * accepted so a raw DB row and a mapped `Exercise` can be passed straight in.
 */
export interface BodyweightClassificationInput {
  isBodyweight?: boolean | null;
  is_bodyweight?: boolean | null;
  equipment?: string | null;
  equipmentRequired?: string[] | null;
  equipment_required?: string[] | null;
  equipmentClass?: EquipmentClass | null;
  equipment_class?: string | null;
  name?: string | null;
  exerciseType?: string | null;
  exercise_type?: string | null;
}

/**
 * Phrases that mean an EXTERNAL implement supplies the load. Used only to
 * disqualify timed holds — "weighted" and "vest" are deliberately absent
 * because a weighted plank is still a bodyweight movement carrying extra load.
 */
const EXTERNAL_LOAD_SIGNALS = [
  'barbell', 'ez bar', 'ez curl', 'curl bar', 'trap bar', 'hex bar', 'landmine',
  'dumbbell', 'dumbbells', 'db', 'kettlebell', 'kettlebells', 'kb',
  'plate', 'plates', 'machine', 'cable', 'smith', 'band', 'bands',
  'sled', 'sandbag', 'medicine ball', 'med ball', 'sled push',
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Word-boundary match, so 'band' doesn't hit 'headband' or 'db' hit 'deadbug'. */
const containsPhrase = (text: string, phrase: string) =>
  new RegExp(`(^|[^a-z0-9])${escapeRegExp(phrase)}($|[^a-z0-9])`).test(text);

/**
 * Is this exercise loaded by the lifter's own body?
 *
 * `exercises.is_bodyweight` is the intended source of truth but is NOT
 * reliable across the catalog's history: the column is `NOT NULL DEFAULT
 * false`, and several seeding passes only set it for rows whose scalar
 * `equipment` was already 'bodyweight' with no equipment tags — so
 * station-based movements (dead hang, pull-up, dip, L-sit) and older seed rows
 * can sit at `false` while being pure bodyweight work. A false flag then reads
 * as "externally loaded", which asks the lifter for a weight that does not
 * exist and prescribes against a load of 0.
 *
 * So the flag is a positive signal only; when it is unset we fall through to
 * the same equipment signals the rest of the app classifies on:
 *
 *   1. explicit flag / an explicit 'bodyweight' equipment value or tag;
 *   2. the derived equipment class (`deriveEquipmentClass`) — this is what
 *      catches pull-up bars, dip bars and parallettes;
 *   3. timed holds with no external-load signal at all (dead hang, plank,
 *      wall sit, L-sit). A Plate Pinch Hold or a Farmer's Carry names its
 *      implement and is excluded.
 */
export function resolveIsBodyweight(input: BodyweightClassificationInput): boolean {
  if ((input.isBodyweight ?? input.is_bodyweight) === true) return true;

  const tags = (input.equipmentRequired ?? input.equipment_required ?? [])
    .filter(Boolean)
    .map((t) => String(t).toLowerCase());
  const equipment = (input.equipment ?? '').toLowerCase();
  if (equipment === 'bodyweight' || tags.includes('bodyweight')) return true;

  const equipmentClass = deriveEquipmentClass({
    equipmentRequired: tags,
    name: input.name,
    equipmentClass: input.equipmentClass,
    equipment_class: input.equipment_class,
  });
  if (equipmentClass === 'bodyweight') return true;

  // Timed holds: an unrecognized implement set means no implement at all.
  const isDurationBased =
    (input.exerciseType ?? input.exercise_type) === 'duration_based';
  if (isDurationBased && equipmentClass === 'other') {
    const blob = ` ${[(input.name ?? '').toLowerCase(), ...tags, equipment].join(' ')} `;
    return !EXTERNAL_LOAD_SIGNALS.some((p) => containsPhrase(blob, p));
  }

  return false;
}

