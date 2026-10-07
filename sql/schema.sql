-- ==========================================================
-- WHITE X STORE — NEON POSTGRESQL DATABASE SCHEMA
-- Compatible with PostgreSQL 14+ / Neon Serverless Postgres
-- ==========================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing tables if re-initializing (in dependency order)
DROP TABLE IF EXISTS login_attempts CASCADE;
DROP TABLE IF EXISTS password_resets CASCADE;
DROP TABLE IF EXISTS reseller_prices CASCADE;
DROP TABLE IF EXISTS supplier_variants CASCADE;
DROP TABLE IF EXISTS hwid_reset_log CASCADE;
DROP TABLE IF EXISTS deliveries CASCADE;
DROP TABLE IF EXISTS product_mappings CASCADE;
DROP TABLE IF EXISTS supplier_settings CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS wallet_transactions CASCADE;
DROP TABLE IF EXISTS payment_methods CASCADE;
DROP TABLE IF EXISTS license_keys CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS plans CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS admins CASCADE;

-- 1. USERS TABLE
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  user_type TEXT NOT NULL DEFAULT 'customer' CHECK (user_type IN ('customer', 'reseller')),
  reseller_discount NUMERIC NOT NULL DEFAULT 0,
  wallet_balance NUMERIC NOT NULL DEFAULT 0, -- Stored in NPR
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. PRODUCTS TABLE
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  features TEXT NOT NULL, -- Stored as newline-delimited or JSON string
  image TEXT NOT NULL,    -- Cloudinary URL or fallback image
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden')),
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. PLANS TABLE
CREATE TABLE plans (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL,
  duration_type TEXT NOT NULL CHECK (duration_type IN ('hours', 'days')),
  days INT NOT NULL,
  price_usd NUMERIC NOT NULL,
  discount_percent NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. PAYMENT METHODS TABLE
CREATE TABLE payment_methods (
  id SERIAL PRIMARY KEY,
  method_name TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('NPR', 'INR', 'USD')),
  account_id TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  instructions TEXT NOT NULL,
  qr_image TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. ORDERS TABLE
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  order_code TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  plan_id INT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  amount_usd NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. LICENSE KEYS TABLE
CREATE TABLE license_keys (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  key_code TEXT NOT NULL UNIQUE,
  duration_type TEXT NOT NULL,
  days INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold', 'used', 'revoked')),
  assigned_order_id INT REFERENCES orders(id) ON DELETE SET NULL,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. WALLET TRANSACTIONS TABLE
CREATE TABLE wallet_transactions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('NPR', 'INR', 'USD')),
  payment_method_id INT REFERENCES payment_methods(id) ON DELETE SET NULL,
  screenshot TEXT, -- Cloudinary URL or image data
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  description TEXT NOT NULL,
  reject_reason TEXT,
  order_id INT REFERENCES orders(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. SETTINGS TABLE
CREATE TABLE settings (
  id SERIAL PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL
);

-- 9. SUPPLIER VARIANTS TABLE
CREATE TABLE supplier_variants (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  plan_id INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  supplier_variant_id TEXT NOT NULL,        -- plan.id from supplier API (e.g., "226")
  supplier_product_id INT NOT NULL,         -- product.id from supplier API (e.g., 46)
  supplier_product_name TEXT NOT NULL,      -- product.name from supplier API (e.g., "BR MODS PC")
  supplier_plan_days INT NOT NULL,          -- plan.duration_days as int (e.g., 1)
  supplier_plan_label TEXT,                 -- plan.label (e.g., "1 Days")
  supplier_plan_price NUMERIC,              -- plan.price as numeric (e.g., 0.38)
  auto_delivery BOOLEAN DEFAULT true,       -- auto-dispatch keys
  is_active BOOLEAN DEFAULT true,           -- enable/disable this mapping
  supplier_status TEXT DEFAULT 'active' CHECK (supplier_status IN ('active', 'upcoming', 'disabled'))
);

-- 10. RESELLER PRICES TABLE
CREATE TABLE reseller_prices (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  custom_price_usd NUMERIC NOT NULL,
  UNIQUE(user_id, plan_id)
);

-- 11. PASSWORD RESETS TABLE
CREATE TABLE password_resets (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used')),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. ADMINS TABLE
CREATE TABLE admins (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

-- 13. LOGIN ATTEMPTS TABLE (Rate Limiting)
CREATE TABLE login_attempts (
  id SERIAL PRIMARY KEY,
  ip_address TEXT NOT NULL,
  email TEXT,
  attempt_type TEXT NOT NULL CHECK (attempt_type IN ('login', 'register', 'forgot')),
  success INT NOT NULL DEFAULT 0 CHECK (success IN (0, 1)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 14. SUPPLIER SETTINGS (singleton)
CREATE TABLE supplier_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  auto_delivery_enabled BOOLEAN NOT NULL DEFAULT true,
  low_balance_threshold NUMERIC NOT NULL DEFAULT 10.00,
  last_known_balance NUMERIC,
  last_balance_check TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 15. PRODUCT MAPPINGS (store product/plan -> supplier product)
CREATE TABLE product_mappings (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  plan_id INT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  supplier_product_id INT NOT NULL,           -- e.g., 53 for EMOTE PANEL
  supplier_product_name TEXT NOT NULL,        -- cached for display
  supplier_plan_days INT NOT NULL,            -- e.g., 30
  supplier_plan_count INT NOT NULL DEFAULT 1, -- usually 1
  auto_delivery BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  supplier_status TEXT NOT NULL DEFAULT 'active' CHECK (supplier_status IN ('active', 'upcoming', 'disabled')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (product_id, plan_id)
);

CREATE INDEX idx_product_mappings_product ON product_mappings(product_id);
CREATE INDEX idx_product_mappings_plan ON product_mappings(plan_id);

-- 16. DELIVERIES (one per order, idempotent)
CREATE TABLE deliveries (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  product_mapping_id INT REFERENCES product_mappings(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'flagged')),
  keys TEXT[],                                -- array of license keys
  unit_price NUMERIC,                         -- per key cost from supplier
  total_cost NUMERIC,                         -- total deducted from balance
  balance_left NUMERIC,                       -- supplier balance after delivery
  expires_at TIMESTAMP WITH TIME ZONE,        -- key expiration from supplier
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  last_error TEXT,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  delivered_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_deliveries_status ON deliveries(status);
CREATE INDEX idx_deliveries_next_retry ON deliveries(next_retry_at) WHERE status IN ('pending', 'failed');

-- 17. HWID RESET LOG
CREATE TABLE hwid_reset_log (
  id SERIAL PRIMARY KEY,
  key_code TEXT NOT NULL,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_by_admin INT REFERENCES admins(id) ON DELETE SET NULL,
  ip_address TEXT,
  user_agent TEXT,
  result TEXT NOT NULL,                       -- 'success', 'failed', 'invalid_key', 'rate_limited'
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_hwid_reset_key ON hwid_reset_log(key_code);
CREATE INDEX idx_hwid_reset_user ON hwid_reset_log(requested_by);
CREATE INDEX idx_hwid_reset_created ON hwid_reset_log(created_at);

-- INDEXES FOR PERFORMANCE & RATE LIMITING
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_wallet_user ON wallet_transactions(user_id);
CREATE INDEX idx_keys_product_status ON license_keys(product_id, status);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip_address, attempt_type, created_at);

-- ==========================================================
-- DEFAULT SEED DATA
-- ==========================================================

-- Default Admin: username 'admin', password 'admin123456'
INSERT INTO admins (username, password_hash)
VALUES ('admin', '$2a$10$W7GJDzkxavf7LHt3pULcF.YJ5wejkwfZfL5.mQLxdc6og0kkB0ryG')
ON CONFLICT (username) DO NOTHING;

-- Default Demo Users
-- demo@whitex.store / demo1234 (customer with 5000 NPR)
-- reseller@whitex.store / reseller1234 (reseller with 25000 NPR and 15% discount)
INSERT INTO users (id, name, email, phone, password_hash, user_type, reseller_discount, wallet_balance, status) VALUES
('a0000000-0000-0000-0000-000000000001', 'Viper VIP', 'demo@whitex.store', '+9779811111111', '$2a$10$8VeNeVu1uogbbDOfiJCX..nVzynpoMNC4DZ5nToWT2vi/LE6KjIy6', 'customer', 0, 5000, 'active'),
('a0000000-0000-0000-0000-000000000002', 'Elite Reseller', 'reseller@whitex.store', '+9779822222222', '$2a$10$i7VID2KL9HpfRxKSIqvQ3ugRBq.66Hp9071VqXX3SqCpVOcalar6y', 'reseller', 15, 25000, 'active')
ON CONFLICT (email) DO NOTHING;

-- Default Settings
INSERT INTO settings (setting_key, setting_value) VALUES
('discord_webhook', ''),
('kl_api_token', ''),
('npr_usd_rate', '134.50'),
('inr_usd_rate', '84.00'),
('whatsapp_number', '+9779800000000'),
('min_topup_npr', '200'),
('site_notice', '⚡ Instant 24/7 Automated Key Delivery Active. 100% Undetected on Latest Game Patches.')
ON CONFLICT (setting_key) DO NOTHING;

-- Supplier Settings (singleton)
INSERT INTO supplier_settings (id, auto_delivery_enabled, low_balance_threshold) VALUES
(1, true, 10.00)
ON CONFLICT (id) DO NOTHING;

-- Default Payment Methods
INSERT INTO payment_methods (method_name, currency, account_id, account_holder, instructions, qr_image, status) VALUES
('eSewa (Nepal)', 'NPR', '9800000000', 'White X Store Official', 'Send exact NPR amount to this eSewa ID. Include your registered email or phone in the remarks. Upload transaction screenshot below.', 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80', 'active'),
('Khalti (Nepal)', 'NPR', '9800000000', 'White X Store Official', 'Send payment to Khalti wallet. Make sure remarks contain your White X registered account email. Submit screenshot after transfer.', 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80', 'active'),
('Bank Transfer (Nepal)', 'NPR', '0123456789012345', 'White X Store Pvt Ltd (Nabil Bank)', 'Transfer to Nabil Bank Account: 0123456789012345, Branch: Kathmandu. Upload voucher/screenshot.', NULL, 'active'),
('UPI / PhonePe / GPay (India)', 'INR', 'whitexstore@upi', 'White X Store India', 'Scan QR or pay directly to UPI ID: whitexstore@upi. Upload screenshot showing UPI UTR / Ref Number clearly.', 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80', 'active'),
('Crypto / Binance Pay (USDT)', 'USD', '258901452', 'White X Crypto Pay', 'Send USDT (BEP20 / TRC20) or Binance Pay ID 258901452. Enter TxID/Transaction hash and screenshot.', NULL, 'active');

-- Default Products
INSERT INTO products (id, name, category, description, features, image, status, featured, sort_order) VALUES
(1, 'Apex Legends - Phantom VIP', 'Apex Legends', 'Engineered kernel-level private bypass for Apex Legends. Clean stream-proof visuals and humanized predictive aimbot.', 'Stream-Proof ESP (Boxes, Bones, Health, Armor)
Configurable Prediction Smooth Aimbot
Loot & Item Glow Filter
Recoil & Sway Compensation
Spectator Count Warning
Supports Windows 10 & 11 (All builds)', 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=800&q=80', 'active', TRUE, 1),

(2, 'Valorant - Vanguard Vision ESP', 'Valorant', 'Top-tier external visual assistance for Valorant. 100% Ring-0 bypass undetected on current Vanguard update.', 'Custom Glow ESP & Visible Check
Spike Timer & Defuse Warning
Enemy Ability & Weapon Tracers
Custom FOV & Distance Limits
Safe Stream-Proof Overlay
Ultra-Low Latency Rendering', 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&q=80', 'active', TRUE, 2),

(3, 'PUBG Mobile - White X Magic Vanguard', 'PUBG Mobile', 'The ultimate iOS & Android emulator and rooted cheat suite. Features brutal bullet tracking and radar.', 'Bullet Track / Magic Bullet 360°
High-Precision 3D Box ESP & Bones
Vehicle & AirDrop Loot Radar
Memory No Recoil & Instant Hit
Fast Parachute & Speed Toggle
Safe Anti-Ban Emulation Protection', 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&q=80', 'active', TRUE, 3),

(4, 'Call of Duty: Warzone - Phantom Ghost', 'Warzone', 'Dominating multi-game engine for Warzone 2.0 & Modern Warfare 3 with built-in hardware spoofer compatibility.', 'Vector Memory Aimbot with Bone Prioritization
Full Player Skeleton ESP & Directional Radar
Loot, Cash, and Killstreak Highlight
No Flash / No Stun / Triggerbot
Silent Aim with Target Selection
Clean In-Game ImGui Menu', 'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=800&q=80', 'active', TRUE, 4),

(5, 'Fortnite - Chronos Private', 'Fortnite', 'Exclusive slot-based private software with EAC & BattlEye dynamic memory scramble and human aim curves.', 'Player 2D/3D Boxes, Skeleton & Distance
Weakpoint / Target Auto-Lock
Bullet Drop Prediction
Chest, Ammo Box & Llama Radar
Customizable Smooth & FOV Circle
No FPS Drop & Full Controller Support', 'https://images.unsplash.com/photo-1560253023-3ec5d502959f?w=800&q=80', 'active', FALSE, 5);

ALTER SEQUENCE products_id_seq RESTART WITH 6;

-- Default Plans for Products
INSERT INTO plans (id, product_id, plan_name, duration_type, days, price_usd, discount_percent) VALUES
-- Apex Legends (Product 1)
(1, 1, '1 Day Access', 'days', 1, 4.99, 0),
(2, 1, '7 Days Access', 'days', 7, 18.99, 10),
(3, 1, '30 Days Access', 'days', 30, 44.99, 20),

-- Valorant (Product 2)
(4, 2, '1 Day Key', 'days', 1, 6.99, 0),
(5, 2, '7 Days Key', 'days', 7, 24.99, 10),
(6, 2, '30 Days Key', 'days', 30, 59.99, 15),

-- PUBG Mobile (Product 3)
(7, 3, '1 Day Pass', 'days', 1, 2.99, 0),
(8, 3, '7 Days Pass', 'days', 7, 9.99, 15),
(9, 3, '30 Days Pass', 'days', 30, 24.99, 25),

-- Warzone (Product 4)
(10, 4, '1 Day VIP', 'days', 1, 5.49, 0),
(11, 4, '7 Days VIP', 'days', 7, 21.99, 10),
(12, 4, '30 Days VIP', 'days', 30, 49.99, 20),

-- Fortnite (Product 5)
(13, 5, '1 Day Key', 'days', 1, 5.99, 0),
(14, 5, '7 Days Key', 'days', 7, 22.99, 10),
(15, 5, '30 Days Key', 'days', 30, 52.99, 15);

ALTER SEQUENCE plans_id_seq RESTART WITH 16;

-- Sample Pre-loaded Available Keys for Instant Testing
INSERT INTO license_keys (product_id, key_code, duration_type, days, status) VALUES
(1, 'WHITEX-APEX-1D-DEMO-991A', 'days', 1, 'available'),
(1, 'WHITEX-APEX-7D-DEMO-482B', 'days', 7, 'available'),
(1, 'WHITEX-APEX-30D-DEMO-103C', 'days', 30, 'available'),
(2, 'WHITEX-VAL-1D-DEMO-772A', 'days', 1, 'available'),
(2, 'WHITEX-VAL-7D-DEMO-883B', 'days', 7, 'available'),
(3, 'WHITEX-PUBG-1D-DEMO-331A', 'days', 1, 'available'),
(3, 'WHITEX-PUBG-7D-DEMO-552B', 'days', 7, 'available'),
(4, 'WHITEX-WZ-1D-DEMO-661A', 'days', 1, 'available');
