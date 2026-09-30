import assert from "node:assert/strict";

const emulator="http://127.0.0.1:55010";
const destination="https://crmkolor.vercel.app/";
const cases=[
  ["/?id=SP-00432D77",`${destination}?id=SP-00432D77`],
  ["/?code=SP-007D0823",`${destination}?code=SP-007D0823`],
  ["/legacy/product?code=SP-071&utm_source=qr",`${destination}?code=SP-071&utm_source=qr`],
  ["/catalog/archive",destination]
];

for(const [requestPath,expectedLocation] of cases){
  const response=await fetch(`${emulator}${requestPath}`,{redirect:"manual"});
  assert.equal(response.status,301,`301 for ${requestPath}`);
  const location=response.headers.get("location");
  assert.equal(location,expectedLocation,`query-preserving destination for ${requestPath}`);
  assert.notEqual(new URL(location).origin,new URL(emulator).origin,`no local loop for ${requestPath}`);
  assert.equal(new URL(location).origin,new URL(destination).origin,`canonical origin for ${requestPath}`);
}

console.log("PASS: Firebase Hosting emulator preserves id/code queries and redirects without a loop.");
