const encoder = new TextEncoder();

/** Web Crypto SHA-256 输出十六进制，供 D1 token 摘要和幂等指纹共用。 */
export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(value));
  return hex(new Uint8Array(digest));
}

/** HMAC-SHA256 只在内存使用 secret，结果编码为 URL 安全字符串。 */
export async function hmacBase64Url(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64Url(new Uint8Array(signature));
}

/** AWS SigV4 需要原始 HMAC bytes，因此单独暴露二进制版本。 */
export async function hmacBytes(key, value) {
  const imported = await crypto.subtle.importKey(
    "raw", toArrayBuffer(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", imported, encoder.encode(value));
  return new Uint8Array(signature);
}

/** 生成足够熵的 bearer token；token 只返回调用方，持久化层保存摘要。 */
export function randomToken(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64Url(buffer);
}

/** 常量时间比较用于签名 Cookie，长度不同直接失败。 */
export function safeEqual(left, right) {
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export function hex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value instanceof Uint8Array ? value : encoder.encode(String(value));
}

function toArrayBuffer(value) {
  return new Uint8Array(toBytes(value)).buffer;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
