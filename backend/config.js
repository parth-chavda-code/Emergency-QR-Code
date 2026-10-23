import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { validateEncryptionKey } from "./security/profileEncryption.js";

export function validatePublicBaseUrl(value, nodeEnv = "development") {
  try {
    if (typeof value !== "string" || !value.trim()) throw new Error();
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
        || url.search || url.hash || url.pathname !== "/"
        || (nodeEnv === "production" && url.protocol !== "https:")) throw new Error();
    return url.origin;
  } catch {
    throw new Error("PUBLIC_BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment; production requires HTTPS");
  }
}

export function validateConfig(env) {
  const databaseUri = env.dbconnection?.trim();
  if (!databaseUri || !/^mongodb(?:\+srv)?:\/\/[^\s]+$/.test(databaseUri)) {
    throw new Error("dbconnection must be a MongoDB connection string");
  }
  const portText = env.PORT ?? "3000";
  const port = Number(portText);
  if (
    !/^\d+$/.test(portText) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  const nodeEnv = env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  const proxyText = env.TRUST_PROXY_HOPS ?? "0";
  if (!["0", "1"].includes(proxyText)) {
    throw new Error("TRUST_PROXY_HOPS must be 0 (direct) or 1 (one trusted upstream proxy)");
  }
  const jwtSecret = env.JWT_SECRET;
  if (
    typeof jwtSecret !== "string" ||
    jwtSecret.trim().length === 0 ||
    Buffer.byteLength(jwtSecret, "utf8") < 32
  ) {
    throw new Error(
      "JWT_SECRET must be a randomly generated secret of at least 32 bytes",
    );
  }
  const profileEncryptionKey = validateEncryptionKey(
    env.PROFILE_ENCRYPTION_KEY,
  );
  if (profileEncryptionKey === jwtSecret) {
    throw new Error("PROFILE_ENCRYPTION_KEY must be different from JWT_SECRET");
  }
  const publicBaseUrl = validatePublicBaseUrl(env.PUBLIC_BASE_URL
    ?? (nodeEnv === "production" ? undefined : `http://localhost:${port}`), nodeEnv);
  return Object.freeze({
    databaseUri,
    port,
    nodeEnv,
    trustProxyHops: Number(proxyText),
    jwtSecret,
    profileEncryptionKey,
    publicBaseUrl,
  });
}

export function loadConfig() {
  // Resolve relative to the project, not the terminal's working directory.
  dotenv.config({
    path: fileURLToPath(new URL("../.env", import.meta.url)),
    quiet: true,
  });
  return validateConfig(process.env);
}
