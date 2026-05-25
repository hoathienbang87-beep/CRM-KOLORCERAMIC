import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Fill it in .env first.`);
  return value;
}

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function supabaseAdmin() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function listAllAuthUsers(client) {
  const users = [];
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...(data?.users || []));
    if (!data?.users?.length || data.users.length < perPage) break;
    page += 1;
  }
  return users;
}

async function loadAppUsers(client) {
  const { data, error } = await client
    .from("app_users")
    .select("id,email,name,role,active,team")
    .not("email", "is", null)
    .order("email");
  if (error) throw error;
  return (data || [])
    .map(u => ({ ...u, email: normalizeEmail(u.email) }))
    .filter(u => u.email && u.active === true);
}

async function main() {
  const client = supabaseAdmin();
  const defaultPassword = required("DEFAULT_USER_PASSWORD");
  if (defaultPassword.length < 8) throw new Error("DEFAULT_USER_PASSWORD must be at least 8 characters.");

  const [appUsers, authUsers] = await Promise.all([loadAppUsers(client), listAllAuthUsers(client)]);
  const existingByEmail = new Map(authUsers.map(u => [normalizeEmail(u.email), u]));
  const summary = [];

  for (const user of appUsers) {
    const existing = existingByEmail.get(user.email);
    if (existing) {
      summary.push({ email: user.email, role: user.role, action: "exists", auth_id: existing.id });
      if (!dryRun) {
        await client.from("app_users").update({ supabase_auth_id: existing.id }).eq("id", user.id);
      }
      continue;
    }

    summary.push({ email: user.email, role: user.role, action: dryRun ? "would_create" : "created", auth_id: "" });
    if (dryRun) continue;

    const { data, error } = await client.auth.admin.createUser({
      email: user.email,
      password: defaultPassword,
      email_confirm: true,
      user_metadata: {
        name: user.name || "",
        role: user.role || "sale",
        team: user.team || ""
      }
    });
    if (error) throw new Error(`${user.email}: ${error.message}`);
    const authId = data?.user?.id || null;
    if (authId) {
      await client.from("app_users").update({ supabase_auth_id: authId }).eq("id", user.id);
      summary[summary.length - 1].auth_id = authId;
    }
  }

  console.table(summary);
  console.log(dryRun ? "Dry-run done. No Auth users were created." : "Done creating Supabase Auth users.");
  if (!dryRun) {
    console.log("Temporary password:", defaultPassword);
    console.log("Ask users to change password after first login.");
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
