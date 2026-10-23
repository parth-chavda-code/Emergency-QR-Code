import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { resolvePublicEmergency } from "../security/publicEmergency.js";
import { isDatabaseFailure } from "../security/authSessions.js";

const unavailable = res => res.status(404).json({ error: "Emergency profile unavailable" });

export function createPublicEmergencyRouter() {
  const router = Router();
  // Apply before parsing the token or returning any error, including rate limits.
  router.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive" });
    res.vary("Accept");
    next();
  });
  router.use(rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: "Too many requests. Please try again later." },
  }));
  router.get("/:token", async (req, res, next) => {
    try {
      const result = await resolvePublicEmergency(req.params.token, req.app.locals.profileEncryptionKey);
      if (!result) return unavailable(res);
      return res.status(200).json(result);
    } catch (err) {
      if (isDatabaseFailure(err)) return res.set("Retry-After", "5").status(503)
        .json({ error: "Emergency profile temporarily unavailable. Please try again later." });
      return next(err);
    }
  });
  // Malformed URL escapes must not become a server error or reveal the URL.
  router.use((err, req, res, next) => {
    if (err instanceof URIError) return unavailable(res);
    return next(err);
  });
  return router;
}
