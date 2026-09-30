import {createSupabaseBrowserClient} from "../shared/supabase-client.js";
import {createCatalogPublicApi} from "./catalog-api.js";
import {createCatalogWebsiteApp} from "./catalog-app.js";
import {createCatalogDetailApp} from "./catalog-detail.js";

const publicClient = createSupabaseBrowserClient({authMode:"public"});
const api=createCatalogPublicApi(publicClient);
const identifier=new URL(location.href).searchParams.get("id");
const app = identifier
  ? createCatalogDetailApp({api,identifier,root:document,locationRef:location,navigatorRef:navigator})
  : createCatalogWebsiteApp({api,root:document});
app.start().catch(error => console.error("Catalog bootstrap error", error));
