# CRM Supabase Exact

Ban nay clone gan nhu nguyen ven app Firebase cu trong `public/`, sau do thay `js/firebase.js` bang adapter Supabase.

Muc tieu:

- Giu UI/UX, tab, bang, nut bam, filter va workflow giong ban Firebase cu nhat co the.
- Khong viet lai giao dien tu dau.
- Du lieu doc/ghi qua Supabase.

## File quan trong

- `index.html`: clone tu ban Firebase cu, chi doi title/login text va nap `js/supabase-config.js`.
- `css/styles.css`: clone nguyen tu ban Firebase cu.
- `js/features/crm-app.js`: clone nguyen logic app cu.
- `js/firebase.js`: adapter Supabase gia lap cac ham Firebase ma app cu dang dung.
- `js/supabase-config.js`: Supabase URL va anon key.

## Chay local

```powershell
python -m http.server 5181 --bind 127.0.0.1 --directory D:\crm-firebase\supabase-exact
```

Mo:

```text
http://127.0.0.1:5181/index.html
```

## Luu y

Adapter hien tai uu tien cac workflow chinh:

- Dang nhap email/password Supabase Auth
- Doc user/role tu `app_users`
- Doc settings, customers, care logs, deals, products, KPI
- Them/sua/cham soc/don hang/KPI qua Supabase
- Giu filter, bang, dashboard, KPI, quan tri theo UI cu

Neu phat hien nut nao con loi, sua trong adapter `js/firebase.js` truoc khi sua UI.
