import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import {webcrypto} from "node:crypto";
import {bytesHavePdfMagic,parserResultToStagePayload,sha256Hex,validateProductImportFile,PRODUCT_IMPORT_MAX_BYTES} from "../js/features/product-import-client.js";
import {summarizeImportRows} from "../js/features/product-import-ui.js";

globalThis.crypto??=webcrypto;
const root=new URL("../",import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),"utf8");
const hash=path=>crypto.createHash("sha256").update(fs.readFileSync(new URL(path,root))).digest("hex").toUpperCase();

const bytes=new TextEncoder().encode("%PDF-1.7 synthetic");
assert.equal(bytesHavePdfMagic(bytes),true);
assert.equal(bytesHavePdfMagic(new TextEncoder().encode("not pdf")),false);
assert.equal(validateProductImportFile({name:"safe.pdf",size:bytes.length},bytes),true);
assert.throws(()=>validateProductImportFile({name:"large.pdf",size:PRODUCT_IMPORT_MAX_BYTES+1},bytes),/20 MiB/);
assert.equal(await sha256Hex(bytes),crypto.createHash("sha256").update(bytes).digest("hex"));

const mapped=parserResultToStagePayload({name:"C:\\private\\synthetic.pdf",size:bytes.length},{ok:true,metadata:{effective_date:"2026-09-03",pages:[{}]},rows:[{source_page:1,source_row_number:1,stt:1,code:"SYN-1",name:"Synthetic",width_cm:"60",height_cm:"60",price_per_m2:"100000",warnings:[]}]},"a".repeat(64));
assert.equal(mapped.batch.source_filename,"synthetic.pdf");
assert.equal(mapped.rows.length,1);
assert.equal(JSON.stringify(mapped).includes("%PDF-"),false,"RPC payload never contains PDF bytes");
assert.deepEqual(summarizeImportRows([{classification:"NEW",selected_action:"CREATE"},{classification:"REVIEW",selected_action:"NONE"}]),{total:2,create:1,update:0,NEW:1,REVIEW:1});

assert.equal(hash("js/vendor/pdfjs/pdf.mjs"),"495588717F62303A839E91A5343DEEBF1B41F52E2F9F6361E73DEE6EA6A4355E");
assert.equal(hash("js/vendor/pdfjs/pdf.worker.mjs"),"F2870DB902EAFF8397442C912B69459980AC91F6F4B5ED827167B12CF7057930");
assert.equal(hash("js/vendor/pdfjs/LICENSE"),"0D542E0C8804E39AA7F37EB00DA5A762149DC682D7829451287E11B938E94594");
assert.match(read("js/vendor/pdfjs/LICENSE"),/Apache License/);

const worker=read("js/workers/product-import.worker.js");
assert.match(worker,/vendor\/pdfjs\/pdf\.mjs/);assert.match(worker,/vendor\/pdfjs\/pdf\.worker\.mjs/);
for(const forbidden of ["supabase","firebase","auth.uid","crm_stage_product_import","https://","http://"])assert.equal(worker.toLowerCase().includes(forbidden),false,`Worker isolation: ${forbidden}`);
const html=read("index.html"),ui=read("js/features/product-import-ui.js"),sql=read("supabase-phase-product-r2-import-preview.sql");
for(const required of ["Import bảng giá","productImportFile","productImportRows","Làm mới so sánh"])assert.ok(html.includes(required));
assert.match(html,/Xác nhận áp dụng/);assert.match(html,/disabled/);
assert.match(ui,/crm_stage_product_import/);assert.match(ui,/crm_update_product_import_review/);assert.match(ui,/crm_refresh_product_import/);
assert.equal(/\b(?:insert\s+into|update|delete\s+from)\s+public\.products\b/i.test(sql),false);
assert.equal(/\b(?:insert\s+into|update|delete\s+from)\s+public\.product_price_history\b/i.test(sql),false);
assert.equal(/D:\\|DU AN CUA TOI|2026-Bang gia/i.test([worker,ui,sql,html].join("\n")),false);

console.log("Product R2 STEP 5 public contract PASS: file privacy, hashing, mapper, local PDF.js, Worker isolation, UI controls and no Product mutation source.");
