import { createHash, randomBytes } from "node:crypto";

export function digestQrToken(token) {
  if (
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    Buffer.from(token, "base64url").toString("base64url") !== token
  ) {
    throw new Error("Invalid QR token");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateQrToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenDigest: digestQrToken(token) };
}
