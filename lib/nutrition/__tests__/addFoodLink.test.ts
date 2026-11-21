import { addFoodHref, mealFromAddParam } from '../addFoodLink';

describe('Add food deep link', () => {
  it('builds a link to Eat that opens the Add food sheet', () => {
    expect(addFoodHref()).toBe('/dashboard/nutrition?add=now');
    expect(addFoodHref('lunch')).toBe('/dashboard/nutrition?add=lunch');
  });

  it('does not open the sheet without the param', () => {
    expect(mealFromAddParam(null, 'dinner')).toBeNull();
    expect(mealFromAddParam('', 'dinner')).toBeNull();
  });

  it('opens on the named meal, or the time-of-day meal for "now" / unknown values', () => {
    expect(mealFromAddParam('breakfast', 'dinner')).toBe('breakfast');
    expect(mealFromAddParam('now', 'dinner')).toBe('dinner');
    expect(mealFromAddParam('brunch', 'snack')).toBe('snack');
  });

  it('round-trips through the link Home uses', () => {
    const param = new URL(addFoodHref(), 'https://x').searchParams.get('add');
    expect(mealFromAddParam(param, 'lunch')).toBe('lunch');
  });
});
