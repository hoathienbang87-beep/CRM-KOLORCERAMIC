import {createCatalogPublicApi} from "./catalog-api.js";
import {createCatalogWebsiteApp} from "./catalog-app.js";

const config = window.CRM_SUPABASE_CONFIG || {};
const createClient = window.supabase?.createClient;
if (!createClient || !config.url || !config.anonKey) throw new Error("Thiếu cấu hình public catalog.");
const publicClient = createClient(config.url, config.anonKey, {
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
});
const app = createCatalogWebsiteApp({api:createCatalogPublicApi(publicClient), root:document});
app.start().catch(error => console.error("Catalog bootstrap error", error));
