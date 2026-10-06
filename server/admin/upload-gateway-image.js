import { query } from '../../lib/db.js';
import { getAuthAdmin } from '../../lib/auth.js';

/**
 * Secure admin-only file upload endpoint for payment gateway QR codes and logos
 * POST /api/admin/upload/gateway-image
 * 
 * Expected multipart/form-data with:
 * - file: the image file (required)
 * - type: 'qr' or 'logo' (required)
 * - gateway_id: existing gateway ID if replacing (optional)
 */

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB

// Magic bytes for file type validation
const FILE_SIGNATURES = {
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF header, then check for WEBP at offset 8
};

function validateFileSignature(buffer, mimeType) {
  const signature = FILE_SIGNATURES[mimeType];
  if (!signature) return false;
  
  if (mimeType === 'image/webp') {
    // Check RIFF header + WEBP at offset 8
    if (buffer.length < 12) return false;
    const riff = [buffer[0], buffer[1], buffer[2], buffer[3]];
    const webp = [buffer[8], buffer[9], buffer[10], buffer[11]];
    return riff[0] === 0x52 && riff[1] === 0x49 && riff[2] === 0x46 && riff[3] === 0x46 &&
           webp[0] === 0x57 && webp[1] === 0x45 && webp[2] === 0x42 && webp[3] === 0x50;
  }
  
  return signature.every((byte, i) => buffer[i] === byte);
}

