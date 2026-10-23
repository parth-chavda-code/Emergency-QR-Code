import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const base64 = z
  .string()
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const envelopeSchema = z.strictObject({
  version: z.literal(1),
  iv: base64.refine((value) => Buffer.from(value, "base64").length === 12),
  tag: base64.refine((value) => Buffer.from(value, "base64").length === 16),
  ciphertext: base64.min(4).max(100000),
});

export function validateEncryptionKey(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(
      "PROFILE_ENCRYPTION_KEY must contain 64 hexadecimal characters",
    );
  }
  return value;
}

function contextBytes(context) {
  if (typeof context !== "string" || context.length === 0)
    throw new Error("Encryption context is required");
  return Buffer.from(`emergency-qr:profile:v1:${context}`, "utf8");
}

export function encryptJson(value, key, context) {
  const keyBytes = Buffer.from(validateEncryptionKey(key), "hex"); //converts hex encryption key into bytes
  const plaintext = JSON.stringify(value); // converts json object into string
  if (plaintext === undefined || Buffer.byteLength(plaintext, "utf8") > 64000) {
    throw new Error("Invalid profile payload");
  }
  const iv = randomBytes(12); //random 12 bytes
  const cipher = createCipheriv("aes-256-gcm", keyBytes, iv, {
    // keyBytes = encryption key in bytes, AES-256-GCM requires a 256-bit key (32 bytes) that's why we convert keyBytes into 32 bytes
    authTagLength: 16,
  });
  // Bind ciphertext to its profile and purpose; copied/swapped envelopes fail.
  cipher.setAAD(contextBytes(context));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"), // converts plain-text into bytes
    cipher.final(), //shows complete
  ]);
  return {
    version: 1,
    iv: iv.toString("base64"), // converts bytes into base64
    tag: cipher.getAuthTag().toString("base64"), // converts bytes into base64
    ciphertext: ciphertext.toString("base64"), // converts bytes into base64
  };
}

export function decryptJson(envelope, key, context) {
  try {
    const parsed = envelopeSchema.parse(envelope); // check the envelope contains version,iv,tag,ciphertext as per rules or not
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(validateEncryptionKey(key), "hex"), //converts hex encryption key into bytes
      Buffer.from(parsed.iv, "base64"), // converts base64 into bytes, remember we store envelope into base64
      { authTagLength: 16 },
    );
    decipher.setAAD(contextBytes(context)); //it sends the same exact context when encrypted
    decipher.setAuthTag(Buffer.from(parsed.tag, "base64")); //supplies the auth tag into bytes but not verify it
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, "base64")), //converts ciphertext that is the emergency info into bytes
      decipher.final(), //finishes decryption and stores in bytes and verifies the authentication tag
    ]);
    return JSON.parse(plaintext.toString("utf8")); // convert the bytes into normal json object
  } catch {
    throw new Error("Profile information could not be decrypted");
  }
}
