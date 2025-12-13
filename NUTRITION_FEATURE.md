# Nutrition Tracking Feature

## Overview

A comprehensive nutrition tracking system similar to Lose It app, integrated into the HyperTrack fitness webapp. Users can log daily food intake, track macros, monitor weight trends, and manage custom foods.

## Features Implemented

### 1. Daily Food Logging
- ✅ View and navigate between days
- ✅ Organize meals by Breakfast, Lunch, Dinner, and Snacks
- ✅ Running totals for Calories, Protein, Carbs, and Fat
- ✅ Progress bars against daily nutrition targets
- ✅ Add food via multiple methods:
  - Natural language search (Nutritionix API)
  - Barcode scanning (ZXing library)
  - Recent foods (quick re-logging)
  - Custom foods (user-created)
  - Manual entry

### 2. Food Search & Entry
- ✅ Natural language search using Nutritionix API
  - Example: "2 eggs and toast" returns parsed nutrition data
- ✅ Search results show: food name, serving size, calories, macros
- ✅ Adjustable serving size/quantity before confirming
- ✅ Automatic tracking of recent foods for quick re-logging

### 3. Barcode Scanner
- ✅ Device camera support using ZXing-js library
- ✅ Real-time barcode scanning with visual feedback
- ✅ Nutritionix UPC lookup endpoint integration
- ✅ Fallback to manual entry if product not found
- ✅ Works on mobile and desktop (with webcam)

### 4. Manual/Custom Food Entry
- ✅ Simple form: food name, serving size, calories, protein, carbs, fat
- ✅ Save as custom food for reuse
- ✅ Edit/delete custom foods functionality
- ✅ All custom foods stored in user's library

### 5. Weight Logging
- ✅ Simple entry: weight + date (default today)
- ✅ Recent entries displayed in weight trend section
- ✅ Interactive line chart visualization
- ✅ 7-day rolling average calculation
- ✅ One entry per day (upsert logic)

### 6. Nutrition Targets
- ✅ Set daily calorie and macro goals
- ✅ Visual progress bars showing % of targets met
- ✅ Macro breakdown validation (P/C/F → calories)
- ✅ Editable targets anytime

## Database Schema

### Tables Created

```sql
-- Daily food log entries
food_log (
  id, user_id, logged_at, meal_type, food_name,
  serving_size, servings, calories, protein, carbs, fat,
  source, nutritionix_id, created_at
)

-- Custom foods created by user
custom_foods (
  id, user_id, food_name, serving_size,
  calories, protein, carbs, fat,
  created_at, updated_at
)

-- Weight log
weight_log (
  id, user_id, logged_at, weight, notes, created_at
  UNIQUE(user_id, logged_at) -- one entry per day
)

-- Nutrition targets
nutrition_targets (
  id, user_id, calories, protein, carbs, fat,
  created_at, updated_at
  UNIQUE(user_id) -- one target per user
)
```

All tables have:
- Row Level Security (RLS) enabled
- Policies for SELECT, INSERT, UPDATE, DELETE (scoped to auth.uid())
- Appropriate indexes for performance
- CASCADE delete on user_id foreign keys

## API Integration

### Nutritionix API

**Setup Required:**
1. Create account at https://developer.nutritionix.com/
2. Get your App ID and API Key (free tier: 50 calls/day)
3. Add to `.env.local`:
   ```
   NUTRITIONIX_APP_ID=your_app_id_here
   NUTRITIONIX_API_KEY=your_api_key_here
   ```

**Endpoints Used:**
- `POST /v2/natural/nutrients` - Natural language food search
- `GET /v2/search/item?upc={barcode}` - Barcode/UPC lookup

**Server Actions:**
- `lib/actions/nutrition.ts` - All Nutritionix API calls (keys never exposed to client)
- `searchFoods(query)` - Natural language search
- `lookupBarcode(barcode)` - UPC lookup

## File Structure

```
app/(dashboard)/dashboard/nutrition/
  └── page.tsx                    # Main nutrition tracking page

components/nutrition/
  ├── AddFoodModal.tsx           # Multi-tab food adding interface
  ├── BarcodeScanner.tsx         # Camera-based barcode scanning
  ├── NutritionTargetsModal.tsx  # Set/edit nutrition targets
  └── WeightLogModal.tsx         # Log daily weight

lib/actions/
  └── nutrition.ts               # Nutritionix API server actions

types/
  └── nutrition.ts               # TypeScript types for nutrition

supabase/migrations/
  └── 20241213000001_nutrition_tracking.sql  # Database schema
```

