import { invariant } from "../errors.js";
import { logEvent } from "../logger.js";
import { assertWebmMagic } from "./common.js";

const SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

/** Supabase Storage 仅在 Worker 内使用 server secret；浏览器拿到的只有单对象 signed upload URL。 */
export class SupabaseAudioStorage {
  constructor(env, fetchImpl = fetch) {
    this.env = env;
    this.fetch = fetchImpl;
    this.baseUrl = normalizeUrl(required(env.SUPABASE_URL, "SUPABASE_URL"));
    this.bucket = required(env.SUPABASE_STORAGE_BUCKET, "SUPABASE_STORAGE_BUCKET");
    this.secret = required(env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
      "SUPABASE_SECRET_KEY 或 SUPABASE_SERVICE_ROLE_KEY");
  }

  async createUploadUrl(key, contentType, sha256) {
    const response = await this.request(`/object/upload/sign/${encodePath(`${this.bucket}/${key}`)}`,
      { method: "POST", body: JSON.stringify({}), headers: { "content-type": "application/json" } });
    const data = await response.json();
    invariant(data?.url, "STORAGE_SIGNING_FAILED", "Supabase 未返回上传授权", 502);
    const uploadUrl = data.url.startsWith("http") ? data.url : `${this.baseUrl}/storage/v1${data.url}`;
    // Supabase signed upload URL 当前固定 2 小时有效；checksum 作为对象 user metadata 一并写入。
    return { uploadUrl, expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS, uploadFormat: "raw",
      headers: { "content-type": contentType, "x-upsert": "false", "x-metadata": base64Json({ sha256 }) } };
  }

  async verifyUploadedObject(key, constraints) {
    const infoResponse = await this.request(`/object/info/${encodePath(`${this.bucket}/${key}`)}`);
    const info = await infoResponse.json();
    const size = Number(info.size ?? info.metadata?.size ?? 0);
    const mime = info.mimetype ?? info.metadata?.mimetype ?? info.metadata?.contentType ?? constraints.mime;
    invariant(size > 0, "EMPTY_AUDIO", "音频内容不能为空", 422);
    invariant(size <= constraints.maxBytes, "AUDIO_TOO_LARGE", "音频文件过大", 413);
    if (constraints.expectedSize) invariant(size === constraints.expectedSize, "AUDIO_SIZE_MISMATCH", "上传文件大小与声明不一致", 409);
    invariant(mime === constraints.mime, "AUDIO_MIME_MISMATCH", "上传文件类型与声明不一致", 415);
    const metadataSha = info.user_metadata?.sha256 ?? info.userMetadata?.sha256 ?? info.metadata?.sha256;
    invariant(metadataSha === constraints.sha256, "AUDIO_CHECKSUM_METADATA_MISMATCH", "上传文件校验和元数据与声明不一致", 409);
    const headerResponse = await this.request(`/object/${encodePath(`${this.bucket}/${key}`)}`,
      { headers: { range: "bytes=0-3" } });
    invariant(headerResponse.status === 206, "STORAGE_RANGE_UNSUPPORTED",
      "对象存储未按 Range 返回音频头，拒绝在 HTTP 路径读取完整音频", 502);
    const bytes = new Uint8Array(await headerResponse.arrayBuffer());
    assertWebmMagic(bytes);
    return { size, etag: info.etag ?? info.eTag ?? null, mime };
  }

  async getObjectBytes(key) {
    const response = await this.request(`/object/${encodePath(`${this.bucket}/${key}`)}`, {}, [404]);
    if (response.status === 404) return null;
    return response.arrayBuffer();
  }

