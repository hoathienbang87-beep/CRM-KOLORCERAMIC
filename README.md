# CRM Kolorceramic

Static CRM web app using Supabase Auth and Supabase database.

This repo is the deployable frontend only. It keeps the familiar CRM interface while using Supabase through `js/firebase.js`, which acts as a compatibility adapter for the old app API.

## Files

- `index.html`: app shell
- `css/styles.css`: CRM styling
- `js/features/crm-app.js`: CRM workflow and UI logic
- `js/firebase.js`: Supabase compatibility adapter
- `js/supabase-config.js`: Supabase URL and anon key
- `vercel.json`: Vercel static hosting config

## Local preview

```powershell
python -m http.server 5181 --bind 127.0.0.1 --directory D:\Github\CRM-KOLORCERAMIC
```

Open:

```text
http://127.0.0.1:5181/index.html
```

## Notes

Use only the Supabase anon key in `js/supabase-config.js`. Never put the service role key in this frontend repo.

## Operations

- Backup and restore guide: `PHASE-4-13-DATA-SAFETY-BACKUP.md`
- Deploy checklist: `PHASE-4-14-OPERATIONS-DEPLOY.md`

Before a production deploy, export an operational snapshot in **Quản trị > An toàn dữ liệu** and confirm no `.env`, database password, service role key, SQL dump, or customer export file is staged in Git.
