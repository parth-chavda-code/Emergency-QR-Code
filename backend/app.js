import express from "express";
import { errorHandler, notFound } from "./middlewares/errors.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb", inflate: false }));

  // Business routes are intentionally inactive during milestone 1.
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
