import {createCatalogPublicApi} from "./catalog-api.js";
import {createCatalogWebsiteApp} from "./catalog-app.js";
import {createCatalogDetailApp} from "./catalog-detail.js";

const config = window.CRM_SUPABASE_CONFIG || {};
const createClient = window.supabase?.createClient;
if (!createClient || !config.url || !config.anonKey) throw new Error("Thiếu cấu hình public catalog.");
const publicClient = createClient(config.url, config.anonKey, {
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
});
const api=createCatalogPublicApi(publicClient);
const identifier=new URL(location.href).searchParams.get("id");
const app = identifier
  ? createCatalogDetailApp({api,identifier,root:document,locationRef:location,navigatorRef:navigator})
  : createCatalogWebsiteApp({api,root:document});
app.start().catch(error => console.error("Catalog bootstrap error", error));
