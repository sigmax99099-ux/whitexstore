import http from 'http';
import fs from 'fs';
import path from 'path';
import url from 'url';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve('public');
const API_DIR = path.resolve('api');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  // Add Vercel-like helper methods on res
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };

  res.json = function (data) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
    return res;
  };

  // 1. API Route Handler
  if (pathname.startsWith('/api/')) {
    const apiPath = pathname.substring(5); // strip '/api/'
    let modulePath = null;
    const queryParams = { ...parsedUrl.query };

    // Direct match: e.g. api/auth/login.js
    const directFile = path.join(API_DIR, apiPath + '.js');
    if (fs.existsSync(directFile)) {
      modulePath = directFile;
    } else {
      // Check for index.js
      const indexFile = path.join(API_DIR, apiPath, 'index.js');
      if (fs.existsSync(indexFile)) {
        modulePath = indexFile;
      } else {
        // Check for parameterized route: e.g. products/[id].js
        const parts = apiPath.split('/');
        if (parts.length === 2 && parts[0] === 'products') {
          const paramFile = path.join(API_DIR, 'products', '[id].js');
          if (fs.existsSync(paramFile)) {
            modulePath = paramFile;
            queryParams.id = parts[1];
          }
        }
      }
    }

    if (!modulePath) {
      return res.status(404).json({ success: false, message: `API route not found: ${pathname}` });
    }

    // Parse body for POST / PUT / PATCH
    let bodyData = null;
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      try {
        const buffers = [];
        for await (const chunk of req) {
          buffers.push(chunk);
        }
        const rawBody = Buffer.concat(buffers).toString('utf-8');
        if (rawBody) {
          try {
            bodyData = JSON.parse(rawBody);
          } catch (e) {
            bodyData = rawBody;
          }
        }
      } catch (err) {
        console.error('Body parsing error:', err);
      }
    }

    req.body = bodyData;
    req.query = queryParams;

    try {
      // Dynamic import of ES Module
      const moduleUrl = url.pathToFileURL(modulePath).href + `?t=${Date.now()}`;
      const { default: handler } = await import(moduleUrl);
      if (typeof handler === 'function') {
        await handler(req, res);
      } else {
        res.status(500).json({ success: false, message: 'Invalid serverless function export' });
      }
    } catch (err) {
      console.error(`[API Error] ${pathname}:`, err);
      if (!res.writableEnded) {
        res.status(500).json({ success: false, message: 'Internal Server Error: ' + err.message });
      }
    }
    return;
  }

  // 2. Static File Handler
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  // If path doesn't have an extension, try appending .html
  let filePath = path.join(PUBLIC_DIR, pathname);
  if (!path.extname(filePath) && fs.existsSync(filePath + '.html')) {
    filePath += '.html';
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <body style="background:#0a0a0f; color:#e6e6f0; font-family:sans-serif; text-align:center; padding:5rem;">
      <h1 style="color:#ef4444; font-size:3rem;">404 - Not Found</h1>
      <p>The requested page <code>${pathname}</code> was not found on White X Store.</p>
      <a href="/" style="color:#ef4444;">Return Home</a>
    </body>
  `);
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`⚡ WHITE X STORE — VERCEL NATIVE STACK SERVER ACTIVE`);
  console.log(`======================================================`);
  console.log(`📡 Local Server URL:  http://localhost:${PORT}`);
  console.log(`🎮 Client Store:      http://localhost:${PORT}/index.html`);
  console.log(`🛡️ Admin Console:     http://localhost:${PORT}/admin.html`);
  console.log(`🔑 Default Admin:     username: admin | password: admin123456`);
  console.log(`💾 PostgreSQL Neon:   ${process.env.DATABASE_URL ? 'Configured in .env' : '⚠️ Need DATABASE_URL in .env'}`);
  console.log(`======================================================\n`);
});
