import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";

const output=process.argv[2];
assert.ok(output,"Usage: node scripts/build-catalog-staging-e2e-11a.mjs <output.sql>");

const inputs=[
  "scripts/test-catalog-05a-staging.sql",
  "scripts/test-catalog-05a-staging-rollback.sql",
  "scripts/test-catalog-05b-staging.sql",
  "scripts/test-catalog-05b-staging-rollback.sql",
  "scripts/test-catalog-06a-staging.sql",
  "scripts/test-catalog-06a-staging-rollback.sql",
  "scripts/test-catalog-06b-staging.sql",
  "scripts/test-catalog-06b-staging-rollback.sql",
  "scripts/test-catalog-11a-staging.sql"
];

const sections=[];
for(const file of inputs){
  const sql=await readFile(file,"utf8");
  assert.match(sql,/\b(begin|do\s+\$\$)/i,`${file} must contain executable SQL`);
  sections.push(`-- BEGIN 11A SOURCE: ${file}\n${sql.trim()}\n-- END 11A SOURCE: ${file}`);
}

const banner=[
  "-- Generated Prompt 11A cloud-staging E2E migration.",
  "-- Canonical sources live in scripts/; do not edit this generated file.",
  "-- Every fixture source performs rollback and an independent residue check."
].join("\n");

await writeFile(path.resolve(output),`${banner}\n\n${sections.join("\n\n")}\n`,"utf8");
console.log(`Built Prompt 11A staging E2E migration from ${inputs.length} self-cleaning SQL suites.`);
