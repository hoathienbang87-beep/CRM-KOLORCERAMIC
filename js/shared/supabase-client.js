const AUTH_STORAGE_KEY = "crm-kolor-supabase-auth";

export function readSupabaseBrowserConfig(windowRef = globalThis.window) {
  const config = windowRef?.CRM_SUPABASE_CONFIG || {};
  if (!config.url || !config.anonKey) throw new Error("Thiếu cấu hình Supabase.");
  return {url:config.url, anonKey:config.anonKey};
}

export function createSupabaseBrowserClient({
  windowRef = globalThis.window,
  authMode = "authenticated"
} = {}) {
  const createClient = windowRef?.supabase?.createClient;
  if (!createClient) throw new Error("Không tải được thư viện Supabase.");
  const config = readSupabaseBrowserConfig(windowRef);
  const auth = authMode === "public"
    ? {persistSession:false, autoRefreshToken:false, detectSessionInUrl:false}
    : {persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, storageKey:AUTH_STORAGE_KEY};
  return createClient(config.url, config.anonKey, {auth});
}
