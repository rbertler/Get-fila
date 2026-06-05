import { useCallback, useRef, useState } from 'react';

export function usePdfWidth(padding = 32): [(node: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(560);
  const roRef = useRef<ResizeObserver | null>(null);

  const callbackRef = useCallback((node: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (!node) return;
    const measure = () => setWidth(node.clientWidth - padding);
    measure();
    roRef.current = new ResizeObserver(measure);
    roRef.current.observe(node);
  }, [padding]);

  return [callbackRef, width];
}
