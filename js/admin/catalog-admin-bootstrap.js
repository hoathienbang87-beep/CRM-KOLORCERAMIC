import { createSupabaseBrowserClient } from "../shared/supabase-client.js";
import { createCatalogAdminApi } from "./catalog-admin-api.js";
import { createCatalogAdminApp } from "./catalog-admin-app.js";

const supabase = createSupabaseBrowserClient({authMode:"authenticated"});
const app = createCatalogAdminApp({api:createCatalogAdminApi(supabase), root:document});
app.start().catch(error => app.fatal(error));
