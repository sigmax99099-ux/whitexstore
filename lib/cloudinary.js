import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

const isConfigured = Boolean(cloudName && apiKey && apiSecret);

if (isConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
} else {
  console.warn('⚠️ [Cloudinary] Credentials not fully set. Image uploads will fall back to data URIs.');
}

/**
 * Upload an image (base64 data URI, buffer, or remote URL) to Cloudinary
 * @param {string} fileInput - Base64 data string (e.g. data:image/png;base64,...) or remote URL
 * @param {string} folder - Destination folder on Cloudinary
 * @returns {Promise<string>} Uploaded secure image URL
 */
export async function uploadImage(fileInput, folder = 'white-x-store') {
  if (!fileInput) {
    throw new Error('No image file provided for upload.');
  }

  // Check file size if it's base64 (approx 5MB limit: 5 * 1024 * 1024 * 1.37 approx 7MB base64)
  if (typeof fileInput === 'string' && fileInput.startsWith('data:')) {
    const sizeInBytes = Math.round((fileInput.length * 3) / 4);
    if (sizeInBytes > 5 * 1024 * 1024) {
      throw new Error('Image size exceeds 5MB limit.');
    }

    // Validate MIME type
    const mimeMatch = fileInput.match(/^data:(image\/[a-zA-Z0-9\+\.\-]+);base64,/);
    if (!mimeMatch) {
      throw new Error('Invalid image format. Supported formats: JPEG, PNG, WEBP, GIF.');
    }
  }

  // If Cloudinary is configured, upload to Cloudinary CDN
  if (isConfigured) {
    try {
      const result = await cloudinary.uploader.upload(fileInput, {
        folder: folder,
        resource_type: 'image',
        transformation: [
          { quality: 'auto:good' },
          { fetch_format: 'auto' }
        ]
      });

      return result.secure_url;
    } catch (err) {
      console.error('Cloudinary upload error:', err);
      throw new Error(`Cloudinary upload failed: ${err.message}`);
    }
  }

  // Fallback: If running locally without Cloudinary, return the data URI or file directly
  return fileInput;
}

export default {
  uploadImage,
  isConfigured
};
