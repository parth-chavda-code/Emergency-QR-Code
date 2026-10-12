import express from "express";
import { errorHandler, notFound } from "./middlewares/errors.js";
import { createUserRouter } from "./routes/user.js";

export function createApp({ jwtSecret } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.locals.jwtSecret = jwtSecret;
  app.use(express.json({ limit: "16kb", inflate: false }));

  app.use("/user", createUserRouter());
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
