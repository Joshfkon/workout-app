# Set Logging Performance Optimization

## Investigation Summary

### Current Critical Path (Tap → Ready for Next Set)

1. **SetLoggerRow.handleLog** (282-345)
   - User taps "Log set"
   - Validates input
   - Builds feedback object
   - Calls `onLog` → `completeLoggedSet`

2. **ExerciseCard.completeLoggedSet** (1987-2015)
   - Calls `beginSetTiming()`
   - Sets `isCompletingSet = true` (locks button)
   - Light haptic feedback
   - Calls `onSetComplete` (page-level handler)
   - **WAITS for handler to complete**
   - **Artificial 100ms delay**
   - Sets `isCompletingSet = false` (unlocks button)

3. **Page handleSetComplete** (2832-3150+)
   - Stabilizer warning handling
   - Quality calculation
   - **Rest prescription calculation**
   - **AWAIT pending delete/renumber** (BLOCKS!)
   - Calls `logSet()`:
     - **Network probe for set_number** (when online)
     - Applies optimistic state
     - Schedules paint mark (RAF)
     - Inserts to DB or enqueues to outbox
   - Records soreness
   - **Inserts joint pain event**
   - Shows toast
   - **PR detection calculation**
   - **Motion capture collection**
   - Handles dropset prompt / starts rest timer

### Identified Bottlenecks

#### 1. **100ms Artificial Delay** (ExerciseCard, after line 2015)
- **Impact**: HIGH - Pure wasted latency
- **Location**: ExerciseCard.completeLoggedSet
- **Fix**: Remove the delay, button is already locked during the operation
- **Risk**: LOW

#### 2. **Pending Delete Await** (page.tsx, lines 2928-2930)
- **Impact**: HIGH - Blocks new set on completion of prior delete
- **Why it exists**: Prevents race where delete renumbers sets before new set queries max
- **Fix**: Track expected set number optimistically, don't block
- **Risk**: MEDIUM - Need to ensure correctness

#### 3. **Set Number Probe on Every Set** (logSet.ts, lines 412-419)
- **Impact**: MEDIUM-HIGH - Network round trip on critical path when online
- **Why it exists**: Syncs with other tabs/devices
- **Fix**: Skip probe when we're confident in local state (sequential sets)
- **Risk**: MEDIUM - Must detect when resync needed

#### 4. **Heavy Post-Set Work Before Return** (page.tsx)
- **Impact**: MEDIUM - Calculations block button unlock
- **Items**:
  - Rest prescription (lines 2891-2899)
  - PR detection (lines 3058-3091)
  - Motion capture (lines 3093-3102)
  - Joint pain event insert (lines 3029-3042)
- **Fix**: Move non-essential work off critical path via queueMicrotask/setTimeout
- **Risk**: LOW - These are already fire-and-forget

#### 5. **Full Page Re-render** (setCompletedSets call)
- **Impact**: MEDIUM - Re-renders entire workout tree
- **Fix**: Optimize with React.memo or more targeted updates
- **Risk**: LOW

#### 6. **Timing Instrumentation Overhead**
- **Impact**: LOW - Multiple performance.mark calls
- **Fix**: Can be optimized but low priority
- **Risk**: NONE - It's diagnostic only

## Optimization Strategy

### Phase 1: Quick Wins (High Impact, Low Risk)

1. **Remove 100ms delay** in ExerciseCard
2. **Defer PR detection** - Run after optimistic update
3. **Defer motion capture** - Run after optimistic update  
4. **Defer rest prescription heavy parts** - Calculate only when needed

### Phase 2: Medium Risk Improvements

5. **Optimize delete-wait** - Track expected numbers, don't block
6. **Skip probe when confident** - Skip network probe for sequential sets
7. **Batch state updates** - Combine multiple setState calls

### Phase 3: Polish

8. **Optimize re-renders** - Add React.memo to heavy components
9. **Optimize timing instrumentation** - Reduce overhead

## Implementation Plan

### 1. Remove 100ms Delay
**File**: `components/workout/ExerciseCard.tsx`
**Change**: Remove setTimeout wrapper after onSetComplete
**Before/After**: 100ms → 0ms saved directly

### 2. Defer Heavy Post-Set Work
**File**: `app/(dashboard)/dashboard/workout/[id]/page.tsx`
**Changes**:
- Move PR detection into queueMicrotask after optimistic update
- Move motion capture after optimistic update
- Defer rest prescription calculation

### 3. Skip Unnecessary Probe
**File**: `lib/training/logSet.ts`
**Change**: Add logic to skip probe when:
- We just logged a set and know the next number
- No deletes/edits since last log
**Track**: `lastLoggedSetNumber` per block

### 4. Optimize Delete-Wait
**File**: `app/(dashboard)/dashboard/workout/[id]/page.tsx`
**Change**: Don't await the delete, track expected numbers in ref

## Expected Improvements

### Before (Estimated Timing)
- Tap → Button locked: ~0ms
- Button locked → Optimistic UI: ~50-150ms (delete wait + probe + calculations)
- Optimistic UI → Button unlock: ~100ms (artificial delay)
- **Total tap → ready: 150-250ms**

### After (Target)
- Tap → Button locked: ~0ms
- Button locked → Optimistic UI: ~10-30ms (just local state update)
- Optimistic UI → Button unlock: ~0ms (immediate)
- **Total tap → ready: 10-30ms**

### Improvement: **~80-90% reduction in perceived latency**

## Correctness Guarantees Preserved

1. **Offline durability**: No changes to outbox logic
2. **Set numbering**: Still correct via optimistic tracking
3. **Data validation**: All validation still runs
4. **Modality helpers**: No changes to RIR/RPE/form handling
5. **Deferred work still completes**: Just not blocking the UI

## Testing Strategy

1. **Unit tests** for new helpers (set number tracking, deferred work)
2. **Integration test**: Log multiple sets rapidly, verify numbering
3. **Regression test**: Verify offline mode still works
4. **Manual test**: Feel the snappiness improvement
