import { useEffect, useRef } from 'react';

/**
 * Lets the phone/browser back button close an open modal or drawer instead of leaving
 * the page.
 *
 * Opening pushes a history entry with the same URL; pressing back pops it and we call
 * onClose (only the most recently opened overlay closes). Closing any other way removes
 * that entry again, so history stays as it was. A single global popstate listener keeps
 * nested overlays in order.
 */

type Entry = { id: number; close: () => void };

const stack: Entry[] = [];
let skipPops = 0;   // pops we caused ourselves (removing an entry after a normal close)
let nextId = 1;
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('popstate', () => {
    if (skipPops > 0) {
      skipPops -= 1;
      return;
    }
    stack.pop()?.close();
  });
}

function currentOverlayId(): number | undefined {
  const state = window.history.state as { __overlay?: number } | null;
  return state?.__overlay;
}

export function useBackButtonClose(open: boolean, onClose: (() => void) | undefined) {
  const closeRef = useRef(onClose);
  const entryRef = useRef<Entry | null>(null);
  const timerRef = useRef<number | null>(null);
  const active = open && !!onClose;

  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    listen();

    // React StrictMode runs effects twice: keep the entry pushed by the first run.
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    let entry = entryRef.current;
    if (!entry) {
      entry = {
        id: nextId++,
        close: () => {
          entryRef.current = null;       // its history entry is already gone
          closeRef.current?.();
        },
      };
      entryRef.current = entry;
      window.history.pushState({ ...(window.history.state ?? {}), __overlay: entry.id }, '');
    }
    if (!stack.includes(entry)) stack.push(entry);

    const current = entry;
    return () => {
      const index = stack.indexOf(current);
      if (index !== -1) stack.splice(index, 1);
      if (entryRef.current !== current) return;   // closed by the back button
      // Closed by a button (or unmounted): drop our history entry if it's still current.
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        entryRef.current = null;
        if (currentOverlayId() === current.id) {
          skipPops += 1;
          window.history.back();
        }
      }, 0);
    };
  }, [active]);
}
