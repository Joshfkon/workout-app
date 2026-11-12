/** The USDA proxy actions must not be usable without a session. */
const mockGetUser = jest.fn();
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));
const mockSearchFoods = jest.fn();
const mockGetFoodDetails = jest.fn();
jest.mock('@/services/usdaService', () => ({
  searchFoods: (...a: unknown[]) => mockSearchFoods(...a),
  getFoodDetails: (...a: unknown[]) => mockGetFoodDetails(...a),
}));

import { searchFoodsAction, getFoodDetailsAction } from '@/lib/actions/food-search';

describe('food-search actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchFoods.mockResolvedValue({ foods: [{ fdcId: 1 }] });
    mockGetFoodDetails.mockResolvedValue({ food: { fdcId: 1 } });
  });

  it('refuses signed-out callers without calling USDA', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await searchFoodsAction('signed out chicken')).toEqual({ foods: [], error: 'Sign in to search foods' });
    expect((await getFoodDetailsAction('signed-out-id')).food).toBeUndefined();
    expect(mockSearchFoods).not.toHaveBeenCalled();
    expect(mockGetFoodDetails).not.toHaveBeenCalled();
  });

  it('serves signed-in callers', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    expect((await searchFoodsAction('signed in chicken')).foods).toHaveLength(1);
    expect((await getFoodDetailsAction('signed-in-id')).food).toBeDefined();
  });

  it('rejects oversized input', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    expect((await searchFoodsAction('x'.repeat(201))).error).toMatch(/too long/);
    expect((await getFoodDetailsAction('x'.repeat(65))).error).toBeDefined();
    expect(mockSearchFoods).not.toHaveBeenCalled();
  });
});
