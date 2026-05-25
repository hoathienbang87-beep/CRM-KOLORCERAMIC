# Tao Supabase Auth users tu app_users

Dung script nay sau khi da migrate Firestore sang Supabase va bang `app_users` da co du lieu user cu.

## 1. Kiem tra `.env`

Mo:

```text
D:\crm-firebase\supabase-migration\.env
```

Can co:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DEFAULT_USER_PASSWORD=ChangeMe@123456
```

`DEFAULT_USER_PASSWORD` la mat khau tam cho tat ca user moi tao. Sau khi login, nen bao moi nguoi doi mat khau.

Khong dua `SUPABASE_SERVICE_ROLE_KEY` vao frontend.

## 2. Chay thu truoc

```powershell
cd D:\crm-firebase\supabase-migration
npm run create-auth-users:dry-run
```

Dry-run se bao user nao da ton tai, user nao se duoc tao.

## 3. Tao user that

```powershell
npm run create-auth-users
```

Script se:

- Doc `app_users` co `active = true`
- Bo qua user da ton tai trong Supabase Auth
- Tao user moi voi email trong `app_users`
- Xac nhan email luon bang `email_confirm: true`
- Gan `supabase_auth_id` nguoc lai vao `app_users`

## 4. Sau khi tao xong

Gui cho moi nguoi:

- Link web Supabase
- Email dang nhap
- Mat khau tam trong `DEFAULT_USER_PASSWORD`

Sau do yeu cau doi mat khau.