## UI Components

All components use the existing custom Tailwind UI library:
- `Card`, `CardHeader`, `CardTitle`, `CardContent` - Layout containers
- `Button` - Primary, ghost, outline variants
- `Input` - Form inputs with validation
- `Select` - Dropdown selects
- `Modal` - Full-featured modal dialogs
- `Badge` - Status badges

## Navigation

Added "Nutrition" link to dashboard sidebar:
- Position: After "Body Comp", before "Strength & Analytics"
- Icon: Shopping cart (food/grocery theme)
- Route: `/dashboard/nutrition`

## Mobile-First Design

- Responsive grid layouts (mobile → tablet → desktop)
- Touch-friendly tap targets
- Swipe-friendly date navigation
- Camera access for barcode scanning
- Optimized for phone usage (primary use case)

## Key Features & UX Decisions

### Fast Add-Food Flow
- **Recent foods**: 1-2 taps to re-log
- **Custom foods**: 1 tap from library
- **Search**: Type → select → adjust → add (3-4 taps)
- **Barcode**: Scan → review → add (2-3 taps)

### Data Validation
- Serving sizes adjustable with decimals (0.1 precision)
- Macro calculations rounded appropriately
- Targets validation (macros should roughly equal calories)
- Weight entries limited to reasonable ranges

### Smart Defaults
- Default date: Today
- Default servings: 1
- Recent foods auto-populated from past logs
- Meal type pre-selected based on where user clicks

## Dependencies Added

```json
{
  "@zxing/library": "^0.21.3"  // Barcode scanning
}
```

## Migration Steps

1. **Database Setup**:
   ```bash
   # Apply migration
   supabase db reset
   # or manually run: supabase/migrations/20241213000001_nutrition_tracking.sql
   ```

2. **Environment Variables**:
   - Add Nutritionix credentials to `.env.local`
   - Restart Next.js dev server

3. **Dependencies**:
   ```bash
   npm install
   ```

4. **Access**:
   - Navigate to `/dashboard/nutrition`
   - Or click "Nutrition" in sidebar

## Future Enhancements (Not Implemented Yet)

From original spec - these were marked as "Don't worry about yet":
- [ ] Meal planning / recipes
- [ ] Micronutrients beyond P/C/F
- [ ] Social features
- [ ] Caching Nutritionix responses (cost optimization)
- [ ] Barcode scanning history
- [ ] Food photos
- [ ] Meal templates
- [ ] Import from other apps
- [ ] Nutrition insights/trends over time
- [ ] Integration with AI Coach for nutrition advice

## Integration with AI Coaching

The weight log feeds into the coaching context via `weightTrend`, allowing the AI coach to:
- Analyze weight changes over time
- Correlate with training performance
- Recommend nutrition adjustments
- Detect cutting vs. bulking phases

## Testing Checklist

- [x] Database migration applies cleanly
- [x] RLS policies prevent cross-user access
- [x] Food search returns results (with API keys)
- [x] Barcode scanner accesses camera
- [x] Manual entry validates inputs
- [x] Weight log calculates 7-day average
- [x] Targets save and display correctly
- [x] Progress bars update in real-time
- [x] Delete food entries works
- [x] Date navigation works (prev/next/today)
- [x] Recent foods appear after logging
- [x] Custom foods can be created and reused

## Known Limitations

1. **Nutritionix Free Tier**: 50 API calls/day
   - Sufficient for single user development
   - Production may need paid tier or response caching

2. **Barcode Database**: Not all products in Nutritionix
   - Fallback to manual entry available
   - More comprehensive in US market

3. **Camera Permissions**: Required for barcode scanning
   - Graceful fallback if denied
   - Works on HTTPS only (or localhost)

4. **No Offline Support**: Requires internet for:
   - Food search
   - Barcode lookup
   - Database sync

## Performance Considerations

- Food log queries filtered by date (indexed)
- Weight log limited to last 30 days
- Recent foods limited to last 20 entries
- Custom foods loaded once per session
- Targets cached in state after first load

## Accessibility

- Semantic HTML structure
- Keyboard navigation supported
- Screen reader friendly labels
- ARIA attributes on modals
- Color contrast meets WCAG AA standards
- Touch targets ≥44px (mobile)

## Browser Support

- Modern browsers (Chrome, Safari, Firefox, Edge)
- iOS Safari (camera for barcode scanning)
- Android Chrome (camera for barcode scanning)
- Desktop Chrome/Safari (webcam for barcode scanning)

## License

Part of HyperTrack workout app - Internal feature implementation.
