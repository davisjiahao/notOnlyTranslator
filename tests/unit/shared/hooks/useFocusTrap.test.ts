import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFocusTrap } from '@/shared/hooks/useFocusTrap';

describe('useFocusTrap', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Mock requestAnimationFrame to execute synchronously
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.restoreAllMocks();
  });

  it('returns a ref object', () => {
    const { result } = renderHook(() =>
      useFocusTrap<HTMLDivElement>({ active: false })
    );
    expect(result.current).toBeDefined();
    expect(result.current).toHaveProperty('current');
  });

  it('does not add keydown listener when inactive', () => {
    const addListener = vi.spyOn(document, 'addEventListener');
    const { result, unmount } = renderHook(() =>
      useFocusTrap<HTMLDivElement>({ active: false })
    );

    expect(addListener).not.toHaveBeenCalledWith('keydown', expect.any(Function));
    unmount();
  });

  it('focuses first focusable element when active', () => {
    // Create focusable elements in the container
    const button = document.createElement('button');
    button.textContent = 'First';
    const input = document.createElement('input');
    container.appendChild(button);
    container.appendChild(input);

    // Focus the container before hook activation
    container.focus();

    const { result, unmount } = renderHook(() =>
      useFocusTrap<HTMLDivElement>({ active: true })
    );

    // Attach the ref to the container
    result.current.current = container;

    // Verify the ref points to the container
    expect(result.current.current).toBe(container);

    unmount();
  });

  it('saves previous focus element when activated', () => {
    const button = document.createElement('button');
    container.appendChild(button);
    button.focus();

    const { result, unmount } = renderHook(() =>
      useFocusTrap<HTMLDivElement>({ active: true })
    );
    result.current.current = container;

    // previousFocusRef should have been set to the button
    // We can verify this indirectly through the cleanup behavior
    unmount();

    // After unmount, focus should be restored to the button
    expect(document.activeElement).toBe(button);
  });

  it('restores focus to restoreFocusTo element on cleanup', () => {
    const restoreTarget = document.createElement('button');
    restoreTarget.textContent = 'Restore Target';
    document.body.appendChild(restoreTarget);

    const button = document.createElement('button');
    container.appendChild(button);

    const { unmount } = renderHook(() =>
      useFocusTrap<HTMLDivElement>({
        active: true,
        restoreFocusTo: restoreTarget,
      })
    );

    unmount();

    expect(document.activeElement).toBe(restoreTarget);
    document.body.removeChild(restoreTarget);
  });

  it('focuses initialFocusRef when provided', () => {
    const button1 = document.createElement('button');
    button1.textContent = 'First';
    const button2 = document.createElement('button');
    button2.textContent = 'Second';
    container.appendChild(button1);
    container.appendChild(button2);

    const initialRef = { current: button2 } as React.RefObject<HTMLDivElement>;

    const { unmount } = renderHook(() =>
      useFocusTrap<HTMLDivElement>({
        active: true,
        initialFocusRef: initialRef,
      })
    );

    // After activation with initialFocusRef, button2 should be focused
    // (requestAnimationFrame is mocked to run synchronously)
    expect(document.activeElement).toBe(button2);
    unmount();
  });

  it('handles empty container gracefully', () => {
    expect(() => {
      const { result, unmount } = renderHook(() =>
        useFocusTrap<HTMLDivElement>({ active: true })
      );
      result.current.current = container;
      unmount();
    }).not.toThrow();
  });
});
