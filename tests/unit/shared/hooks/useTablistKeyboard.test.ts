import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTablistKeyboard } from '@/shared/hooks/useTablistKeyboard';

describe('useTablistKeyboard', () => {
  const createKeyEvent = (key: string) =>
    ({
      key,
      preventDefault: vi.fn(),
    }) as unknown as React.KeyboardEvent;

  it('returns an onKeyDown factory function', () => {
    const { result } = renderHook(() =>
      useTablistKeyboard(3, 0, vi.fn())
    );
    expect(result.current.onKeyDown).toBeTypeOf('function');
  });

  it('calls onSelect and focuses element on ArrowRight', () => {
    const onSelect = vi.fn();
    const element = { focus: vi.fn() } as unknown as HTMLElement;
    const getTabElement = vi.fn().mockReturnValue(element);

    const { result } = renderHook(() =>
      useTablistKeyboard(3, 0, onSelect, getTabElement)
    );

    result.current.onKeyDown(0)(createKeyEvent('ArrowRight'));

    expect(onSelect).toHaveBeenCalledWith(1);
    expect(element.focus).toHaveBeenCalled();
  });

  it('wraps to first tab on ArrowRight from last tab', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useTablistKeyboard(3, 2, onSelect)
    );

    result.current.onKeyDown(2)(createKeyEvent('ArrowRight'));

    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('calls onSelect and focuses element on ArrowLeft', () => {
    const onSelect = vi.fn();
    const element = { focus: vi.fn() } as unknown as HTMLElement;
    const getTabElement = vi.fn().mockReturnValue(element);

    const { result } = renderHook(() =>
      useTablistKeyboard(3, 1, onSelect, getTabElement)
    );

    result.current.onKeyDown(1)(createKeyEvent('ArrowLeft'));

    expect(onSelect).toHaveBeenCalledWith(0);
    expect(element.focus).toHaveBeenCalled();
  });

  it('wraps to last tab on ArrowLeft from first tab', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useTablistKeyboard(3, 0, onSelect)
    );

    result.current.onKeyDown(0)(createKeyEvent('ArrowLeft'));

    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('jumps to first tab on Home', () => {
    const onSelect = vi.fn();
    const element = { focus: vi.fn() } as unknown as HTMLElement;
    const getTabElement = vi.fn().mockReturnValue(element);

    const { result } = renderHook(() =>
      useTablistKeyboard(3, 2, onSelect, getTabElement)
    );

    result.current.onKeyDown(2)(createKeyEvent('Home'));

    expect(onSelect).toHaveBeenCalledWith(0);
    expect(element.focus).toHaveBeenCalled();
  });

  it('jumps to last tab on End', () => {
    const onSelect = vi.fn();
    const element = { focus: vi.fn() } as unknown as HTMLElement;
    const getTabElement = vi.fn().mockReturnValue(element);

    const { result } = renderHook(() =>
      useTablistKeyboard(3, 0, onSelect, getTabElement)
    );

    result.current.onKeyDown(0)(createKeyEvent('End'));

    expect(onSelect).toHaveBeenCalledWith(2);
    expect(element.focus).toHaveBeenCalled();
  });

  it('does not call onSelect for non-navigation keys', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useTablistKeyboard(3, 0, onSelect)
    );

    result.current.onKeyDown(0)(createKeyEvent('Enter'));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('calls preventDefault for navigation keys', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useTablistKeyboard(3, 0, onSelect)
    );

    ['ArrowRight', 'ArrowLeft', 'Home', 'End'].forEach(key => {
      const event = createKeyEvent(key);
      result.current.onKeyDown(0)(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });
  });

  it('does not focus element when getTabElement is not provided', () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useTablistKeyboard(3, 0, onSelect)
    );

    // Should not throw even without element ref
    expect(() => result.current.onKeyDown(0)(createKeyEvent('ArrowRight'))).not.toThrow();
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('does not throw when getTabElement returns null', () => {
    const onSelect = vi.fn();
    const getTabElement = vi.fn().mockReturnValue(null);

    const { result } = renderHook(() =>
      useTablistKeyboard(3, 0, onSelect, getTabElement)
    );

    expect(() => result.current.onKeyDown(0)(createKeyEvent('ArrowRight'))).not.toThrow();
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
