import { profilePayload, readProfileResponse } from "./profileForm.js";

export class ApiError extends Error {
  constructor(message, fields = {}, status = 0) {
    super(message);
    this.fields = fields;
    this.status = status;
  }
}

async function post(path, body) {
  let response;
  try {
    response = await fetch(`/user/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(path === "signup"
      ? "We couldn't confirm whether your account was created. Check your connection and try signing in before submitting again."
      : "We couldn't connect. Check your connection and try again.");
  }
  // Never render a proxy error page, driver error, or raw server response.
  if (!response.ok) {
    if (response.status === 409 && path === "signup") {
      throw new ApiError("This email is already registered. Sign in instead.", { email: "An account with this email already exists." });
    }
    if (response.status === 401) throw new ApiError("The email or password is incorrect.");
    if (response.status === 429) throw new ApiError("Too many attempts. Please wait before trying again.");
    if (response.status === 400) throw new ApiError("Please check your details and try again.");
    throw new ApiError("The service is temporarily unavailable. Please try again shortly.");
  }
  try {
    const data = await response.json();
    if (!data.user || typeof data.user.firstName !== "string" || typeof data.user.email !== "string") throw new Error();
    if (path === "login" && (typeof data.token !== "string" || !data.token
      || data.tokenType !== "Bearer" || !Number.isFinite(data.expiresIn)
      || data.expiresIn <= 0 || data.expiresIn > 900)) throw new Error();
    return data;
  } catch {
    throw new ApiError("We couldn't confirm the response. Please try signing in again.");
  }
}

export function signup({ firstName, lastName, email, password }) {
  return post("signup", { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim().toLowerCase(), password });
}

export function login({ email, password }) {
  return post("login", { email: email.trim().toLowerCase(), password });
}

async function authenticatedRequest(path, token, { method = "GET", body, signal } = {}) {
  const encodedBody = body === undefined ? undefined : JSON.stringify(body);
  if (encodedBody && new TextEncoder().encode(encodedBody).length > 16 * 1024) {
    throw new ApiError("This change is too large to send. Shorten some entries or save fewer changes at a time.", {}, 413);
  }
  let response;
  try {
    response = await fetch(`/user/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      ...(encodedBody !== undefined ? { body: encodedBody } : {}),
      credentials: "omit", cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(method === "GET" ? "We couldn't load your profile. Please try again."
      : "We couldn't confirm the request. Your changes are still on this page. Check the saved version before trying again.");
  }
  if (response.status === 401) throw new ApiError("Your session has ended. Please sign in again.", {}, 401);
  if (response.status === 404 && path === "profile" && method === "GET") return null;
  if (response.status === 409) throw new ApiError("The saved profile changed. Review the latest saved version before saving again.", {}, 409);
  if (response.status === 400) throw new ApiError("Please check your profile details and try again.", {}, 400);
  if (response.status === 413) throw new ApiError("This change is too large to send. Shorten some entries or save fewer changes at a time.", {}, 413);
  if (response.status === 429) throw new ApiError("Too many requests. Please wait before trying again.", {}, 429);
  if (!response.ok) throw new ApiError("The service is temporarily unavailable. Please try again shortly.", {}, response.status);
  if (path === "logout") {
    if (response.status !== 204) throw new ApiError("We couldn't confirm sign-out. Please try again.");
    return;
  }
  try { return readProfileResponse(await response.json()); }
  catch { throw new ApiError("We couldn't read the saved profile. Your draft is unchanged. Please check the saved version."); }
}

export function getProfile(token, signal) {
  return authenticatedRequest("profile", token, { signal });
}

export function createProfile(token, form) {
  return authenticatedRequest("profile", token, { method: "POST", body: profilePayload(form) });
}

export function updateProfile(token, changes) {
  // The request is prepared by profileChanges; no account or profile ID is accepted.
  const allowed = ["revision", "displayName", "dob", "bloodType", "allergies", "medicalCondition", "medications", "additionalInformation", "emergencyContact", "sharingConsent"];
  return authenticatedRequest("profile", token, { method: "PATCH",
    body: Object.fromEntries(allowed.filter(key => Object.hasOwn(changes, key)).map(key => [key, changes[key]])) });
}

export function logoutEverywhere(token) {
  return authenticatedRequest("logout", token, { method: "POST" });
}
