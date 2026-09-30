import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const html=read("website/index.html");
const css=read("css/catalog-website.css");
const api=read("js/website/catalog-api.js");
const app=read("js/website/catalog-app.js");
const bootstrap=read("js/website/catalog-bootstrap.js");
let checks=0;
function expect(label,condition){checks++;assert.ok(condition,`FAIL: ${label}`);}

for(const id of ["catalogFilters","catalogSearch","categoryFilter","collectionFilter","surfaceFilter","sizeFilter","priceFilter","productGrid","catalogCount","emptyState","errorState","loadMore","catalogSentinel"])
  expect(`HTML #${id}`,new RegExp(`id=["']${id}["']`).test(html));
expect("independent website entry",/catalog-website\.css/.test(html)&&/catalog-bootstrap\.js/.test(html));
expect("does not load CRM app",!/js\/app\.js|crm-app\.js/.test(html));
expect("Vietnamese locale",/lang="vi"/.test(html));
expect("accessible live results",/id="catalogCount"[^>]+aria-live="polite"/.test(html));
expect("responsive viewport",/name="viewport"/.test(html));
expect("responsive breakpoints",/@media\(max-width:820px\)/.test(css)&&/@media\(max-width:370px\)/.test(css));
expect("four-to-mobile grid",/grid-template-columns:repeat\(4/.test(css)&&/@media\(max-width:820px\)[\s\S]*grid-template-columns:repeat\(2/.test(css));
expect("reduced motion",/@media\(prefers-reduced-motion:reduce\)/.test(css));

expect("public list RPC only",/client\.rpc\("catalog_public_list_products_v1"/.test(api));
expect("no direct table access",!/\.from\s*\(/.test(api+app+bootstrap));
expect("no admin mutation RPC",!/catalog_admin_|catalog_apply_/i.test(api+app+bootstrap));
expect("no service role",!/service[_-]?role/i.test(html+api+app+bootstrap));
for(const parameter of ["p_search","p_category","p_collection","p_surface","p_width_mm","p_height_mm","p_min_price","p_max_price","p_limit","p_offset"])
  expect(`API parameter ${parameter}`,api.includes(parameter));
expect("bounded page size",/Math\.min\(100, Math\.max\(1/.test(api));
expect("Vietnamese price grouping",/Intl\.NumberFormat\("vi-VN"/.test(api));
expect("price per square metre",/VNĐ\/m²/.test(api));
expect("missing price copy",/Đang cập nhật/.test(api));
expect("millimetres to centimetres",/number % 10 === 0 \? String\(number \/ 10\)/.test(api));
expect("HTTPS image allowlist",/url\.protocol === "https:"/.test(api));
expect("native lazy images",/image\.loading = "lazy"/.test(app));
expect("image error fallback",/image\.addEventListener\("error"/.test(app));
expect("catalog pagination",/pagination\?\.has_more/.test(api)&&/next_offset/.test(api));
expect("lazy load observer",/IntersectionObserver/.test(app)&&/isIntersecting/.test(app));
expect("manual load more fallback",/elements\.more\.addEventListener\("click"/.test(app));
expect("empty state",/elements\.empty\.classList\.toggle/.test(app));
expect("retry state",/elements\.retry\.addEventListener/.test(app));
expect("search debounce",/setTimeout\(\(\)=>load\(\{reset:true\}\),350\)/.test(app));
expect("catalog list stays separate from detail state",!/catalog_public_get_product_v1|submitLead|website_lead/i.test(app));
expect("anonymous browser client",/createSupabaseBrowserClient\(\{authMode:"public"\}\)/.test(bootstrap));
expect("public site does not persist CRM auth",!/authMode:"authenticated"/.test(bootstrap));

console.log(`PASS: Catalog website 07A static contract (${checks} checks).`);
