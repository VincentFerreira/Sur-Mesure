import { useEffect, useRef } from 'react';

const VISIBILITY_DELAY_MS = 1000;

// Fires `onVisible` once the returned ref's element has been continuously visible in
// the viewport for VISIBILITY_DELAY_MS. First IntersectionObserver usage in this
// codebase — kept deliberately minimal (single-purpose, not a generic visibility
// library) since there's no existing pattern here to extend.
export function useMarkViewedOnVisible(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled || !ref.current) return;
    const el = ref.current;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        timer = setTimeout(onVisible, VISIBILITY_DELAY_MS);
      } else if (timer) {
        clearTimeout(timer);
      }
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, onVisible]);

  return ref;
}
