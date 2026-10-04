import { sendDiscordEmbed, DISCORD_COLORS } from '../lib/discord.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { title, description, color, fields } = req.body || {};

    if (!title || !description) {
      return res.status(400).json({ success: false, message: 'Title and description are required.' });
    }

    let parsedColor = DISCORD_COLORS.INFO;
    if (typeof color === 'string') {
      if (color === 'success') parsedColor = DISCORD_COLORS.SUCCESS;
      else if (color === 'pending' || color === 'warning') parsedColor = DISCORD_COLORS.PENDING;
      else if (color === 'error' || color === 'danger') parsedColor = DISCORD_COLORS.ERROR;
      else if (color.startsWith('#')) parsedColor = parseInt(color.replace('#', ''), 16);
      else if (color.startsWith('0x')) parsedColor = parseInt(color, 16);
    } else if (typeof color === 'number') {
      parsedColor = color;
    }

    const dispatched = await sendDiscordEmbed({
      title,
      description,
      color: parsedColor,
      fields: Array.isArray(fields) ? fields : []
    });

    return res.status(200).json({
      success: true,
      delivered: dispatched,
      message: dispatched ? 'Discord notification sent successfully!' : 'Discord notification could not be sent (check webhook configuration).'
    });
  } catch (err) {
    console.error('Notify endpoint error:', err);
    return res.status(500).json({ success: false, message: 'Notification failed: ' + err.message });
  }
}
