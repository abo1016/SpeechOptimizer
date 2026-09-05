import { D1Repository } from "../src/repository.js";

const OWNER = { type: "account", id: "usr_d1_pagination" };
const UPLOAD_OWNER = { type: "account", id: "usr_d1_upload_ticket" };
const CREATED_AT = "2026-09-05T00:00:00.000Z";

/**
 * Wrangler local D1 专用测试 Worker：通过真实 D1 binding 执行 seed 和分页读取，避免把 SQLite mock 当成集成证据。
 * 该入口只在测试配置中使用，不接入产品 Worker 的 Fetch Router。
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return Response.json({ ok: true });
      if (url.pathname === "/seed") return Response.json(await seedDatabase(env.DB));
      if (url.pathname === "/paginate") return Response.json(await readAllPages(env.DB));
      if (url.pathname === "/upload-ticket-race") return Response.json(await exerciseUploadTicketRace(env.DB));
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    } catch (error) {
      // 将 harness 错误以 JSON 返回，测试失败时能保留 D1/迁移的实际错误文本用于定位。
      return Response.json({ error: String(error?.stack ?? error) }, { status: 500 });
    }
  },
};

async function seedDatabase(db) {
  await db.batch([
    db.prepare("DELETE FROM analyses WHERE owner_type=? AND owner_id=?").bind(OWNER.type, OWNER.id),
    db.prepare("DELETE FROM users WHERE id=?").bind(OWNER.id),
  ]);
  await db.prepare(`INSERT INTO users
    (id,email_normalized,provider,created_at) VALUES(?,?,?,?)`)
    .bind(OWNER.id, "d1-pagination@example.com", "test", CREATED_AT).run();

  const statements = Array.from({ length: 150 }, (_, index) => {
    const id = `ana_${String(index).padStart(3, "0")}`;
    return db.prepare(`INSERT INTO analyses
      (id,owner_type,owner_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)`)
      .bind(id, OWNER.type, OWNER.id, "created", CREATED_AT, CREATED_AT);
  });
  // D1 batch 以小批次写入，降低不同 Wrangler/SQLite 版本对单批语句数量的敏感性。
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
  return { seeded: statements.length, createdAt: CREATED_AT };
}

async function readAllPages(db) {
  const repository = new D1Repository(db, () => new Date(CREATED_AT));
  const ids = [];
  const pageSizes = [];
  let cursor;
  do {
    const page = await repository.listOwned(OWNER, { limit: 100, cursor });
    pageSizes.push(page.items.length);
    ids.push(...page.items.map((analysis) => analysis.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { ids, pageSizes };
}

/** 真实 local D1 验证 upload ticket 条件更新：并发请求只能保留一个 key，容量按字节而非按对象数计数。 */
async function exerciseUploadTicketRace(db) {
  await db.batch([
    db.prepare("DELETE FROM analyses WHERE id=?").bind("ana_d1_upload_ticket"),
    db.prepare("DELETE FROM users WHERE id=?").bind(UPLOAD_OWNER.id),
    db.prepare("DELETE FROM quota_counters WHERE metric='storage-bytes' AND period_key='current'"),
  ]);
  await db.batch([
    db.prepare("INSERT INTO users(id,email_normalized,provider,created_at) VALUES(?,?,?,?)")
      .bind(UPLOAD_OWNER.id, "d1-upload-ticket@example.com", "test", CREATED_AT),
    db.prepare(`INSERT INTO analyses(id,owner_type,owner_id,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?)`).bind("ana_d1_upload_ticket", UPLOAD_OWNER.type, UPLOAD_OWNER.id, "created", CREATED_AT, CREATED_AT),
  ]);
  const repository = new D1Repository(db, () => new Date(CREATED_AT));
  const declaration = { size: 123, mime: "audio/webm", sha256: "a".repeat(64) };
  const [first, second] = await Promise.all([
    repository.prepareUploadTicket("ana_d1_upload_ticket", UPLOAD_OWNER,
      { ...declaration, objectKey: "audio/account-usr_d1_upload_ticket/ana_d1_upload_ticket/first.webm" }, 1000),
    repository.prepareUploadTicket("ana_d1_upload_ticket", UPLOAD_OWNER,
      { ...declaration, objectKey: "audio/account-usr_d1_upload_ticket/ana_d1_upload_ticket/second.webm" }, 1000),
  ]);
  let conflictCode;
  try {
    await repository.prepareUploadTicket("ana_d1_upload_ticket", UPLOAD_OWNER, {
      objectKey: "audio/account-usr_d1_upload_ticket/ana_d1_upload_ticket/different.webm",
      size: 124,
      mime: declaration.mime,
      sha256: declaration.sha256,
    }, 1000);
  } catch (error) {
    conflictCode = error.code;
  }
  const ticket = await repository.getUploadTicket("ana_d1_upload_ticket", UPLOAD_OWNER);
  return { first, second, ticket, conflictCode, storageBytes: await repository.quotaValue("storage-bytes", "current") };
}
