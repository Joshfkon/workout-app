import { render, screen } from '@testing-library/react';
import { NativeAppRedirect } from '../NativeAppRedirect';

const mockReplace = jest.fn();
const mockIsNativePlatform = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock('@/lib/integrations/capacitor-stub', () => ({
  isNativePlatform: () => mockIsNativePlatform(),
}));

describe('NativeAppRedirect', () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockIsNativePlatform.mockReset();
  });

  it('renders the page unchanged in a browser', () => {
    mockIsNativePlatform.mockReturnValue(false);
    render(
      <NativeAppRedirect to="/login">
        <p>Pro $9.99 per month</p>
      </NativeAppRedirect>
    );
    expect(screen.getByText('Pro $9.99 per month')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('hides the page and redirects inside the native app', () => {
    mockIsNativePlatform.mockReturnValue(true);
    render(
      <NativeAppRedirect to="/login">
        <p>Pro $9.99 per month</p>
      </NativeAppRedirect>
    );
    expect(screen.queryByText('Pro $9.99 per month')).not.toBeInTheDocument();
    expect(screen.getByTestId('native-redirect')).toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith('/login');
  });
});
