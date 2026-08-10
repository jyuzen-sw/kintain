"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppIcon } from "./icons";

export function PwaStatus() {
  const [online, setOnline] = useState(true);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const refreshing = useRef(false);

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          setWaitingWorker(registration.waiting);
        }
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              setWaitingWorker(worker);
            }
          });
        });
      }).catch(() => undefined);

      const handleControllerChange = () => {
        if (!refreshing.current) return;
        refreshing.current = false;
        window.location.reload();
      };
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        handleControllerChange,
      );
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          handleControllerChange,
        );
      };
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    refreshing.current = true;
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
  }, [waitingWorker]);

  if (online && !waitingWorker) return null;

  return (
    <div className="pwa-status-stack" aria-live="polite">
      {!online ? (
        <div className="connection-banner" role="status">
          <AppIcon name="wifi-off" />
          <span>オフラインです。打刻や保存は接続後に再試行してください。</span>
        </div>
      ) : null}
      {waitingWorker ? (
        <div className="update-banner" role="status">
          <span>新しいバージョンを利用できます。</span>
          <button className="text-button text-button--on-strong" onClick={applyUpdate}>
            更新する
          </button>
        </div>
      ) : null}
    </div>
  );
}
