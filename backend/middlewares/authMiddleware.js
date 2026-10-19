import jwt from "jsonwebtoken";
import {
  findActiveSession,
  isDatabaseFailure,
} from "../security/authSessions.js";

export async function authUser(req, res, next) {
  res.set("Cache-Control", "no-store");
  const token = req.get("Authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token) {
    return res
      .set("WWW-Authenticate", "Bearer")
      .status(401)
      .json({ error: "Authentication required" });
  }
  const secret = req.app.locals.jwtSecret;
  if (!secret) return next(new Error("Authentication configuration missing"));

  let payload;
  try {
    payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      issuer: "emergency-qr-code",
      audience: "emergency-qr-api",
      maxAge: "15m",
    });
    if (
      typeof payload.sub !== "string" ||
      !/^[a-f0-9]{24}$/i.test(payload.sub) ||
      typeof payload.sid !== "string" ||
      !/^[a-f0-9]{24}$/i.test(payload.sid) ||
      !Number.isFinite(payload.exp) ||
      !Number.isFinite(payload.iat) ||
      payload.iat > Math.floor(Date.now() / 1000) ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > 900
    ) {
      throw new jwt.JsonWebTokenError("Invalid token fields");
    }
  } catch (err) {
    if (
      err instanceof jwt.JsonWebTokenError ||
      err instanceof jwt.TokenExpiredError ||
      err instanceof jwt.NotBeforeError
    ) {
      return res
        .set("WWW-Authenticate", "Bearer")
        .status(401)
        .json({ error: "Invalid or expired authentication token" });
    }
    return next(err);
  }

  let session;
  try {
    session = await findActiveSession(payload.sub, payload.sid);
  } catch (err) {
    if (isDatabaseFailure(err)) {
      return res
        .set("Retry-After", "5")
        .status(503)
        .json({
          error:
            "Authentication temporarily unavailable. Please try again later.",
        });
    }
    return next(err);
  }
  if (!session) {
    return res
      .set("WWW-Authenticate", "Bearer")
      .status(401)
      .json({ error: "Invalid or expired authentication token" });
  }

  // Future profile routes must use this verified ID to check profile ownership.
  req.userId = payload.sub;
  req.sessionId = payload.sid;
  req.loginVersion = session.loginVersion;
  return next();
}