  /**
   * Workflow 的生产 STT 链路只可使用此方法：它返回 Storage Response.body，而不是把对象读入 ArrayBuffer。
   * Content-Length 若由 Provider 返回会先与 D1 已确认大小比对；缺失时由下游 multipart 流在结束时再核对。
   */
  async getObjectStream(key, expectedSize) {
    const size = Number(expectedSize);
    invariant(Number.isSafeInteger(size) && size > 0, "AUDIO_SIZE_MISMATCH", "已确认音频大小无效", 409);
    const response = await this.request(`/object/${encodePath(`${this.bucket}/${key}`)}`, {}, [404]);
    if (response.status === 404) return null;
    const headerSize = response.headers.get("content-length");
    if (headerSize !== null) {
      const actualSize = Number(headerSize);
      invariant(Number.isSafeInteger(actualSize) && actualSize >= 0, "STORAGE_PROVIDER_ERROR", "Supabase 返回无效对象长度", 502);
      invariant(actualSize === size, "AUDIO_SIZE_MISMATCH", "对象长度与已确认上传不一致", 409);
    }
    invariant(response.body, "STORAGE_PROVIDER_ERROR", "Supabase 未返回音频数据流", 502);
    // 不写入对象 key 或 URL，避免 Worker Logs 暴露私有 Storage 路径。
    logEvent("info", "storage.supabase_object_stream_opened", { provider: "supabase", operation: "object_stream", contentLength: size });
    return { stream: /** @type {ReadableStream<Uint8Array>} */ (response.body), size };
  }

  async deleteObject(key) {
    await this.request(`/object/${encodeURIComponent(this.bucket)}`, { method: "DELETE",
      body: JSON.stringify({ prefixes: [key] }), headers: { "content-type": "application/json" } });
  }

  /** 该方法只为统一 adapter 形状存在；生产 Supabase 永远不允许 Worker 代理完整音频上传。 */
  async putLocalObject() {
    invariant(false, "DIRECT_UPLOAD_REQUIRED", "Supabase 环境必须使用浏览器直传", 410);
  }

  /** Cron 递归遍历私有 bucket；低流量 Beta 下以正确清理孤儿对象优先。 */
  async listObjects(prefix = "audio/") {
    const root = prefix.replace(/\/$/, "");
    const folders = [root];
    const objects = [];
    while (folders.length) {
      const folder = folders.pop();
      let offset = 0;
      while (true) {
        const response = await this.request(`/object/list/${encodeURIComponent(this.bucket)}`, { method: "POST",
          body: JSON.stringify({ prefix: folder, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
          headers: { "content-type": "application/json" } });
        const rows = await response.json();
        for (const row of rows) {
          const key = `${folder}/${row.name}`.replace(/^\//, "");
          if (row.id == null) folders.push(key);
          else objects.push({ key, size: Number(row.metadata?.size ?? 0), uploaded: row.created_at ?? row.updated_at });
        }
        if (rows.length < 100) break;
        offset += rows.length;
      }
    }
    return objects;
  }

  async request(path, init = {}, allowedStatuses = []) {
    const headers = new Headers(init.headers ?? {});
    headers.set("apikey", this.secret);
    // legacy service_role 是 JWT，可直接进入 Authorization；新 sb_secret_* 由网关通过 apikey 识别并替换角色。
    if (!this.secret.startsWith("sb_secret_")) headers.set("authorization", `Bearer ${this.secret}`);
    const response = await this.fetch(`${this.baseUrl}/storage/v1${path}`, { ...init, headers });
    if (!response.ok && !allowedStatuses.includes(response.status)) {
      // Provider body 可能包含签名 URL、对象元数据或网关诊断，禁止读取后写入日志。
      logEvent("warn", "storage.supabase_request_failed", {
        provider: "supabase", operation: storageOperation(path), status: response.status,
      });
      invariant(false, response.status === 404 ? "AUDIO_OBJECT_MISSING" : "STORAGE_PROVIDER_ERROR",
        response.status === 404 ? "未找到已上传音频" : "Supabase Storage 请求失败", response.status === 404 ? 409 : 502);
    }
    return response;
  }
}

function required(value, name) { invariant(value, "SERVICE_NOT_CONFIGURED", `${name} 未配置`, 503); return value; }
function normalizeUrl(value) { return String(value).replace(/\/$/, ""); }
function encodePath(value) { return String(value).split("/").map((part) => encodeURIComponent(part)).join("/"); }
function base64Json(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** 将请求路径归类为固定运维操作名，日志不保留包含账户/任务标识的真实对象路径。 */
function storageOperation(path) {
  if (path.startsWith("/object/upload/sign/")) return "upload_sign";
  if (path.startsWith("/object/info/")) return "object_info";
  if (path.startsWith("/object/list/")) return "object_list";
  if (path.startsWith("/object/")) return "object_read";
  return "bucket_delete";
}
