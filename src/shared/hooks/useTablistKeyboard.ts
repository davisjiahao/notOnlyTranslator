/**
 * useTablistKeyboard - ARIA tablist arrow-key navigation hook
 *
 * Per ARIA Authoring Practices, tablist must support:
 * - ArrowRight: Move focus to next tab (wraps to first)
 * - ArrowLeft: Move focus to previous tab (wraps to last)
 * - Home: Move focus to first tab
 * - End: Move focus to last tab
 *
 * Follows ARIA "Manual Activation" pattern: arrow keys move both focus AND selection.
 *
 * @param tabCount - Total number of tabs
 * @param activeIndex - Currently active tab index (used for Home/End boundary checks)
 * @param onSelect - Callback to activate the tab at the given index
 * @param getTabElement - Optional callback to get the DOM element at a given index, for focus management
 *
 * @example
 * const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
 * const { onKeyDown } = useTablistKeyboard(3, activeTab, setActiveTab, (i) => tabRefs.current[i]);
 * <button ref={el => tabRefs.current[0] = el} onKeyDown={onKeyDown(0)} ...>Tab 1</button>
 */
export function useTablistKeyboard(
  tabCount: number,
  _activeIndex: number,
  onSelect: (index: number) => void,
  getTabElement?: (index: number) => HTMLElement | null | undefined
) {
  /**
   * Returns an onKeyDown handler for the tab at the given index.
   * Handles ArrowRight, ArrowLeft, Home, End keys to move focus between tabs.
   */
  const onKeyDown = (tabIndex: number) => (e: React.KeyboardEvent) => {
    let nextIndex: number | undefined;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        nextIndex = (tabIndex + 1) % tabCount;
        break;
      case 'ArrowLeft':
        e.preventDefault();
        nextIndex = (tabIndex - 1 + tabCount) % tabCount;
        break;
      case 'Home':
        e.preventDefault();
        nextIndex = 0;
        break;
      case 'End':
        e.preventDefault();
        nextIndex = tabCount - 1;
        break;
      default:
        return;
    }

    if (nextIndex !== undefined) {
      onSelect(nextIndex);
      // WCAG 2.4.3: Move focus to the newly selected tab
      const nextEl = getTabElement?.(nextIndex);
      nextEl?.focus();
    }
  };

  return { onKeyDown };
}
