/**
 * Tests for components/ui/Input.tsx
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../Input';

describe('Input', () => {
  // ============================================
  // RENDERING TESTS
  // ============================================

  it('renders input element', () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
  });

  it('renders with label', () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('associates label with input via id', () => {
    render(<Input label="Username" />);
    const input = screen.getByLabelText('Username');
    expect(input).toHaveAttribute('id', 'username');
  });

  it('uses custom id when provided', () => {
    render(<Input label="Name" id="custom-id" />);
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('id', 'custom-id');
  });

  // ============================================
  // TYPE TESTS
  // ============================================

  it('defaults to text type', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toHaveAttribute('type', 'text');
  });

  it('accepts password type', () => {
    render(<Input type="password" placeholder="Password" />);
    const input = screen.getByPlaceholderText('Password');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('accepts email type', () => {
    render(<Input type="email" placeholder="Email" />);
    const input = screen.getByPlaceholderText('Email');
    expect(input).toHaveAttribute('type', 'email');
  });

  it('accepts number type', () => {
    render(<Input type="number" aria-label="Weight" />);
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveAttribute('type', 'number');
  });

  // ============================================
  // ERROR STATE TESTS
  // ============================================

  it('displays error message', () => {
    render(<Input error="This field is required" />);
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('applies error styles when error is present', () => {
    render(<Input error="Invalid input" placeholder="Test" />);
    const input = screen.getByPlaceholderText('Test');
    expect(input).toHaveClass('border-danger-500');
  });

  it('hides hint when error is shown', () => {
    render(<Input hint="Enter your email" error="Invalid email" />);
    expect(screen.getByText('Invalid email')).toBeInTheDocument();
    expect(screen.queryByText('Enter your email')).not.toBeInTheDocument();
  });

  // ============================================
  // HINT TESTS
  // ============================================

  it('displays hint text', () => {
    render(<Input hint="Must be at least 8 characters" />);
    expect(screen.getByText('Must be at least 8 characters')).toBeInTheDocument();
  });

  it('applies hint styles', () => {
    render(<Input hint="Helper text" />);
    const hint = screen.getByText('Helper text');
    expect(hint).toHaveClass('text-surface-500');
  });

  // ============================================
  // ICON TESTS
  // ============================================

  it('renders left icon', () => {
    render(
      <Input
        leftIcon={<span data-testid="left-icon">🔍</span>}
        placeholder="Search"
      />
    );
    expect(screen.getByTestId('left-icon')).toBeInTheDocument();
  });

  it('renders right icon', () => {
    render(
      <Input
        rightIcon={<span data-testid="right-icon">✓</span>}
        placeholder="Input"
      />
    );
    expect(screen.getByTestId('right-icon')).toBeInTheDocument();
  });

  it('adds padding for left icon', () => {
    render(
      <Input leftIcon={<span>🔍</span>} placeholder="Search" />
    );
    const input = screen.getByPlaceholderText('Search');
    expect(input).toHaveClass('pl-10');
  });

  it('adds padding for right icon', () => {
    render(
      <Input rightIcon={<span>✓</span>} placeholder="Input" />
    );
    const input = screen.getByPlaceholderText('Input');
    expect(input).toHaveClass('pr-10');
  });

  // ============================================
  // INTERACTION TESTS
  // ============================================

  it('handles onChange events', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<Input onChange={onChange} placeholder="Type here" />);

    const input = screen.getByPlaceholderText('Type here');
    await user.type(input, 'hello');

    expect(onChange).toHaveBeenCalled();
    expect(input).toHaveValue('hello');
  });

  it('handles controlled value', () => {
    const { rerender } = render(<Input value="initial" onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('initial');

    rerender(<Input value="updated" onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('updated');
  });

  it('handles focus and blur', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    render(<Input onFocus={onFocus} onBlur={onBlur} placeholder="Focus test" />);

    const input = screen.getByPlaceholderText('Focus test');

    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalled();
  });

  // ============================================
  // DISABLED STATE TESTS
  // ============================================

  it('can be disabled', () => {
    render(<Input disabled placeholder="Disabled" />);
    expect(screen.getByPlaceholderText('Disabled')).toBeDisabled();
  });

  // ============================================
  // CUSTOM PROPS TESTS
  // ============================================

  it('accepts custom className', () => {
    render(<Input className="custom-class" placeholder="Custom" />);
    const input = screen.getByPlaceholderText('Custom');
    expect(input).toHaveClass('custom-class');
  });

  it('passes through HTML input attributes', () => {
    render(
      <Input
        placeholder="Test"
        maxLength={10}
        required
        data-testid="custom-input"
      />
    );

    const input = screen.getByPlaceholderText('Test');
    expect(input).toHaveAttribute('maxLength', '10');
    expect(input).toHaveAttribute('required');
    expect(input).toHaveAttribute('data-testid', 'custom-input');
  });

  it('forwards ref correctly', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} placeholder="Ref Input" />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.placeholder).toBe('Ref Input');
  });

  // ============================================
  // ACCESSIBILITY TESTS
  // ============================================

  it('has accessible focus styles', () => {
    render(<Input placeholder="Focusable" />);
    const input = screen.getByPlaceholderText('Focusable');
    expect(input).toHaveClass('focus:ring-2');
  });

  it('labels are properly associated', () => {
    render(<Input label="Email Address" />);

    // Should be findable by label text
    const input = screen.getByLabelText('Email Address');
    expect(input).toBeInTheDocument();
  });

  it('error messages are accessible', () => {
    render(<Input error="Email is required" label="Email" />);

    // Error text should be visible
    expect(screen.getByText('Email is required')).toBeInTheDocument();
  });
});
