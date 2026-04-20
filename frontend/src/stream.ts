import { useEffect, useRef, useState } from 'react';

export function useFeedStream<T = unknown>(initial: T[] = []) {
  const [rows, setRows] = useState<T[]>(initial);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/feed/stream');
    esRef.current = es;
    es.addEventListener('tick', (evt) => {
      try {
        const row = JSON.parse((evt as MessageEvent).data) as T;
        setRows((prev) => [row, ...prev].slice(0, 100));
      } catch { /* ignore */ }
    });
    es.onerror = () => { /* auto-reconnects */ };
    return () => { es.close(); esRef.current = null; };
  }, []);

  return { rows, setRows };
}
