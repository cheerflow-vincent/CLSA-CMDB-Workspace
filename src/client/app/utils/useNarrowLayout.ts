import { useState, useEffect, useRef } from 'react';

const DEFAULT_NARROW_PX = 640;

/** Tracks container width; true when narrower than threshold. */
export function useNarrowContainer(threshold = DEFAULT_NARROW_PX) {
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = (width: number) => setNarrow(width < threshold);
    update(el.getBoundingClientRect().width);

    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0;
      update(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [threshold]);

  return { ref, narrow };
}

/** List/table preference becomes card/grid when the container is narrow. */
export function useEffectiveGridList(
  viewMode: 'grid' | 'list',
  narrow: boolean,
): 'grid' | 'list' {
  return narrow && viewMode === 'list' ? 'grid' : viewMode;
}

/** Table-style list variants become cards when the container is narrow. */
export function useResponsiveListVariant<T extends string>(
  variant: T,
  narrow: boolean,
  cardFallback: T,
  tableLike: T[] = ['table' as T, 'compact' as T],
): T {
  if (narrow && tableLike.includes(variant)) return cardFallback;
  return variant;
}
