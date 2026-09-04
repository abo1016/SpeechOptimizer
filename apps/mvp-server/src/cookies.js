import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split("=")).filter(([key, value]) => key && value)
    .map(([key, value]) => [key, decodeURIComponent(value)]));
}

export function signAnonymous(id, secret) {
  return `${id}.${signature(id, secret)}`;
}

export function verifyAnonymous(value, secret) {
  const [id, provided] = String(value ?? "").split(".");
  if (!id || !provided) return null;
  const expected = signature(id, secret);
  if (expected.length !== provided.length) return null;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided)) ? id : null;
}

export function createAnonymousCookie(secret, secure = false) {
  const id = `anon_${randomUUID()}`;
  return { id, header: cookie("so_anonymous", signAnonymous(id, secret), secure, 31_536_000) };
}

export function sessionCookie(token, secure = false) {
  return cookie("so_session", token, secure, 2_592_000);
}

export function clearCookie(name, secure = false) {
  return cookie(name, "", secure, 0);
}

function signature(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function cookie(name, value, secure, maxAge) {
  const flags = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) flags.push("Secure");
  return flags.join("; ");
}
