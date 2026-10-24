import express from "express";
import { errorHandler, notFound } from "./middlewares/errors.js";
import { createUserRouter } from "./routes/user.js";
import { profileRouter } from "./routes/profile.js";
import { qrRouter } from "./routes/qr.js";
import { createPublicEmergencyRouter } from "./routes/publicEmergency.js";
import { mountPublicFrontend } from "./publicFrontend.js";

export function createApp({ jwtSecret, profileEncryptionKey, publicBaseUrl, trustProxyHops = 0 } = {}) {
  const app = express();
  app.disable("x-powered-by");
  // The hop count must match the verified forwarding path; keep 0 for direct access.
  app.set("trust proxy", trustProxyHops);
  app.locals.jwtSecret = jwtSecret;
  app.locals.profileEncryptionKey = profileEncryptionKey;
  app.locals.publicBaseUrl = publicBaseUrl;
  mountPublicFrontend(app);
  app.use("/e", createPublicEmergencyRouter());
  app.use(express.json({ limit: "16kb", inflate: false }));

  app.use("/user", createUserRouter());
  app.use("/user/profile", profileRouter);
  app.use("/user/qr-credentials", qrRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
