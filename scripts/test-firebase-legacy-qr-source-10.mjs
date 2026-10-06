import assert from "node:assert/strict";

const legacyUrl="https://kolor-ceramics.web.app/";
const response=await fetch(legacyUrl,{redirect:"manual"});
assert.equal(response.status,200,"legacy Firebase catalog remains readable before cutover");
const html=await response.text();
assert.match(html,/params\.get\(['"]id['"]\)\s*\|\|\s*params\.get\(['"]code['"]\)/,"legacy catalog accepts id/code query keys");
assert.match(html,/function productLink\(id\)[\s\S]{0,250}\?id=/,"legacy generated QR/product link uses id query key");
assert.equal(new URL(response.url).hostname,"kolor-ceramics.web.app","audit stayed on the pinned legacy origin");

console.log("PASS: live legacy Firebase QR URL contract uses root ?id= and accepts ?code= as an alias.");
