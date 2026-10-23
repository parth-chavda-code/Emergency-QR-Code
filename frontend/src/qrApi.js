import { ApiError } from "./api.js";
import { hasPublicInformation, readPublicProfile } from "./publicProfile.js";

const validId = value => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);

export function readPublicPreview(data) {
  const result = readPublicProfile(data?.publicProfile);
  if (!Number.isSafeInteger(data.profileRevision) || data.profileRevision < 1
    || typeof data.hasSharedInformation !== "boolean") throw new Error("Invalid preview");
  const hasInformation = hasPublicInformation(result);
  if (hasInformation !== data.hasSharedInformation) throw new Error("Invalid sharing status");
  return { publicProfile: result, profileRevision: data.profileRevision, hasSharedInformation: hasInformation };
}

export function readCredential(value) {
  if (!value || !validId(value.id) || !["pending", "active", "revoked"].includes(value.state)
    || (value.replacesCredentialId !== null && !validId(value.replacesCredentialId))) throw new Error("Invalid QR response");
  return { id: value.id, state: value.state, replacesCredentialId: value.replacesCredentialId };
}

export function readIssuedQr(data) {
  const credential = readCredential(data?.credential);
  const url = new URL(data.qrUrl);
  if (credential.state !== "pending" || !["http:", "https:"].includes(url.protocol)
    || url.username || url.password || url.search || url.hash || data.qrUrl.length > 2048
    || typeof data.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.token)
    || url.pathname !== `/e/${data.token}`) throw new Error("Invalid QR link");
  // Retain only the link needed to render the QR, never a separate raw token.
  return { credential, qrUrl: url.href };
}

async function request(token, path, { body, signal } = {}) {
  const writing = body !== undefined;
  let response;
  try {
    response = await fetch(`/user/${path}`, {
      method: writing ? "POST" : "GET", credentials: "omit", cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(writing ? { "Content-Type": "application/json" } : {}) },
      ...(writing ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(writing ? "We couldn't confirm the QR change. Refresh QR status before doing anything else."
      : "We couldn't load your QR information. Please try again.");
  }
  if (response.status === 401) throw new ApiError("Your session has ended. Please sign in again.", {}, 401);
  if (response.status === 404) throw new ApiError("Your profile or QR could not be found. Refresh the status or check your profile.", {}, 404);
  if (response.status === 409) throw new ApiError("Your saved profile or QR status changed. Refresh and review the latest information before continuing.", {}, 409);
  if (response.status === 429) throw new ApiError("Too many requests. Please wait before retrying.", {}, 429);
  if (!response.ok) throw new ApiError(writing ? "The QR change could not be confirmed. Refresh QR status before retrying."
    : "QR information is temporarily unavailable. Please retry.", {}, response.status);
  try { return await response.json(); }
  catch { throw new ApiError("We couldn't read the response. Refresh QR status before continuing."); }
}

export async function getPublicPreview(token, signal) {
  const data = await request(token, "profile/public-preview", { signal });
  try { return readPublicPreview(data); }
  catch { throw new ApiError("We couldn't read your public preview. Please retry."); }
}

export async function getQrStatus(token, signal) {
  const credentials = [];
  const ids = new Set();
  const cursors = new Set();
  let cursor;
  // Active/pending records may be behind older revoked records: read every page.
  do {
    const data = await request(token, `qr-credentials?limit=50${cursor ? `&cursor=${cursor}` : ""}`, { signal });
    try {
      if (!Array.isArray(data.credentials) || data.credentials.length > 50
        || (data.nextCursor !== null && !validId(data.nextCursor))) throw new Error();
      for (const record of data.credentials) {
        const credential = readCredential(record);
        if (ids.has(credential.id)) throw new Error();
        ids.add(credential.id);
        if (credential.state !== "revoked") credentials.push(credential);
      }
      cursor = data.nextCursor;
      if (cursor && (cursors.has(cursor) || cursors.size >= 100)) throw new Error();
      if (cursor) cursors.add(cursor);
    } catch { throw new ApiError("We couldn't read your QR status. Please retry."); }
  } while (cursor);
  if (["active", "pending"].some(state => credentials.filter(record => record.state === state).length > 1)) {
    throw new ApiError("Your QR status needs checking. Please retry before making changes.");
  }
  return { active: credentials.find(record => record.state === "active") ?? null,
    pending: credentials.find(record => record.state === "pending") ?? null };
}

export async function issueQr(token, profileRevision) {
  if (!Number.isSafeInteger(profileRevision) || profileRevision < 1) throw new ApiError("Refresh your public preview first.");
  const data = await request(token, "qr-credentials", { body: { profileRevision } });
  try { return readIssuedQr(data); }
  catch { throw new ApiError("We couldn't read the new QR link. Refresh QR status before continuing."); }
}

async function changeQr(token, id, action, expectedState) {
  if (!validId(id)) throw new ApiError("Refresh QR status first.");
  const data = await request(token, `qr-credentials/${id}/${action}`, { body: {} });
  try {
    const credential = readCredential(data?.credential);
    if (credential.id !== id || credential.state !== expectedState) throw new Error();
    return credential;
  } catch { throw new ApiError("We couldn't confirm the QR response. Refresh QR status before continuing."); }
}

export const activateQr = (token, id) => changeQr(token, id, "activate", "active");
export const revokeQr = (token, id) => changeQr(token, id, "revoke", "revoked");
