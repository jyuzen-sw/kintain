import type { PunchLocationInput } from "./api";

const emptyLocation = (
  state: PunchLocationInput["state"],
): PunchLocationInput => ({
  state,
  latitude: null,
  longitude: null,
  accuracyMeters: null,
  capturedAt: null,
});

export function captureOptionalLocation(
  timeoutMilliseconds = 4_000,
): Promise<PunchLocationInput> {
  if (!("geolocation" in navigator)) {
    return Promise.resolve(emptyLocation("unavailable"));
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          state: "granted",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString(),
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          resolve(emptyLocation("denied"));
          return;
        }
        if (error.code === error.TIMEOUT) {
          resolve(emptyLocation("timeout"));
          return;
        }
        resolve(emptyLocation("unavailable"));
      },
      {
        enableHighAccuracy: false,
        maximumAge: 30_000,
        timeout: timeoutMilliseconds,
      },
    );
  });
}
