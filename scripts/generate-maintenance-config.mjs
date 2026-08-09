import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const truthy = value => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
const enabled = existsSync(resolve(".maintenance-on")) || truthy(process.env.VITE_MAINTENANCE_MODE);
const target = resolve("js/config/maintenance.generated.js");

const content = `export const MAINTENANCE_CONFIG = {
  enabled: ${enabled}
};
`;

await mkdir(dirname(target), {recursive: true});
await writeFile(target, content, "utf8");
console.log(`Maintenance mode: ${enabled ? "ON" : "OFF"}`);
