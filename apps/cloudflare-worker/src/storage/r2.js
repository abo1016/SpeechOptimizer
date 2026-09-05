import { runtimeConfig } from "../config.js";
import { invariant } from "../errors.js";
import { hex, hmacBytes, sha256Hex } from "../web-crypto.js";
import { assertWebmMagic } from "./common.js";

const SERVICE = "s3";
const REGION = "auto";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
const SIGNED_HEADERS = "content-type;host;x-amz-meta-sha256";

/** 本地测试和显式 R2 fallback 的存储实现；生产默认不再依赖该 Provider。 */
export class R2AudioStorage {
  constructor(env) { this.env = env; }

  async createUploadUrl(key, contentType, sha256) {
    const accountId = required(this.env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID");
    const accessKeyId = required(this.env.R2_ACCESS_KEY_ID, "R2_ACCESS_KEY_ID");
    const secretAccessKey = required(this.env.R2_SECRET_ACCESS_KEY, "R2_SECRET_ACCESS_KEY");
    const bucket = required(this.env.R2_BUCKET_NAME, "R2_BUCKET_NAME");
    const expires = runtimeConfig(this.env).uploadExpiresSeconds;
    const now = new Date();
    const host = `${bucket}.${accountId}.r2.cloudflarestorage.com`;
    const canonicalUri = `/${encodePath(key)}`;
    const dateTime = amzDate(now);
    const date = dateTime.slice(0, 8);
    const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
    const query = buildQuery(accessKeyId, scope, dateTime, expires);
    const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-meta-sha256:${sha256}\n`;
    const canonicalRequest = `PUT\n${canonicalUri}\n${query}\n${canonicalHeaders}\n${SIGNED_HEADERS}\n${UNSIGNED_PAYLOAD}`;
    const stringToSign = `AWS4-HMAC-SHA256\n${dateTime}\n${scope}\n${await sha256Hex(canonicalRequest)}`;
    const signature = await sign(secretAccessKey, date, stringToSign);
    return { uploadUrl: `https://${host}${canonicalUri}?${query}&X-Amz-Signature=${signature}`,
      expiresInSeconds: expires, uploadFormat: "raw",
      headers: { "content-type": contentType, "x-amz-meta-sha256": sha256 } };
  }

  async verifyUploadedObject(key, constraints) {
    const object = await this.env.AUDIO_BUCKET.head(key);
    invariant(object, "AUDIO_OBJECT_MISSING", "未找到已上传音频", 409);
    validateObject(object.size, object.httpMetadata?.contentType ?? constraints.mime, constraints);
    invariant(object.customMetadata?.sha256 === constraints.sha256,
      "AUDIO_CHECKSUM_METADATA_MISMATCH", "上传文件校验和元数据与声明不一致", 409);
    const header = await this.env.AUDIO_BUCKET.get(key, { range: { offset: 0, length: 4 } });
    assertWebmMagic(new Uint8Array(await header.arrayBuffer()));
    return { size: object.size, etag: object.httpEtag ?? object.etag, mime: object.httpMetadata?.contentType ?? constraints.mime };
  }

  async getObjectBytes(key) {
    const object = await this.env.AUDIO_BUCKET.get(key);
    return object ? object.arrayBuffer() : null;
  }

  async deleteObject(key) { await this.env.AUDIO_BUCKET.delete(key); }

  async putLocalObject(key, buffer, declaration) {
    await this.env.AUDIO_BUCKET.put(key, buffer, { httpMetadata: { contentType: declaration.mime },
      customMetadata: { sha256: declaration.sha256 } });
  }

  async listObjects(prefix = "audio/") {
    const objects = [];
    let cursor;
    do {
      const page = await this.env.AUDIO_BUCKET.list({ prefix, cursor, limit: 500 });
      objects.push(...page.objects.map((item) => ({ key: item.key, size: item.size, uploaded: item.uploaded })));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return objects;
  }
}

function validateObject(size, mime, constraints) {
  invariant(size > 0, "EMPTY_AUDIO", "音频内容不能为空", 422);
  invariant(size <= constraints.maxBytes, "AUDIO_TOO_LARGE", "音频文件过大", 413);
  if (constraints.expectedSize) invariant(size === constraints.expectedSize, "AUDIO_SIZE_MISMATCH", "上传文件大小与声明不一致", 409);
  invariant(mime === constraints.mime, "AUDIO_MIME_MISMATCH", "上传文件类型与声明不一致", 415);
}

function required(value, name) { invariant(value, "SERVICE_NOT_CONFIGURED", `${name} 未配置`, 503); return value; }
async function sign(secret, date, stringToSign) {
  const dateKey = await hmacBytes(new TextEncoder().encode(`AWS4${secret}`), date);
  const regionKey = await hmacBytes(dateKey, REGION);
  const serviceKey = await hmacBytes(regionKey, SERVICE);
  return hex(await hmacBytes(await hmacBytes(serviceKey, "aws4_request"), stringToSign));
}
function buildQuery(accessKeyId, scope, dateTime, expires) {
  return [["X-Amz-Algorithm", "AWS4-HMAC-SHA256"], ["X-Amz-Credential", `${accessKeyId}/${scope}`],
    ["X-Amz-Date", dateTime], ["X-Amz-Expires", String(expires)], ["X-Amz-SignedHeaders", SIGNED_HEADERS],
    ["X-Amz-Content-Sha256", UNSIGNED_PAYLOAD]]
    .map(([key, value]) => [encodeURIComponent(key), encodeURIComponent(value)])
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("&");
}
function amzDate(date) { return date.toISOString().replace(/[:-]|\.\d{3}/g, ""); }
function encodePath(value) { return String(value).split("/").map((part) => encodeURIComponent(part)).join("/"); }
