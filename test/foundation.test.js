import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import express from "express";
import { createApp } from "../backend/app.js";
import { validateConfig } from "../backend/config.js";
import { errorHandler } from "../backend/middlewares/errors.js";

const serverPath = fileURLToPath(new URL("../backend/server.js", import.meta.url));

async function serve(t, app) {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
    }));
    return `http://127.0.0.1:${server.address().port}`;
}

function startBackend(env) {
    return spawn(process.execPath, [serverPath], {
        cwd: "/tmp", // Startup must find the project .env independent of cwd.
        env: { ...process.env, NODE_ENV: "test", ...env },
        stdio: ["ignore", "pipe", "pipe"],
    });
}

async function failedStartup(t, env) {
    const child = startBackend(env);
    let output = "";
    child.stdout.on("data", (chunk) => output += chunk);
    child.stderr.on("data", (chunk) => output += chunk);
    t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
    const [code, signal] = await once(child, "close");
    assert.equal(code, 1);
    assert.equal(signal, null);
    assert.match(output, /Startup failed/);
    assert.doesNotMatch(output, /Backend listening|mongodb:\/\/|sensitive-password/);
}

test("configuration defaults and invalid values", () => {
    const base = { dbconnection: "mongodb://127.0.0.1:27017/foundation" };
    assert.deepEqual(validateConfig(base), {
        databaseUri: base.dbconnection, port: 3000, nodeEnv: "development",
    });
    for (const dbconnection of [undefined, "", "https://example.com", "mongodb://", "mongodb://bad host"]) {
        assert.throws(() => validateConfig({ ...base, dbconnection }));
    }
    for (const PORT of ["", "0", "65536", "-1", "3.2", "3000x", " 3000"]) {
        assert.throws(() => validateConfig({ ...base, PORT }));
    }
    assert.throws(() => validateConfig({ ...base, NODE_ENV: "invalid" }));
});

test("app import and creation have no startup side effects", { timeout: 5000 }, async () => {
    const child = spawn(process.execPath, ["--input-type=module", "-e",
        `import { createApp } from ${JSON.stringify(new URL("../backend/app.js", import.meta.url).href)}; createApp();`],
        { env: { ...process.env, dbconnection: "" }, stdio: "pipe" });
    const [code] = await once(child, "close");
    assert.equal(code, 0);
});

test("no business or health routes are exposed", async (t) => {
    const base = await serve(t, createApp());
    for (const [method, path] of [["GET", "/"], ["GET", "/health"], ["POST", "/user/signup"],
        ["POST", "/user/login"], ["POST", "/profile/create"], ["GET", "/emergency/token"]]) {
        const res = await fetch(base + path, { method });
        assert.equal(res.status, 404);
        assert.deepEqual(await res.json(), { error: "Route not found" });
        assert.equal(res.headers.get("x-powered-by"), null);
    }
});

test("JSON parsing failures have safe, appropriate status codes", async (t) => {
    const base = await serve(t, createApp());
    const cases = [
        [{ "content-type": "application/json" }, '{"secret":', 400, "Invalid JSON body"],
        [{ "content-type": "application/json" }, JSON.stringify({ secret: "x".repeat(17000) }), 413, "Request body too large"],
        [{ "content-type": "application/json; charset=invalid" }, "{}", 415, "Unsupported character encoding"],
        [{ "content-type": "application/json", "content-encoding": "invalid" }, "{}", 415, "Unsupported content encoding"],
        [{ "content-type": "application/json", "content-encoding": "gzip" }, "corrupt compressed body", 415, "Unsupported content encoding"],
    ];
    for (const [headers, body, status, message] of cases) {
        const res = await fetch(base, { method: "POST", headers, body });
        assert.equal(res.status, status);
        assert.deepEqual(await res.json(), { error: message });
    }
});

test("unexpected async failures return 500 without exposing internals", async (t) => {
    const app = express();
    app.get("/test-only", async () => { throw new Error("sensitive-password"); });
    app.use(errorHandler);
    const base = await serve(t, app);
    const res = await fetch(base + "/test-only");
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Internal server error" });
});

test("invalid config fails startup safely", { timeout: 5000 }, async (t) => {
    await failedStartup(t, { dbconnection: "", PORT: "3000" });
});

test("unavailable database fails startup within a bounded time", { timeout: 12000 }, async (t) => {
    // Reserve a TCP port and drop every connection, avoiding any real database.
    const blocker = http.createServer();
    blocker.on("connection", (socket) => socket.destroy());
    blocker.listen(0, "127.0.0.1");
    await once(blocker, "listening");
    t.after(() => new Promise((resolve) => blocker.close(resolve)));
    await failedStartup(t, {
        dbconnection: `mongodb://user:sensitive-password@127.0.0.1:${blocker.address().port}/foundation`,
        PORT: "3000",
    });
});

const integrationUri = process.env.TEST_MONGODB_URI;

for (const signal of ["SIGTERM", "SIGINT"]) {
    test(`database-connected startup and ${signal} shutdown`, {
        skip: !integrationUri, timeout: 15000,
    }, async (t) => {
        const reservation = http.createServer();
        reservation.listen(0, "127.0.0.1");
        await once(reservation, "listening");
        const port = reservation.address().port;
        await new Promise((resolve) => reservation.close(resolve));
        const child = startBackend({ dbconnection: integrationUri, PORT: String(port) });
        t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
        const closed = once(child, "close");
        let output = "";
        child.stderr.on("data", (chunk) => output += chunk);
        await new Promise((resolve, reject) => {
            child.stdout.on("data", (chunk) => {
                output += chunk;
                if (output.includes("Backend listening")) resolve();
            });
            child.once("error", reject);
            child.once("exit", () => reject(new Error("Backend exited before listening")));
        });
        const res = await fetch(`http://127.0.0.1:${port}/`);
        assert.equal(res.status, 404);
        await res.json();
        child.kill(signal);
        const [code, exitSignal] = await closed;
        assert.equal(code, 0, output);
        assert.equal(exitSignal, null);
        assert.doesNotMatch(output, /Startup failed|cleanup failed|timed out/);
    });
}

test("occupied HTTP port fails startup and closes the database", {
    skip: !integrationUri, timeout: 15000,
}, async (t) => {
    const blocker = http.createServer();
    // Match the backend's default bind address to guarantee a conflict.
    blocker.listen(0);
    await once(blocker, "listening");
    t.after(() => new Promise((resolve) => blocker.close(resolve)));
    await failedStartup(t, {
        dbconnection: integrationUri, PORT: String(blocker.address().port),
    });
});
