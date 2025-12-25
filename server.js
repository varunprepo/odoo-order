const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const app = express();
app.use(bodyParser.json());

const PORT = 3000; //process.env.PORT || 
const JWT_SECRET = process.env.JWT_SECRET || 'replace_with_strong_secret';

const devices = new Map();

app.post('/odoo/webhook/order', (req, res) => {
  const order = req.body;
  const payload = { type: 'order_created', order };

  let sent = false;
  for (const [id, ws] of devices) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      sent = true;
    }
  }

  return res.json({ ok: true, broadcast: sent });
});

const server = http.createServer(app);

/**
 * IMPORTANT: attach WebSocket to SAME server
 */
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const deviceId = url.searchParams.get('deviceId');

  if (!token || !deviceId) {
    ws.close(4001, 'missing_token_or_deviceId');
    return;
  }

  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    ws.close(4002, 'invalid_token');
    return;
  }

  devices.set(deviceId, ws);
  console.log('✅ Device connected:', deviceId);

  ws.on('close', () => {
    console.log('❌ Device disconnected:', deviceId);
    devices.delete(deviceId);
  });
});

/**
 * 🔑 CRITICAL FIX
 * Must bind to 0.0.0.0 on Render
 */
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server listening on ${PORT}`);
});
