import { useEffect, useRef } from 'react';

// Android back button: the newest open layer (sheet, sub-page) closes first.
const stack: { current: () => void }[] = [];

export function useBack(active: boolean, onBack: () => void): void {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    const entry = { current: () => ref.current() };
    stack.push(entry);
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}

/** Close the top layer; false when nothing was open. */
export function handleBack(): boolean {
  const top = stack.at(-1);
  if (!top) return false;
  top.current();
  return true;
}
