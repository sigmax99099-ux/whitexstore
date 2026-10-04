export default function handler(req, res) {
  res.status(200).json({
    status: 'online',
    service: 'White X Store API',
    timestamp: new Date().toISOString()
  });
}
