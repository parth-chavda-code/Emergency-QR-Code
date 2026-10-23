import { hasPublicInformation, readPublicProfile } from "./publicProfile.js";

export function publicTokenFromPath(path) {
  return /^\/e\/([A-Za-z0-9_-]{43})$/.exec(path)?.[1] ?? null;
}

export async function getPublicEmergency(token, signal) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { state: "unavailable" };
  try {
    const response = await fetch(`/e/${token}`, {
      headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    if (response.status === 404 || response.status === 410) return { state: "unavailable" };
    if (response.status === 429) {
      const retry = response.headers.get("Retry-After");
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 0;
      return { state: "limited", retryAt: Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86400 ? Date.now() + seconds * 1000 : 0 };
    }
    if (!response.ok) return { state: "error" };
    const data = await response.json();
    const profile = readPublicProfile(data?.publicProfile);
    return hasPublicInformation(profile) ? { state: "available", profile } : { state: "unavailable" };
  } catch { return { state: "error" }; }
}
