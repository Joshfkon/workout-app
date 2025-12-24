# Macro Calculator v3.3 Integration Plan

## Summary

The macro calculator has been updated to v3.3 with aggressive phase tracking. This document outlines integration points with existing refeed/deload systems.

## Existing Systems Found

### 1. Refeed Logic
**Location**: `components/dashboard/DailyCheckIn.tsx` and `components/workout/ReadinessCheckIn.tsx`

**Current Implementation**:
- Checks focus, libido, hunger, energy levels (1-5 scale)
- Recommends refeed when 2+ indicators are low
- Stores `refeedRecommended` boolean in `PreWorkoutCheckIn`

**Integration Point**: 
- Use `getRefeedIntegrationSignals().suggestRefeedDay` to enhance existing refeed detection
- Combine macro calculator phase warnings with daily check-in feedback

### 2. Deload Detection
**Location**: `services/deloadEngine.ts` and `services/fatigueEngine.ts`

**Current Implementation**:
- `checkDeloadTriggers()` - checks performance, fatigue, sleep quality
- `shouldTriggerDeload()` - checks fatigue score, missed targets, RPE creep
- Returns `{ shouldDeload: boolean, reasons: string[], suggestedDeloadType: 'volume' | 'intensity' | 'full' }`

**Integration Point**:
- Use `getRefeedIntegrationSignals().triggerDeloadCheck` to add aggressive phase as a deload trigger
- Pass `deloadReason` from phase status to existing deload system

### 3. Daily Feedback Collection
**Location**: `components/dashboard/DailyCheckIn.tsx` and `components/workout/ReadinessCheckIn.tsx`

**Current Data Collected**:
- Sleep hours & quality (1-5)
- Energy level (1-5)
- Mood rating (1-5)
- Focus rating (1-5) - cut-specific
- Libido rating (1-5) - cut-specific
- Hunger level (1-5) - cut-specific
- Soreness level (1-5)
- Stress level (1-5)

**Integration Point**:
- Pass daily feedback to `getRefeedIntegrationSignals()` to improve recommendations
- Use `promptDailyFeedback` and `feedbackQuestions` to enhance check-in prompts during aggressive phases

## Integration Points

### 1. Macro Calculator UI (`components/nutrition/MacroCalculatorModal.tsx`)

**Required Changes**:
- When user selects "aggressive_cut", require them to select phase duration (2/3/4 weeks)
- Track `currentWeeksInPhase` based on when aggressive phase started
- Display phase status warnings prominently
- Show `borrowedTimeWarning` message

**Code Snippet**:
```typescript
// When goal is aggressive_cut, show duration selector
{goal === 'aggressive_cut' && (
  <div>
    <label>Phase Duration</label>
    <Select
      value={aggressivePhase?.plannedDurationWeeks || 2}
      onChange={(e) => setAggressivePhase({
        currentWeeksInPhase: 0,
        plannedDurationWeeks: parseInt(e.target.value) as 2 | 3 | 4,
        phaseStartDate: new Date().toISOString(),
      })}
      options={[
        { value: 2, label: '2 weeks' },
        { value: 3, label: '3 weeks' },
        { value: 4, label: '4 weeks' },
      ]}
    />
  </div>
)}

// Display phase warnings
{recommendation.phaseStatus && (
  <div className="space-y-2">
    {recommendation.phaseStatus.warnings.map((warning, i) => (
      <div key={i} className={`p-3 rounded-lg ${
        warning.level === 'critical' ? 'bg-danger-500/10 border-danger-500/20' :
        warning.level === 'warning' ? 'bg-warning-500/10 border-warning-500/20' :
        warning.level === 'caution' ? 'bg-amber-500/10 border-amber-500/20' :
        'bg-primary-500/10 border-primary-500/20'
      }`}>
        <p className="font-semibold">{warning.message}</p>
        <p className="text-sm">{warning.recommendation}</p>
      </div>
    ))}
  </div>
)}
```

### 2. Daily Check-In Enhancement (`components/dashboard/DailyCheckIn.tsx`)

**Required Changes**:
- Fetch current macro targets and phase status
- Pass daily feedback to `getRefeedIntegrationSignals()`
- Display integration signals prominently
- Enhance refeed recommendation with phase status

