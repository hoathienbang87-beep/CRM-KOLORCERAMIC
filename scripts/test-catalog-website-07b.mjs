import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root=process.cwd(),read=file=>fs.readFileSync(path.join(root,file),"utf8");
const html=read("website/index.html"),css=read("css/catalog-website.css"),api=read("js/website/catalog-api.js"),catalog=read("js/website/catalog-app.js"),detail=read("js/website/catalog-detail.js"),qr=read("js/website/catalog-qr.js"),bootstrap=read("js/website/catalog-bootstrap.js");
let checks=0;function expect(label,condition){checks++;assert.ok(condition,`FAIL: ${label}`);}

for(const id of ["productDetailView","detailLoading","detailNotFound","detailError","detailContent","detailMainImage","detailImageFallback","detailThumbnails","detailName","detailPrice","detailSpecs","detailMediaLinks","nativeShare","zaloShare","whatsAppShare","toggleQr","productQr","leadForm","leadName","leadPhone","leadEmail","leadConsent","leadCompany","leadSubmit","leadStatus"]){
  const actual=id==="detailSpecs"?/class="detail-specs"/.test(html):new RegExp(`id=["']${id}["']`).test(html);expect(`HTML ${id}`,actual);
}
expect("catalog cards link to query detail",/href = `\?id=\$\{encodeURIComponent/.test(catalog));
expect("detail API",/client\.rpc\("catalog_public_get_product_v1"/.test(api));
expect("lead API",/client\.rpc\("catalog_submit_website_lead_v1"/.test(api));
expect("no direct table access",!/\.from\s*\(/.test(api+catalog+detail+bootstrap));
expect("no admin RPC",!/catalog_admin_|catalog_manager_/i.test(api+catalog+detail+bootstrap));
expect("query router accepts id",/query\.get\("id"\)/.test(bootstrap));
expect("legacy query router accepts code",/query\.get\("code"\)/.test(bootstrap));
expect("published detail null state",/if\(!product\)\{show\("notFound"\)/.test(detail));
expect("gallery allowlisted",/gallery_urls/.test(detail)&&/safeExternalImageUrl/.test(detail));
expect("broken image fallback",/mainImage\.onerror/.test(detail)&&/imageFallback/.test(detail));
for(const field of ["pdf_url","video_url","more_info_url"])expect(`media ${field}`,detail.includes(field));
expect("native share fallback",/navigatorRef\.share/.test(detail)&&/clipboard\?\.writeText/.test(detail));
expect("Zalo share",/https:\/\/zalo\.me\/share/.test(detail));
expect("WhatsApp share",/https:\/\/wa\.me/.test(detail));
expect("local QR",/createQrSvg/.test(detail)&&!/quickchart|qrserver|googleapis/i.test(qr+detail));
expect("QR Reed Solomon",/errorCorrection/.test(qr)&&/0x11d/.test(qr));
expect("QR quiet zone",/SIZE\+8/.test(qr));
expect("QR download",/image\/svg\+xml/.test(detail)&&/download=/.test(detail));
expect("lead UUID idempotency",/state\.leadRequestId/.test(detail)&&/crypto\.randomUUID/.test(detail));
expect("lead request retained on failure",!/[Cc]atch[\s\S]{0,250}leadRequestId=makeUuid/.test(detail));
expect("lead request renewed after success",/leadForm\.reset\(\)[\s\S]*leadRequestId=makeUuid/.test(detail));
expect("product lead association",/product_id:state\.product\.id/.test(detail));
expect("privacy consent",/privacy_consent:elements\.leadConsent\.checked/.test(detail));
expect("honeypot",/anti_spam:\{honeypot:elements\.leadCompany\.value/.test(detail));
expect("contact required client guard",/Vui lòng nhập số điện thoại hoặc email/.test(detail));
expect("UTM allowlist",/["']utm_source["'][\s\S]*["']utm_medium["'][\s\S]*["']utm_campaign["']/.test(detail));
expect("source path bounded",/source_path:[\s\S]*\.slice\(0,1000\)/.test(detail));
expect("rate-limit message",/15 phút/.test(detail));
for(const event of ["product_view","product_not_found","share","qr_open","qr_download","media_open","lead_submit_success","lead_submit_error"])expect(`tracking ${event}`,detail.includes(`"${event}"`));
expect("tracking is event based",/CustomEvent\("kolor:catalog"/.test(detail));
expect("tracking success excludes contact",/lead_submit_success",\{product_id:state\.product\.id,idempotent_replay/.test(detail));
expect("responsive detail",/@media\(max-width:820px\)[\s\S]*\.detail-content\{grid-template-columns:1fr/.test(css));
expect("responsive lead",/@media\(max-width:820px\)[\s\S]*\.lead-card\{grid-column:auto;display:block/.test(css));
expect("reduced motion QR-safe",/@media\(prefers-reduced-motion:reduce\)/.test(css));
expect("no service role",!/service[_-]?role/i.test(html+api+catalog+detail+qr+bootstrap));

console.log(`PASS: Catalog website 07B static contract (${checks} checks).`);
