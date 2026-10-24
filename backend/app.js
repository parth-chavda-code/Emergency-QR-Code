import express from "express";
import { errorHandler, notFound } from "./middlewares/errors.js";
import { createUserRouter } from "./routes/user.js";
import { profileRouter } from "./routes/profile.js";
import { qrRouter } from "./routes/qr.js";
import { createPublicEmergencyRouter } from "./routes/publicEmergency.js";
import { mountPublicFrontend } from "./publicFrontend.js";
import { proxyDiagnostics } from "./middlewares/proxyDiagnostics.js";

export function createApp({ jwtSecret, profileEncryptionKey, publicBaseUrl, trustProxyHops = 0, proxyDiagnosticsKey } = {}) {
  const app = express();
  app.disable("x-powered-by");
  // Enable only for a deployment whose immediate upstream proxy is trusted.
  app.set("trust proxy", trustProxyHops);
  if (proxyDiagnosticsKey) app.use(proxyDiagnostics(proxyDiagnosticsKey));
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
