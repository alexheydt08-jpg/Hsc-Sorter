import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/* True only when both values were present at build time. Checked before the
   error book is used so a deployment without them degrades to a readable
   message instead of a blank page — createClient throws on an empty URL, and
   at module scope that would take the whole app down, question bank included. */
export const isSyncConfigured = () =>
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let _supabase = null;
function supabaseClient() {
  if (!isSyncConfigured()) {
    throw new Error(
      "Syncing isn't configured for this build — VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing."
    );
  }
  if (!_supabase) _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _supabase;
}

/* All rows are namespaced by syncCode so every device using the same code
   reads and writes the same data. See README for the one-time Supabase setup. */

export async function remoteGet(syncCode, key) {
  const { data, error } = await supabaseClient()
    .from("kv_store")
    .select("value")
    .eq("sync_code", syncCode)
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data ? data.value : undefined;
}

export async function remoteSet(syncCode, key, value) {
  const { error } = await supabaseClient()
    .from("kv_store")
    .upsert(
      { sync_code: syncCode, key, value, updated_at: new Date().toISOString() },
      { onConflict: "sync_code,key" }
    );
  if (error) throw error;
}

export async function remoteDelete(syncCode, key) {
  const { error } = await supabaseClient()
    .from("kv_store")
    .delete()
    .eq("sync_code", syncCode)
    .eq("key", key);
  if (error) throw error;
}

/* Generates a long, hard-to-guess sync code since it doubles as the access secret. */
export function generateSyncCode() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous chars
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 16; i++) out += chars[bytes[i] % chars.length];
  return out.match(/.{1,4}/g).join("-"); // e.g. "kx7q-m3np-9tzr-2vwd"
}
