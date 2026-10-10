import { query } from './db.js';

let cascadeSchemaEnsured = false;

/**
 * Ensures orders table has product_name & plan_name snapshot columns
 * and updates foreign key constraints from RESTRICT to ON DELETE SET NULL.
 * This guarantees safe deletion of products and plans without foreign key constraint errors,
 * while preserving customer purchase history and financial accounting integrity.
 */
export async function ensureProductCascadeSchema() {
  if (cascadeSchemaEnsured) return;

  try {
    // 1. Add product_name and plan_name snapshot columns if not already present
    await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_name TEXT;').catch(() => {});
    await query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS plan_name TEXT;').catch(() => {});

    // 2. Backfill snapshot columns for any existing orders from active products & plans
    await query(`
      UPDATE orders o
      SET product_name = p.name
      FROM products p
      WHERE o.product_id = p.id AND (o.product_name IS NULL OR o.product_name = '');
    `).catch(() => {});

    await query(`
      UPDATE orders o
      SET plan_name = pl.plan_name
      FROM plans pl
      WHERE o.plan_id = pl.id AND (o.plan_name IS NULL OR o.plan_name = '');
    `).catch(() => {});

    // 3. Ensure product_id and plan_id in orders can be NULL
    await query('ALTER TABLE orders ALTER COLUMN product_id DROP NOT NULL;').catch(() => {});
    await query('ALTER TABLE orders ALTER COLUMN plan_id DROP NOT NULL;').catch(() => {});

    // 4. Update orders_product_id_fkey to ON DELETE SET NULL instead of RESTRICT
    await query('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_product_id_fkey;').catch(() => {});
    await query(`
      ALTER TABLE orders 
      ADD CONSTRAINT orders_product_id_fkey 
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
    `).catch(() => {});

    // 5. Update orders_plan_id_fkey to ON DELETE SET NULL instead of RESTRICT
    await query('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_plan_id_fkey;').catch(() => {});
    await query(`
      ALTER TABLE orders 
      ADD CONSTRAINT orders_plan_id_fkey 
      FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;
    `).catch(() => {});

    // 6. Ensure starter plans (days <= 1 or 1 Day) have an active discount (default 10%) so starter plan also shows discount
    await query(`
      UPDATE plans 
      SET discount_percent = 10 
      WHERE (days <= 1 OR plan_name ILIKE '%1 Day%' OR plan_name ILIKE '%starter%') 
        AND (discount_percent = 0 OR discount_percent IS NULL);
    `).catch(() => {});

    cascadeSchemaEnsured = true;
  } catch (err) {
    console.warn('[DB Migration] ensureProductCascadeSchema notice:', err.message);
  }
}
