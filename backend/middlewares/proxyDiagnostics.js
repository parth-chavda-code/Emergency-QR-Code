import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

// Temporary staging diagnostic. No new endpoint and no logging for ordinary traffic.
export function proxyDiagnostics(key) {
  const expected = Buffer.from(key, "utf8");
  let records = 0;
  const address = value => typeof value === "string" && isIP(value) ? value : null;

  return (req, res, next) => {
    const supplied = req.get("X-Proxy-Diagnostic-Key");
    if (records >= 6 || req.method !== "POST" || req.path !== "/user/login"
      || typeof supplied !== "string" || Buffer.byteLength(supplied, "utf8") !== expected.length
      || !timingSafeEqual(Buffer.from(supplied, "utf8"), expected)) return next();

    const forwarded = (req.get("X-Forwarded-For") ?? "").split(",").map(value => value.trim()).filter(Boolean);
    console.info(JSON.stringify({
      event: "proxy-diagnostic",
      record: ++records,
      trustedProxyHops: req.app.get("trust proxy"),
      socketAddress: address(req.socket.remoteAddress),
      selectedAddress: address(req.ip),
      selectedChain: req.ips.slice(0, 8).map(address),
      forwardedAddresses: forwarded.slice(0, 8).map(address),
      forwardedTruncated: forwarded.length > 8,
      cloudflareAddress: address(req.get("CF-Connecting-IP")),
      realAddress: address(req.get("X-Real-IP")),
    }));
    next();
  };
}
