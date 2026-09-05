import { R2AudioStorage } from "./r2.js";
import { SupabaseAudioStorage } from "./supabase.js";
export { assertAudioDeclaration, assertOwnedKey, audioObjectKey } from "./common.js";

/** Provider 选择集中在单点；local 使用 R2 binding，Preview/Production 默认 Supabase。 */
export function audioStorage(env) {
  const provider = String(env.STORAGE_PROVIDER ?? (env.APP_ENV === "local" ? "r2" : "supabase")).toLowerCase();
  if (provider === "r2") return new R2AudioStorage(env);
  if (provider === "supabase") return new SupabaseAudioStorage(env);
  throw Object.assign(new Error(`不支持的存储 Provider: ${provider}`), { code: "INVALID_CONFIG", status: 500 });
}
