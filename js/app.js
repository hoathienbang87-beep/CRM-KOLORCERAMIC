// Diem vao chinh cua CRM.
// Static shell render truoc, module nghiep vu gan event sau.
import { renderAppShell } from "./components/app-shell.js";

renderAppShell();
await import("./features/crm-app.js");
