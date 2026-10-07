import { getAuthAdmin } from '../../lib/auth.js';
import { retryPendingDeliveries } from '../../services/delivery.js';

export default async function handler(req, res) {
  // Verify cron secret for Vercel Cron
  const cronSecret = req.headers['x-vercel-cron-secret'] || req.query.secret;
  const expectedSecret = process.env.CRON_SECRET;
  
  if (expectedSecret && cronSecret !== expectedSecret) {
    // Also allow admin auth as fallback
    const admin = await getAuthAdmin(req);
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const result = await retryPendingDeliveries();
    
    console.log('[Cron] Retry deliveries result:', result);
    
    return res.status(200).json({ 
      success: true, 
      message: result.success 
        ? `Processed ${result.results?.length || 0} pending deliveries` 
        : 'Retry job failed',
      ...result
    });
  } catch (err) {
    console.error('[Cron] Retry deliveries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}