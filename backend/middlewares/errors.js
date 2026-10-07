const bodyErrors = {
    "entity.parse.failed": [400, "Invalid JSON body"],
    "entity.too.large": [413, "Request body too large"],
    "charset.unsupported": [415, "Unsupported character encoding"],
    "encoding.unsupported": [415, "Unsupported content encoding"],
    "request.aborted": [400, "Request aborted"],
    "request.size.invalid": [400, "Invalid request body size"],
};

export function notFound(req, res) {
    res.status(404).json({ error: "Route not found" });
}

export function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    const knownError = Object.hasOwn(bodyErrors, err?.type)
        ? bodyErrors[err.type]
        : undefined;
    const [status, message] = knownError ?? [500, "Internal server error"];
    if (status === 500) console.error("Unexpected request failure");
    res.status(status).json({ error: message });
}
