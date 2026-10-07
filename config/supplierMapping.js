/**
 * Supplier Plan Mapping Configuration
 * 
 * Maps your shop's plan IDs to supplier API parameters.
 * This allows each product/plan in your shop to map to the right supplier parameters.
 * 
 * How to use:
 * 1. Find your plan IDs from the admin panel or database
 * 2. Map them to your supplier's product names and durations
 * 3. The supplier API will be called with these parameters
 * 
 * Example:
 * If your supplier has products like "BR MODS PC", "BR MODS MOBILE", etc.
 * And you sell "1 Day", "7 Day", "30 Day" plans
 * 
 * You would map:
 *   1: { product: "BR MODS PC", days: 1 },    // Plan ID 1 -> 1 day of BR MODS PC
 *   2: { product: "BR MODS PC", days: 7 },    // Plan ID 2 -> 7 days of BR MODS PC
 *   3: { product: "BR MODS PC", days: 30 },   // Plan ID 3 -> 30 days of BR MODS PC
 *   4: { product: "BR MODS MOBILE", days: 1 }, // Plan ID 4 -> 1 day of BR MODS MOBILE
 *   etc.
 */

// Plan ID -> Supplier Parameters mapping
// Get your plan IDs from: SELECT id, plan_name, product_id FROM plans;
export const SUPPLIER_PLAN_MAPPING = {
  // Example mappings - REPLACE WITH YOUR ACTUAL PLAN IDs AND SUPPLIER PRODUCTS
  // Apex Legends (Product 1)
  // 1: { product: "BR MODS PC", days: 1 },      // 1 Day Access
  // 2: { product: "BR MODS PC", days: 7 },      // 7 Days Access
  // 3: { product: "BR MODS PC", days: 30 },     // 30 Days Access
  
  // Valorant (Product 2)
  // 4: { product: "BR MODS PC", days: 1 },      // 1 Day Key
  // 5: { product: "BR MODS PC", days: 7 },      // 7 Days Key
  // 6: { product: "BR MODS PC", days: 30 },     // 30 Days Key
  
  // PUBG Mobile (Product 3)
  // 7: { product: "BR MODS MOBILE", days: 1 },  // 1 Day Pass
  // 8: { product: "BR MODS MOBILE", days: 7 },  // 7 Days Pass
  // 9: { product: "BR MODS MOBILE", days: 30 }, // 30 Days Pass
  
  // Warzone (Product 4)
  // 10: { product: "BR MODS PC", days: 1 },     // 1 Day VIP
  // 11: { product: "BR MODS PC", days: 7 },     // 7 Days VIP
  // 12: { product: "BR MODS PC", days: 30 },    // 30 Days VIP
  
  // Fortnite (Product 5)
  // 13: { product: "BR MODS PC", days: 1 },     // 1 Day Key
  // 14: { product: "BR MODS PC", days: 7 },     // 7 Days Key
  // 15: { product: "BR MODS PC", days: 30 },    // 30 Days Key
};

/**
 * Alternative: Product + Plan combination mapping
 * Use this if the same plan ID is used across multiple products
 * but maps to different supplier products
 */
export const SUPPLIER_PRODUCT_PLAN_MAPPING = {
  // "productId:planId": { product: "SUPPLIER_PRODUCT_NAME", days: N }
  // Example:
  // "1:1": { product: "BR MODS PC", days: 1 },    // Apex 1-Day -> BR MODS PC 1 day
  // "1:2": { product: "BR MODS PC", days: 7 },    // Apex 7-Day -> BR MODS PC 7 day
  // "2:4": { product: "BR MODS PC", days: 1 },    // Valorant 1-Day -> BR MODS PC 1 day
  // "3:7": { product: "BR MODS MOBILE", days: 1 }, // PUBG 1-Day -> BR MODS MOBILE 1 day
};

/**
 * Get supplier parameters for a plan
 * Checks both mappings in order of specificity
 */
export function getSupplierParams(productId, planId) {
  // First check product+plan specific mapping
  const productPlanKey = `${productId}:${planId}`;
  if (SUPPLIER_PRODUCT_PLAN_MAPPING[productPlanKey]) {
    return SUPPLIER_PRODUCT_PLAN_MAPPING[productPlanKey];
  }
  
  // Then check plan-only mapping
  if (SUPPLIER_PLAN_MAPPING[planId]) {
    return SUPPLIER_PLAN_MAPPING[planId];
  }
  
  return null;
}

export default {
  SUPPLIER_PLAN_MAPPING,
  SUPPLIER_PRODUCT_PLAN_MAPPING,
  getSupplierParams
};