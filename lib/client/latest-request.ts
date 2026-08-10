"use client";

import { useCallback, useEffect, useRef } from "react";

export function useLatestRequestGate(): () => () => boolean {
  const sequence = useRef(0);

  useEffect(
    () => () => {
      sequence.current += 1;
    },
    [],
  );

  return useCallback(() => {
    const current = sequence.current + 1;
    sequence.current = current;
    return () => sequence.current === current;
  }, []);
}
