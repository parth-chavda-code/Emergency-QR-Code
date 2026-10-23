// Use fixed messages: driver errors can contain credentials or document values.
export function startupFailureMessage(stage, error) {
  if (stage === "configuration") {
    return "Startup failed: invalid configuration. Check dbconnection, PORT, NODE_ENV, TRUST_PROXY_HOPS, JWT_SECRET, PROFILE_ENCRYPTION_KEY, and PUBLIC_BASE_URL in your environment or .env. Do not share their values.";
  }
  if (stage === "database") {
    if (error?.code === 11000 || error?.code === 85 || error?.code === 86) {
      return "Startup failed: database indexes could not be initialized. Check existing data and index definitions; no data was deleted.";
    }
    if (error?.code === 18) {
      return "Startup failed: MongoDB authentication failed. Check the database credentials and permissions privately.";
    }
    return "Startup failed: MongoDB connection or initialization failed. Make sure the configured database is running and reachable. For this project's local replica set, run npm run db:start in a separate terminal and keep it open. For hosted MongoDB, check connectivity and access settings.";
  }
  if (stage === "http" && error?.code === "EADDRINUSE") {
    return "Startup failed: the configured HTTP port is already in use. Stop the existing backend before starting another copy, or choose a free PORT.";
  }
  if (stage === "http" && error?.code === "EACCES") {
    return "Startup failed: permission denied when opening the HTTP port. Choose an available, unprivileged PORT.";
  }
  if (stage === "application" && error?.code === "ENOENT") {
    return "Startup failed: the frontend build is missing. Run npm run build before starting in production.";
  }
  return "Startup failed: application initialization failed. Check the server configuration and local file permissions.";
}
