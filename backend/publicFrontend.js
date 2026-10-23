import express from "express";
import { fileURLToPath } from "node:url";
import { accessSync, constants } from "node:fs";

const buildDirectory = fileURLToPath(new URL("../frontend/dist/", import.meta.url));

export function assertFrontendBuild() {
  accessSync(`${buildDirectory}index.html`, constants.R_OK);
}

// React uses hash routes under /. Existing QR links use /e/:token.
// Only these browser locations get HTML; API and unknown paths keep their status.
export function mountPublicFrontend(app) {
  const options = { dotfiles: "deny", index: false, redirect: false, maxAge: 0 };
  app.use("/assets", express.static(`${buildDirectory}assets`, options));
  app.use("/fonts", express.static(`${buildDirectory}fonts`, options));
  app.get("/favicon.svg", (req, res, next) => {
    res.sendFile("favicon.svg", { root: buildDirectory }, error => { if (error) next(); });
  });
  function sendApp(req, res, next) {
    if (!["GET", "HEAD"].includes(req.method) || req.accepts(["json", "html"]) !== "html") return next();
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff", "Vary": "Accept" });
    res.sendFile("index.html", { root: buildDirectory, cacheControl: false }, error => {
      if (!error) return;
      if (res.headersSent) return next(error);
      res.status(503).type("text").send("The page is temporarily unavailable. Please try again later.");
    });
  }
  app.get("/", sendApp);
  app.use("/e", sendApp);
}
