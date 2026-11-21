/**
 * Name-based tag inference for exercises created by a file import (Strong,
 * Hevy). Import-created customs carry only these inferred tags and land in
 * the mandatory muscle-review queue. Moved verbatim from
 * components/settings/ImportExportSettings.tsx so both importers share it.
 */

export function inferMuscleFromName(exerciseName: string): string {
  const name = exerciseName.toLowerCase();

  if (name.includes('crunch') || name.includes('ab ') || name.includes('abdominal') ||
      name.includes('sit-up') || name.includes('situp') || name.includes('plank') ||
      name.includes('pallof') || name.includes('palloff') ||
      name.includes('side bend') || name.includes('oblique') ||
      name.includes('woodchop') || name.includes('wood chop') ||
      name.includes('dead bug') || name.includes('hollow') ||
      name.includes('90/90') || name.includes('90 90') ||
      (name.includes('leg raise') && !name.includes('calf')) ||
      (name.includes('leg lift') && !name.includes('calf'))) {
    return 'abs';
  }

  if (name.includes('push-up') || name.includes('pushup') || name.includes('push up') ||
      name.includes('chest dip') || name.includes('dip') && name.includes('chest') ||
      name.includes('bench press') || name.includes('chest press') || name.includes('chest fly') ||
      name.includes('pec deck') || name.includes('pec fly') || name.includes('cable fly') ||
      name.includes('dumbbell fly') || name.includes('incline press') || name.includes('decline press') ||
      name.includes('floor press') ||
      (name.includes('fly') && (name.includes('chest') || name.includes('pec') || name.includes('cable')))) {
    return 'chest';
  }

  if (name.includes('arnold') ||
      name.includes('shoulder') || name.includes('lateral raise') || name.includes('front raise') ||
      name.includes('side raise') || name.includes('delt') || name.includes('military') ||
      name.includes('overhead press') || name.includes('ohp') ||
      name.includes('upright row') || name.includes('face pull') ||
      name.includes('reverse fly') || name.includes('rear delt')) {
    return 'shoulders';
  }

  if (name.includes('bicep') || name.includes('hammer curl') || name.includes('preacher') ||
      name.includes('concentration') || name.includes('ez curl') || name.includes('ez bar curl') ||
      (name.includes('curl') && !name.includes('leg') && !name.includes('ham') &&
       !name.includes('wrist') && !name.includes('reverse'))) {
    return 'biceps';
  }

  if (name.includes('tricep') || name.includes('skullcrusher') || name.includes('skull crusher') ||
      name.includes('pushdown') || name.includes('push down') ||
      (name.includes('dip') && !name.includes('chest')) ||
      name.includes('kickback') && !name.includes('glute') ||
      (name.includes('extension') && !name.includes('leg') && !name.includes('back') &&
       !name.includes('calf') && !name.includes('hip'))) {
    return 'triceps';
  }

  if (name.includes('shrug') || (name.includes('trap') && !name.includes('deadlift'))) {
    return 'traps';
  }

  if (name.includes('calf') || name.includes('calves') ||
      (name.includes('raise') && (name.includes('calf') || name.includes('heel')))) {
    return 'calves';
  }

  if (name.includes('row') && !name.includes('upright') ||
      name.includes('lat pull') || name.includes('pulldown') || name.includes('pull down') ||
      name.includes('pull-up') || name.includes('pullup') || name.includes('pull up') ||
      name.includes('chin-up') || name.includes('chinup') || name.includes('chin up') ||
      name.includes('back extension') || name.includes('hyper') ||
      name.includes('iso-lateral') || name.includes('iso lateral')) {
    return 'back';
  }

  if (name.includes('adductor') || name.includes('adduction')) {
    return 'adductors';
  }
  if (name.includes('abductor') || name.includes('abduction')) {
    return 'glutes';
  }

  if (name.includes('glute') || name.includes('hip thrust') ||
      (name.includes('kickback') && name.includes('glute'))) {
    return 'glutes';
  }

  if (name.includes('hamstring') || name.includes('leg curl') || name.includes('lying curl') ||
      (name.includes('seated curl') && name.includes('leg')) || name.includes('rdl') ||
      name.includes('romanian') || name.includes('stiff leg') ||
      name.includes('good morning')) {
    return 'hamstrings';
  }

  if (name.includes('squat') || name.includes('leg press') || name.includes('leg extension') ||
      name.includes('quad') || name.includes('lunge') || name.includes('hack') ||
      name.includes('step up') || name.includes('step-up') ||
      name.includes('split squat') || name.includes('sissy')) {
    return 'quads';
  }

  if (name.includes('forearm') || name.includes('wrist curl') || name.includes('grip') ||
      name.includes('reverse curl')) {
    return 'forearms';
  }

  if (name.includes('deadlift') || name.includes('trap bar')) {
    return 'hamstrings';
  }

  return 'back';
}

export function inferMechanicFromName(exerciseName: string): string {
  const name = exerciseName.toLowerCase();

  const compounds = ['squat', 'deadlift', 'bench', 'press', 'row', 'pull-up', 'pullup', 'chin-up', 'dip'];
  if (compounds.some(c => name.includes(c))) {
    return 'compound';
  }

  return 'isolation';
}

export function inferMovementPattern(exerciseName: string): string {
  const name = exerciseName.toLowerCase();

  if (name.includes('bench') || name.includes('push') || name.includes('fly') || name.includes('press') && name.includes('chest')) {
    return 'horizontal_push';
  }
  if (name.includes('row') || name.includes('pull') && !name.includes('down')) {
    return 'horizontal_pull';
  }
  if (name.includes('overhead') || name.includes('shoulder press') || name.includes('military')) {
    return 'vertical_push';
  }
  if (name.includes('pulldown') || name.includes('pull-up') || name.includes('pullup') || name.includes('chin')) {
    return 'vertical_pull';
  }
  if (name.includes('squat') || name.includes('leg press') || name.includes('lunge')) {
    return 'squat';
  }
  if (name.includes('deadlift') || name.includes('rdl') || name.includes('hip thrust')) {
    return 'hinge';
  }
  if (name.includes('curl') && !name.includes('leg')) {
    return 'curl';
  }
  if (name.includes('extension') || name.includes('pushdown') || name.includes('tricep')) {
    return 'extension';
  }
  if (name.includes('lateral') || name.includes('raise') || name.includes('fly')) {
    return 'isolation';
  }

  return 'compound';
}
