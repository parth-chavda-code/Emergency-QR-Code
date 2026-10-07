import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

export function validateConfig(env) {
    const databaseUri = env.dbconnection?.trim();
    if (!databaseUri || !/^mongodb(?:\+srv)?:\/\/[^\s]+$/.test(databaseUri)) {
        throw new Error("dbconnection must be a MongoDB connection string");
    }
    const portText = env.PORT ?? "3000";
    const port = Number(portText);
    if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("PORT must be an integer between 1 and 65535");
    }
    const nodeEnv = env.NODE_ENV ?? "development";
    if (!["development", "test", "production"].includes(nodeEnv)) {
        throw new Error("NODE_ENV must be development, test, or production");
    }
    return Object.freeze({ databaseUri, port, nodeEnv });
}

export function loadConfig() {
    // Resolve relative to the project, not the terminal's working directory.
    dotenv.config({
        path: fileURLToPath(new URL("../.env", import.meta.url)),
        quiet: true,
    });
    return validateConfig(process.env);
}
