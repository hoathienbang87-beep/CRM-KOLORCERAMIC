# Huong dan Maintenance Mode cho CRM-KOLORCERAMIC

Maintenance Mode dung de tam khoa app trong luc nang cap lon, tranh nguoi dung tiep tuc them/sua khach hang, cham soc, KPI hoac bao cao lam lech du lieu.

## Stack hien tai

- Frontend: static HTML/CSS/JavaScript.
- Deploy: Vercel static site, output directory la thu muc goc.
- Database/Auth: Supabase.
- Maintenance Mode: chay o frontend entrypoint `js/app.js`, doc file `js/config/maintenance.generated.js`.
- Build tren Vercel: `node scripts/generate-maintenance-config.mjs`.

## Co che hoat dong

Khi `VITE_MAINTENANCE_MODE=true`, build script se sinh:

```js
export const MAINTENANCE_CONFIG = {
  enabled: true
};
```

Luc do app chi hien trang bao tri va khong tai Supabase/CRM module. Tat ca user, ke ca admin/owner, deu bi chan tam thoi.

Ly do chon chan toan bo: day la cach an toan nhat khi nang cap lon, tranh co user van ghi du lieu trong luc dang sua logic CRM/KPI.

## Bat maintenance mode tren local

Trong Windows PowerShell, chay:

```powershell
$env:VITE_MAINTENANCE_MODE="true"
node scripts/generate-maintenance-config.mjs
python -m http.server 5183 --bind 127.0.0.1
```

Mo:

```text
http://127.0.0.1:5183/index.html
```

Ban se thay man hinh bao tri.

## Tat maintenance mode tren local

Trong Windows PowerShell, chay:

```powershell
$env:VITE_MAINTENANCE_MODE="false"
node scripts/generate-maintenance-config.mjs
```

Trong rollout production fail-closed, co the tao file `.maintenance-on`. Build script se uu tien lock file nay ke ca khi bien moi truong chua duoc cau hinh. Xoa file va build/deploy lai de mo he thong.

Sau do reload trinh duyet. App se hien man dang nhap CRM nhu binh thuong.

## Bat maintenance mode tren Vercel

1. Vao Vercel project cua CRM.
2. Mo `Settings` -> `Environment Variables`.
3. Them hoac sua bien:

```text
VITE_MAINTENANCE_MODE=true
```

4. Redeploy production.
5. Mo link production va kiem tra trang bao tri hien dung.

## Tat maintenance mode tren Vercel

1. Vao `Settings` -> `Environment Variables`.
2. Doi:

```text
VITE_MAINTENANCE_MODE=false
```

Hoac xoa bien nay.

3. Redeploy production.
4. Mo link production va kiem tra app CRM hien lai man dang nhap.

## Luu y an toan

- Khong commit `.env`, service role key, database password, file backup len GitHub.
- Maintenance Mode khong sua Supabase database.
- Truoc khi nang cap lon sau khi bat maintenance, nen backup Supabase va commit code hien tai.
- Khi maintenance dang bat, user khong the them/sua du lieu qua app vi module CRM khong duoc tai.

## File lien quan

- `index.html`: them man hinh bao tri.
- `css/styles.css`: style cho man hinh bao tri.
- `js/app.js`: chan app neu maintenance bat.
- `js/config/maintenance.generated.js`: file config duoc build script sinh ra.
- `scripts/generate-maintenance-config.mjs`: doc bien `VITE_MAINTENANCE_MODE`.
- `vercel.json`: chay build script tren Vercel.
