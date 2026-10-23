import { Router } from "express";
import { authUser } from "../middlewares/authMiddleware.js";
import { isDatabaseFailure } from "../security/authSessions.js";
import { QrRequestError, listCredentials, issueCredential, activateCredential, revokeCredential } from "../security/qrCredentials.js";
import { credentialIdSchema, issueQrSchema, qrListSchema, emptyQrBodySchema } from "../validation/qr.js";

const qrRouter = Router();

export function qrFailure(err, res, next) {
  if (err instanceof QrRequestError) {
    if (err.status === 503) res.set("Retry-After", "5");
    return res.status(err.status).json({ error: err.message });
  }
  if (isDatabaseFailure(err)) return res.set("Retry-After", "5").status(503)
    .json({ error: "QR temporarily unavailable. Please try again later." });
  return next(err);
}

qrRouter.get("/", authUser, async (req, res, next) => {
  const parsed = qrListSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid QR list options" });
  try {
    return res.status(200).json(await listCredentials(req.userId, parsed.data));
  } catch (err) { return qrFailure(err, res, next); }
});

qrRouter.post("/", authUser, async (req, res, next) => {
  if (!req.is("application/json")) return res.status(415).json({ error: "Content-Type must be application/json" });
  const parsed = issueQrSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid QR issuance data" });
  try {
    return res.status(201).json(await issueCredential(req.userId, parsed.data.profileRevision,
      req.app.locals.profileEncryptionKey, req.app.locals.publicBaseUrl));
  } catch (err) { return qrFailure(err, res, next); }
});

// No body is needed for activation/revocation; if present, it must be an empty JSON object.
function validateAction(req, res, next) {
  if (!credentialIdSchema.safeParse(req.params.id).success) return res.status(400).json({ error: "Invalid QR credential ID" });
  if (req.headers["transfer-encoding"] || Number(req.headers["content-length"] ?? 0) > 0) {
    if (!req.is("application/json")) return res.status(415).json({ error: "Content-Type must be application/json" });
    if (!emptyQrBodySchema.safeParse(req.body).success) return res.status(400).json({ error: "QR action does not accept body fields" });
  }
  return next();
}

qrRouter.post("/:id/activate", authUser, validateAction, async (req, res, next) => {
  try {
    return res.status(200).json(await activateCredential(req.userId, req.params.id, req.app.locals.profileEncryptionKey));
  } catch (err) { return qrFailure(err, res, next); }
});

qrRouter.post("/:id/revoke", authUser, validateAction, async (req, res, next) => {
  try {
    return res.status(200).json(await revokeCredential(req.userId, req.params.id));
  } catch (err) { return qrFailure(err, res, next); }
});

export { qrRouter };
