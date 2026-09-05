/** @param {unknown} body @param {ResponseInit} [init] */
export function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** @param {string[]} methods */
export function methodNotAllowed(methods) {
  return jsonResponse(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } },
    { status: 405, headers: { allow: methods.join(", ") } },
  );
}

export function apiNotFound() {
  return jsonResponse(
    { error: { code: "NOT_FOUND", message: "API route not found" } },
    { status: 404 },
  );
}
