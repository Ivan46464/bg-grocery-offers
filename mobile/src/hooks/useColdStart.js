import { useCallback, useEffect, useRef, useState } from "react";
import { waitForData } from "../api";

/**
 * Handles the free-hosting cold start: polls /api/status until the backend is
 * awake and has offers. Returns { ready, status, seconds, error, retry }.
 */
export default function useColdStart() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [seconds, setSeconds] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const abortRef = useRef(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setReady(false);
    setError(null);
    setSeconds(0);
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000);

    waitForData({ signal: controller.signal, onTick: setStatus })
      .then((st) => {
        if (controller.signal.aborted) return;
        setStatus(st);
        setReady(st.total_offers > 0);
        if (st.total_offers === 0) setError("Сървърът отговаря, но още няма оферти. Опитай пак след малко.");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err.message);
      })
      .finally(() => clearInterval(tick));

    return () => {
      clearInterval(tick);
      controller.abort();
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { ready, status, seconds, error, retry };
}
