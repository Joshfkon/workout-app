// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom does not implement scrollIntoView. Components that call it inside a
// setTimeout (e.g. hooks/useKeyboardInset focus-scrolling) crash any test
// whose timers happen to fire before unmount — a timing-dependent flake seen
// in CI (EditableServing). Standard shim: make it a no-op everywhere.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
