import { supabase } from "../firebase.js";
import { createCatalogAdminApi } from "./catalog-admin-api.js";
import { createCatalogAdminApp } from "./catalog-admin-app.js";

const app = createCatalogAdminApp({api:createCatalogAdminApi(supabase), root:document});
app.start().catch(error => app.fatal(error));
