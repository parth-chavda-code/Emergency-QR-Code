export class ApiError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.fields = fields;
  }
}

async function post(path, body) {
  let response;
  try {
    response = await fetch(`/api/user/${path}`, {
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
