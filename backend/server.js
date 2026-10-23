import http from "node:http";
import { startupFailureMessage } from "./startupErrors.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { connectDB, disconnectDB } from "./db.js";
import { assertFrontendBuild } from "./publicFrontend.js";

let server;
let stopping = false;
let startupStage = "configuration";

async function shutdown(exitCode = 0) {
  if (stopping) {
    if (exitCode !== 0) process.exitCode = exitCode;
    return;
  }
  stopping = true;
  process.exitCode = exitCode;
  const deadline = setTimeout(() => {
    console.error("Shutdown timed out");
    process.exit(1);
  }, 10000);
  deadline.unref();
  let cleanedUp = false;
  try {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await disconnectDB();
    cleanedUp = true;
  } catch {
    console.error("Resource cleanup failed");
    process.exitCode = 1;
  } finally {
    if (cleanedUp) clearTimeout(deadline);
  }
}

async function main() {
  const config = loadConfig();
  if (config.nodeEnv === "production") {
    startupStage = "application";
    assertFrontendBuild();
  }
  startupStage = "database";
  await connectDB(config.databaseUri);
  if (stopping) {
    await disconnectDB();
    return;
  }
  startupStage = "application";
  server = http.createServer(createApp(config));
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  startupStage = "http";
  let startupError;
  await new Promise((resolve, reject) => {
    startupError = reject;
    server.once("error", startupError);
    server.listen(config.port, resolve);
  });
  server.off("error", startupError);
  server.on("error", () => {
    console.error("HTTP server failure");
    void shutdown(1);
  });
  process.once("SIGINT", () => void shutdown()); // ctl + c
  process.once("SIGTERM", () => void shutdown()); // when any other programs or OS send stop signal
  if (!stopping) console.log(`Backend listening on port ${config.port}`);
}

process.once("uncaughtException", () => {
  console.error("Unexpected process failure");
  void shutdown(1);
});
process.once("unhandledRejection", () => {
  console.error("Unhandled asynchronous failure");
  void shutdown(1);
});
main().catch(async (error) => {
  console.error(startupFailureMessage(startupStage, error));
  await shutdown(1);
});
