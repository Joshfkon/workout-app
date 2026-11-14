import { markGymChosen, wasGymChosen } from '../gymChoice';

describe('gymChoice', () => {
  beforeEach(() => sessionStorage.clear());

  it('remembers a gym picked for one workout only', () => {
    expect(wasGymChosen('s1')).toBe(false);
    markGymChosen('s1');
    expect(wasGymChosen('s1')).toBe(true);
    expect(wasGymChosen('s2')).toBe(false);
  });

  it('treats unavailable storage as "not chosen" without throwing', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => markGymChosen('s1')).not.toThrow();
    expect(wasGymChosen('s1')).toBe(false);
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
