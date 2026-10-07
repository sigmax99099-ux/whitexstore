import { getAuthAdmin } from '../../lib/auth.js';
import { retryPendingDeliveries } from '../../services/delivery.js';

export default async function handler(req, res) {
  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const result = await retryPendingDeliveries();
    
    if (result.success) {
      return res.status(200).json({
        success: true,
        message: `Retry completed. Processed ${result.results.length} pending orders.`,
        results: result.results
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to retry pending deliveries: ' + result.error
      });
    }
  } catch (err) {
    console.error('Retry pending deliveries error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}