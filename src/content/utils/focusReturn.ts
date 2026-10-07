/**
 * 保存词条的出现位置。标词与存储同步可能重建 mark，不能只保存旧 DOM 引用。
 * 词条变为普通文本时返回原容器；容器消失后不夺走当前焦点。
 */
export function captureFocusReturn(element: HTMLElement): () => void {
  const parent = element.parentElement;
  const word = element.dataset.word;
  const matches = (): HTMLElement[] => word && parent?.isConnected
    ? Array.from(parent.querySelectorAll<HTMLElement>('[data-word]')).filter(item => item.dataset.word === word)
    : [];
  const occurrence = matches().indexOf(element);

  return () => {
    const destination = element.isConnected ? element
      : parent?.isConnected ? matches()[occurrence] ?? parent : null;
    if (!destination || destination.closest('[aria-hidden="true"], [inert], [hidden]')) return;
    const temporary = !destination.hasAttribute('tabindex') && destination.tabIndex < 0;
    if (temporary) destination.tabIndex = -1;
    destination.focus({ preventScroll: true });
    if (temporary) destination.removeAttribute('tabindex');
  };
}
