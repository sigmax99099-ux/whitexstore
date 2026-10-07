import { getAuthAdmin } from '../../lib/auth.js';
import { query, getClient } from '../../lib/db.js';
import { getAccountInfo, isAutoDeliveryEnabled } from '../../services/supplierApi.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // GET: Fetch supplier settings
  if (req.method === 'GET') {
    try {
      const settingsRes = await query('SELECT * FROM supplier_settings WHERE id = 1');
      const settings = settingsRes.rows[0] || { 
        id: 1, 
        auto_delivery_enabled: true, 
        low_balance_threshold: 10.00,
        last_known_balance: null,
        last_balance_check: null
      };

      return res.status(200).json({ success: true, settings });
    } catch (err) {
      console.error('Get supplier settings error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // POST: Update supplier settings or perform actions
  if (req.method === 'POST') {
    try {
      const { auto_delivery_enabled, low_balance_threshold, action } = req.body || {};
      
      // Handle special actions
      if (action === 'test_connection') {
        const accountInfo = await getAccountInfo();
        if (accountInfo.ok !== true) {
          return res.status(400).json({ success: false, message: 'Failed to connect to supplier API' });
        }
        return res.status(200).json({ 
          success: true, 
          account: accountInfo.account,
          permitted_products: accountInfo.permitted_products
        });
      }
      
      if (action === 'refresh_balance') {
        const accountInfo = await getAccountInfo();
        if (accountInfo.ok !== true || accountInfo.account?.balance === undefined) {
          return res.status(400).json({ success: false, message: 'Failed to fetch balance' });
        }
        return res.status(200).json({ 
          success: true, 
          balance: accountInfo.account.balance 
        });
      }
      
      // Regular settings update
      if (auto_delivery_enabled !== undefined || low_balance_threshold !== undefined) {
        const updates = [];
        const params = [];
        
        if (auto_delivery_enabled !== undefined) {
          updates.push('auto_delivery_enabled = $' + (params.length + 1));
          params.push(auto_delivery_enabled === true);
        }
        if (low_balance_threshold !== undefined) {
          const threshold = parseFloat(low_balance_threshold);
          if (isNaN(threshold) || threshold < 0) {
            return res.status(400).json({ success: false, message: 'Invalid threshold value' });
          }
          updates.push('low_balance_threshold = $' + (params.length + 1));
          params.push(threshold);
        }
        
        if (updates.length === 0) {
          return res.status(400).json({ success: false, message: 'No fields to update' });
        }
        
        updates.push('updated_at = NOW()');
        
        await query(
          `UPDATE supplier_settings SET ${updates.join(', ')} WHERE id = 1`,
          params
        );
        
        const settingsRes = await query('SELECT * FROM supplier_settings WHERE id = 1');
        
        return res.status(200).json({ 
          success: true, 
          message: 'Settings updated successfully',
          settings: settingsRes.rows[0]
        });
      }
      
      return res.status(400).json({ success: false, message: 'Invalid request' });
    } catch (err) {
      console.error('Update supplier settings error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}