**Code Snippet**:
```typescript
// Fetch phase status from nutrition targets
const { data: nutritionTargets } = await supabase
  .from('nutrition_targets')
  .select('cardio_prescription, phase_status')
  .eq('user_id', userId)
  .single();

// Get integration signals
const signals = getRefeedIntegrationSignals(
  nutritionTargets?.phase_status,
  {
    sleepQuality: sleepQuality,
    energyLevel: energyLevel,
    moodRating: moodRating,
    libidoRating: libidoRating,
    // liftingPerformance would come from workout tracking
  }
);

// Display signals
{signals.suggestRefeedDay && (
  <div className="p-3 bg-warning-500/10 border border-warning-500/20 rounded-lg">
    <p className="font-semibold">Refeed Recommended</p>
    <p className="text-sm">{signals.refeedReason}</p>
  </div>
)}
```

### 3. Deload Engine Integration (`services/deloadEngine.ts`)

**Required Changes**:
- Add aggressive phase check to `checkDeloadTriggers()`
- Use `getRefeedIntegrationSignals().triggerDeloadCheck` as additional trigger

**Code Snippet**:
```typescript
// In checkDeloadTriggers(), add:
// === TRIGGER: Aggressive dieting phase ===
const { data: nutritionTargets } = await supabase
  .from('nutrition_targets')
  .select('phase_status')
  .eq('user_id', profile.userId)
  .single();

if (nutritionTargets?.phase_status) {
  const signals = getRefeedIntegrationSignals(nutritionTargets.phase_status);
  if (signals.triggerDeloadCheck) {
    reasons.push(signals.deloadReason || 'Aggressive dieting phase - recovery may be compromised');
    shouldDeload = true;
    suggestedDeloadType = 'volume'; // Volume deload during aggressive cuts
  }
}
```

### 4. Dashboard Warnings (`app/(dashboard)/dashboard/page.tsx`)

**Required Changes**:
- Display phase status warnings prominently on dashboard
- Show countdown to phase end
- Display "borrowed time" message

**Code Snippet**:
```typescript
// In dashboard, fetch and display phase status
{phaseStatus && phaseStatus.isAggressive && (
  <Card className="border-warning-500/20">
    <CardHeader>
      <CardTitle>Aggressive Cut Phase</CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-sm mb-3">{phaseStatus.borrowedTimeWarning}</p>
      <div className="space-y-2">
        <p>Week {phaseStatus.weeksCompleted} of {phaseStatus.plannedDuration}</p>
        <p>{phaseStatus.weeksRemaining} week(s) remaining</p>
        {phaseStatus.warnings.map((warning, i) => (
          <div key={i} className={`p-2 rounded ${
            warning.level === 'critical' ? 'bg-danger-500/10' :
            warning.level === 'warning' ? 'bg-warning-500/10' :
            'bg-amber-500/10'
          }`}>
            <p className="text-sm">{warning.message}</p>
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
)}
```

## Database Schema Updates Needed

### 1. Store Phase Status in `nutrition_targets`

**Migration**:
```sql
ALTER TABLE nutrition_targets
ADD COLUMN phase_status JSONB NULL;

COMMENT ON COLUMN nutrition_targets.phase_status IS 'Aggressive phase tracking: currentWeeksInPhase, plannedDurationWeeks, phaseStartDate';
```

### 2. Track Phase Start Date

When user starts an aggressive cut:
- Store `phaseStartDate` in `nutrition_targets.phase_status`
- Calculate `currentWeeksInPhase` based on elapsed time
- Update weekly or on each macro calculation

## Implementation Checklist

- [x] Update macro calculator to v3.3
- [ ] Add phase duration selector to macro calculator UI
- [ ] Store phase status in database
- [ ] Update daily check-in to use integration signals
- [ ] Enhance deload engine with phase status check
- [ ] Add dashboard warnings for aggressive phases
- [ ] Track phase start date and calculate weeks elapsed
- [ ] Display "borrowed time" messaging prominently
- [ ] Test integration with existing refeed/deload systems

## Key Messages to Convey

1. **"Aggressive cuts are borrowed time"** - Not sustainable indefinitely
2. **"Cardio lets you borrow more time — not infinite time"** - There are limits
3. **"Plan your exit strategy before you start"** - Users should know when to transition
4. **Phase health indicators** - Monitor sleep, energy, mood, libido, lifting performance

## Next Steps

1. Update `MacroCalculatorModal.tsx` to require phase duration selection
2. Create database migration for `phase_status` column
3. Update daily check-in to fetch and use phase status
4. Enhance deload engine with phase status integration
5. Add dashboard card for phase warnings
6. Test end-to-end flow

