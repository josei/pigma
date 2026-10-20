import { useEffect } from 'react';

/**
 * Escape closes a modal dialog while it is open. The listener runs in the capture phase and
 * stops the event there, so the keyboard shortcuts underneath do not also act on it (Escape
 * would otherwise clear the selection behind the dialog).
 */
export function useEscapeToClose(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);
}