function generateSafeFilename(originalName, prefix) {
  const ext = originalName.toLowerCase().match(/\.(jpg|jpeg|png|webp)$/)?.[0] || '.png';
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${timestamp}_${random}${ext}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const admin = await getAuthAdmin(req);
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Admin access required.' });
  }

  try {
    // Parse multipart form data
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ success: false, message: 'Content-Type must be multipart/form-data' });
    }

    // Extract boundary from Content-Type
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) {
      return res.status(400).json({ success: false, message: 'Invalid multipart boundary' });
    }

    // Remove quotes if present
    const cleanBoundary = boundary.replace(/^"|"$/g, '').trim();

    // Use pre-read raw buffers from dev-server.js (for multipart)
    let rawBody;
    if (req.rawBodyBuffers && req.rawBodyBuffers.length > 0) {
      rawBody = Buffer.concat(req.rawBodyBuffers);
    } else {
      // Fallback: read from stream (for non-dev-server environments)
      const buffers = [];
      for await (const chunk of req) {
        buffers.push(chunk);
      }
      rawBody = Buffer.concat(buffers);
    }

    // Parse multipart data
    const parts = parseMultipart(rawBody, cleanBoundary);
    
    const filePart = parts.find(p => p.name === 'file');
    const typePart = parts.find(p => p.name === 'type');
    const gatewayIdPart = parts.find(p => p.name === 'gateway_id');

    if (!filePart) {
      console.log('[Upload Debug] No file part found in parts:', parts.map(p => p.name));
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const type = typePart?.data?.toString('utf-8')?.trim();
    if (!type || !['qr', 'logo'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid type. Must be "qr" or "logo"' });
    }

    const gatewayId = gatewayIdPart?.data?.toString('utf-8')?.trim();
    
    const fileBuffer = filePart.data;
    const filename = filePart.filename || 'image.png';
    const mimeType = filePart.mimeType || 'application/octet-stream';
    
    console.log('[Upload Debug] File buffer length:', fileBuffer?.length, 'filename:', filename, 'mimeType:', mimeType);

    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ success: false, message: 'File is empty' });
    }

    // Validate file size
    if (fileBuffer.length > MAX_FILE_SIZE) {
      return res.status(400).json({ 
        success: false, 
        message: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` 
      });
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return res.status(400).json({ 
        success: false, 
        message: `Invalid file type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}` 
      });
    }

    // Validate file extension
    const ext = filename.toLowerCase().match(/\.(jpg|jpeg|png|webp)$/)?.[0];
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid file extension. Allowed: .jpg, .jpeg, .png, .webp' 
      });
    }

    // Validate file signature (magic bytes)
    if (!validateFileSignature(fileBuffer, mimeType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'File signature does not match declared type. Possible corrupted or disguised file.' 
      });
    }

    // Generate safe filename
    const prefix = type === 'qr' ? 'qr' : 'logo';
    const safeFilename = generateSafeFilename(filename, prefix);

    // Convert to base64 for Cloudinary upload
    const base64 = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;

    // Upload to Cloudinary (uses existing uploadImage which handles fallback)
    const { uploadImage } = await import('../../lib/cloudinary.js');
    let imageUrl;
    try {
      imageUrl = await uploadImage(base64, `white-x-store/${type}s`);
    } catch (uploadErr) {
      console.error('Cloudinary upload error:', uploadErr);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to upload image to storage: ' + uploadErr.message 
      });
    }

    // If gateway_id provided, delete old image
    if (gatewayId) {
      const oldRes = await query(
        `SELECT qr_image, logo_url FROM payment_methods WHERE id = $1`,
        [parseInt(gatewayId, 10)]
      );
      if (oldRes.rows.length > 0) {
        const old = oldRes.rows[0];
        const oldUrl = type === 'qr' ? old.qr_image : old.logo_url;
        // Note: We don't delete from Cloudinary here to avoid accidental deletions
        // In production, you might want to implement proper cleanup
      }
    }

    return res.status(200).json({
      success: true,
      message: `${type.toUpperCase()} image uploaded successfully`,
      url: imageUrl,
      filename: safeFilename
    });

  } catch (err) {
    console.error('Gateway image upload error:', err);
    return res.status(500).json({ success: false, message: 'Upload failed: ' + err.message });
  }
}

/**
 * Simple multipart/form-data parser
 * Returns array of { name, filename, mimeType, data: Buffer }
 */
function parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryBytes = Buffer.from(`--${boundary}`);
  const endBoundaryBytes = Buffer.from(`--${boundary}--`);
  
  let start = 0;
  
  // Find first boundary
  let boundaryIndex = buffer.indexOf(boundaryBytes, start);
  if (boundaryIndex === -1) return parts;
  
  start = boundaryIndex + boundaryBytes.length;
  
  while (true) {
    // Find next boundary
    boundaryIndex = buffer.indexOf(boundaryBytes, start);
    const isLast = boundaryIndex === -1;
    
    if (isLast) {
      boundaryIndex = buffer.indexOf(endBoundaryBytes, start);
      if (boundaryIndex === -1) break;
    }
    
    const partData = buffer.subarray(start, boundaryIndex);
    
    // Parse headers and body
    const headerEnd = findHeaderEnd(partData);
    if (headerEnd === -1) {
      start = boundaryIndex + boundaryBytes.length;
      continue;
    }
    
    const headers = partData.subarray(0, headerEnd).toString('utf-8');
    const body = partData.subarray(headerEnd + 4); // +4 for \r\n\r\n
    
    // Remove trailing \r\n
    const cleanBody = body.length >= 2 && body[body.length - 2] === 0x0D && body[body.length - 1] === 0x0A
      ? body.subarray(0, body.length - 2)
      : body;
    
    // Parse headers
    // Match name="..." that comes right after "form-data;" (specific pattern)
    const contentDisposition = headers.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"/i);
    const filenameMatch = headers.match(/filename="([^"]+)"/i);
    const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    
    if (contentDisposition) {
      parts.push({
        name: contentDisposition[1],
        filename: filenameMatch?.[1] || '',
        mimeType: contentTypeMatch?.[1]?.trim() || 'application/octet-stream',
        data: cleanBody
      });
    }
    
    if (isLast) break;
    start = boundaryIndex + boundaryBytes.length;
  }
  
  return parts;
}

function findHeaderEnd(buffer) {
  // Look for \r\n\r\n
  for (let i = 0; i < buffer.length - 3; i++) {
    if (buffer[i] === 0x0D && buffer[i+1] === 0x0A && buffer[i+2] === 0x0D && buffer[i+3] === 0x0A) {
      return i;
    }
  }
  return -1;
}