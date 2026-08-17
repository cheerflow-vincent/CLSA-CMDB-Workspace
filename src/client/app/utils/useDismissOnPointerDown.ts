import { useEffect, type RefObject } from 'react';

/** Close a popover/menu when the user clicks anywhere outside it. */
export function useDismissOnPointerDown(
  isOpen: boolean,
  menuRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      onDismiss();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isOpen, menuRef, onDismiss]);
}
