// Diem vao chinh cua CRM.
// Static shell render truoc, module nghiep vu gan event sau.
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

function loadScript(src, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      script.remove();
      reject(new Error(`Tải thư viện quá lâu: ${src}`));
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
      reject(new Error(`Không tải được thư viện: ${src}`));
    };
    document.head.appendChild(script);
  });
}

async function ensureSupabaseLoaded() {
  if (window.supabase?.createClient) return;
  const errors = [];
  for (const src of SUPABASE_CDN_URLS) {
    try {
      setLoginStatus("Đang tải kết nối Supabase...");
      await loadScript(src);
      if (window.supabase?.createClient) return;
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(`Không tải được thư viện Supabase. Hãy kiểm tra mạng/CDN rồi tải lại trang. ${errors.join(" | ")}`);
}

renderAppShell();
try {
  await ensureSupabaseLoaded();
  setLoginStatus("");
  await import("./features/crm-app.js");
} catch (err) {
  console.error(err);
  setLoginStatus(err?.message || "Không tải được app CRM.", true);
}
