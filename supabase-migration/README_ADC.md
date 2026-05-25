# Firebase -> Supabase Migration With ADC

Dung cach nay khi Firebase/Google Cloud chan tao service account key JSON.

## 1. Chay schema Supabase

Mo Supabase SQL Editor va chay toan bo file:

```text
D:\crm-firebase\supabase\schema.sql
```

## 2. Dang nhap Google Cloud

Trong PowerShell, dung `gcloud.cmd` thay vi `gcloud` de ne loi execution policy:

```powershell
gcloud.cmd auth login
gcloud.cmd auth application-default login
gcloud.cmd config set project project-ffc49bd5-9852-4aa9-b6b
```

Kiem tra token:

```powershell
gcloud.cmd auth application-default print-access-token
```

Neu len mot token dai la OK.

## 3. Cai va cau hinh migration

```powershell
cd D:\crm-firebase\supabase-migration
copy .env.example .env
npm install
```

Mo `.env`, chi can dien:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
FIREBASE_PROJECT_ID=project-ffc49bd5-9852-4aa9-b6b
BATCH_SIZE=300
```

Khong can `GOOGLE_APPLICATION_CREDENTIALS`.

## 4. Chay thu

```powershell
npm run dry-run
```

## 5. Chay migrate that

```powershell
npm run migrate
```

Script dung `upsert`, nen co the chay lai neu can.
