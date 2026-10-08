# DEPLOYMENT GUIDE - White X Store on Vercel with Neon PostgreSQL

## Prerequisites

1. **Neon PostgreSQL Database** - Create a free account at [neon.tech](https://neon.tech)
2. **Vercel Account** - Deploy from GitHub repository

---

## Step 1: Create Neon PostgreSQL Database

1. Go to [console.neon.tech](https://console.neon.tech)
2. Create a new project: `white-x-store`
3. Copy the **Connection String** (looks like: `postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/whitexstore?sslmode=require`)

---

## Step 2: Configure Vercel Environment Variables

In Vercel Dashboard → **Settings → Environment Variables**, add:

| Name | Value | Environment |
|------|-------|-------------|
| `DATABASE_URL` | `postgresql://user:pass@ep-xxx.us-east-1.aws.neon.tech/whitexstore?sslmode=require` | Production, Preview, Development |
| `JWT_SECRET` | `your-super-secret-jwt-key-min-32-chars` | All |
| `SUPPLIER_BASE_URL` | `https://protal.authzen.site/api/v1` | All |
| `SUPPLIER_API_KEY` | `sk_live_your_key_here` | All |
| `CRON_SECRET` | `random-secret-for-cron-jobs` | Production |
| `DISCORD_WEBHOOK_URL` | `https://discord.com/api/webhooks/xxx/yyy` | All (optional) |
| `KL_API_TOKEN` | `your-keylaiicense-token` | All (optional) |

---

## Step 3: Deploy to Vercel

1. Push to GitHub (main branch)
2. Vercel auto-deploys on push
3. Check **Deployments** tab for build status

---

## Step 4: Run Database Migration (ONE TIME)

After first successful deploy, run the migration script:

```bash
# Option 1: Run locally with DATABASE_URL pointing to Neon
DATABASE_URL="your-neon-connection-string" node scripts/migrate-supplier-variants.cjs

# Option 2: Run via Vercel CLI (if you have it)
vercel env pull .env.local && node scripts/migrate-supplier-variants.cjs
```

This will:
- Add new columns to `supplier_variants` table
- Create `supplier_settings`, `product_mappings`, `deliveries`, `hwid_reset_log` tables
- Create proper indexes
- Set defaults for existing rows

---

## Step 5: Verify Deployment

1. Visit your Vercel URL: `https://your-project.vercel.app`
2. Go to `/admin.html` and login: `admin` / `admin123456`
3. Check **Supplier APIs** tab - should load
4. Click **Sync from Supplier** in Product Mappings
5. Verify mappings are created

---

## Step 6: Migrate Existing Mappings (if any)

If you had existing mappings in the old `supplier_variants` table, run this SQL in Neon console:

```sql
-- Update existing mappings #1 and #2
UPDATE supplier_variants SET 
  supplier_product_id = 46,
  supplier_product_name = 'BR MODS PC',
  supplier_plan_days = 1,
  supplier_plan_label = '1 Days',
  supplier_plan_price = 0.38,
  supplier_status = 'active',
  is_active = true,
  auto_delivery = true
WHERE id = 1;

UPDATE supplier_variants SET 
  supplier_product_id = 46,
  supplier_product_name = 'BR MODS PC',
  supplier_plan_days = 7,
  supplier_plan_label = '7 Days',
  supplier_plan_price = 2.00,
  supplier_status = 'active',
  is_active = true,
  auto_delivery = true
WHERE id = 2;
```

---

## Verification Checklist

- [ ] Admin panel loads at `/admin.html`
- [ ] Login works: `admin` / `admin123456`
- [ ] **Supplier APIs** tab loads
- [ ] **Product Mappings** tab shows form
- [ ] **Sync from Supplier** button works
- [ ] **Supplier Catalog** shows 9 products with 34 variants
- [ ] **Saved Mappings** table shows existing mappings
- [ ] **Supplier Settings** shows balance $236.86
- [ ] **Sync Products** creates 34 mappings

---

## Troubleshooting

### "DATABASE_URL not configured"
→ Check Vercel Environment Variables → DATABASE_URL is set for Production

### "Database connection failed"
→ Check Neon connection string format: `postgresql://user:pass@host/db?sslmode=require`

### "Tables don't exist"
→ Run migration script: `node scripts/migrate-supplier-variants.cjs`

### "Sync from Supplier fails"
- Check Vercel Function Logs for errors
- Verify `SUPPLIER_BASE_URL` and `SUPPLIER_API_KEY` are correct
- Check Neon connection from Vercel Functions

### Data not persisting between deploys
→ Ensure `DATABASE_URL` is set in Vercel Environment Variables for **Production**

---

## Files Changed

| File | Purpose |
|------|---------|
| `lib/db.js` | Requires DATABASE_URL in production; no silent mock fallback |
| `sql/schema.sql` | Uses `CREATE TABLE IF NOT EXISTS` instead of DROP |
| `vercel.json` | Added DATABASE_URL to env |
| `.env.example` | Updated with proper placeholders |
| `scripts/migrate-supplier-variants.cjs` | Production migration script |
| `scripts/migrate-data.mjs` | Data export/import utility |

---

## Redeploy

After making changes:

```bash
git add .
git commit -m "feat: fix data persistence with Neon PostgreSQL on Vercel"
git push origin main
```

Vercel will auto-deploy. Remember to set `DATABASE_URL` in Vercel Dashboard before the deploy completes!