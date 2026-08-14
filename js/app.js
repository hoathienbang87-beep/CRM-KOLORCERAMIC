// Diem vao chinh cua CRM.
// Static shell render truoc, module nghiep vu gan event sau.
import { MAINTENANCE_CONFIG } from "./config/maintenance.generated.js";
import { renderAppShell } from "./components/app-shell.js";

const SUPABASE_CDN_URLS = [
  "./js/vendor/supabase/supabase.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"
];

function setLoginStatus(message, isError = false) {
  const box = document.getElementById("loginError");
  if (!box) return;
  box.textContent = message || "";
  box.style.color = isError ? "#b42318" : "";
}

function showMaintenance() {
  document.getElementById("maintenanceView")?.classList.remove("hide");
  document.getElementById("loginView")?.classList.add("hide");
  document.getElementById("appView")?.classList.add("hide");
  document.getElementById("adminAppView")?.classList.add("hide");
}

function loadScript(src, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      script.remove();
      reject(new Error(`Tai thu vien qua lau: ${src}`));
    }, timeoutMs);
    script.src = src;
    script.async = true;
    script.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      script.remove();
      reject(new Error(`Khong tai duoc thu vien: ${src}`));
    };
    document.head.appendChild(script);
  });
}

async function ensureSupabaseLoaded() {
  if (window.supabase?.createClient) return;
  const errors = [];
  for (const src of SUPABASE_CDN_URLS) {
    try {
      setLoginStatus("Dang tai ket noi Supabase...");
      await loadScript(src);
      if (window.supabase?.createClient) return;
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(`Khong tai duoc thu vien Supabase. Hay kiem tra mang/CDN roi tai lai trang. ${errors.join(" | ")}`);
}

if (MAINTENANCE_CONFIG.enabled) {
  showMaintenance();
} else {
  renderAppShell();
  try {
    await ensureSupabaseLoaded();
    setLoginStatus("");
    await import("./features/crm-app.js?v=20260814-kpi21e-cutover");
  } catch (err) {
    console.error(err);
    setLoginStatus(err?.message || "Khong tai duoc app CRM.", true);
  }
}
