import express from "express";
import { errorHandler, notFound } from "./middlewares/errors.js";
import { createUserRouter } from "./routes/user.js";
import { profileRouter } from "./routes/profile.js";

export function createApp({ jwtSecret, profileEncryptionKey } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.locals.jwtSecret = jwtSecret;
  app.locals.profileEncryptionKey = profileEncryptionKey;
  app.use(express.json({ limit: "16kb", inflate: false }));

  app.use("/user", createUserRouter());
  app.use("/user/profile", profileRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
