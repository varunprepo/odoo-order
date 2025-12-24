// Simple WebSocket bridge with JWT auth and per-device targeting
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'replace_with_strong_secret';

// map deviceId -> ws
const devices = new Map();

// Middleware to verify webhook secret (optional)
function verifyWebhook(req, res, next) {
  // implement HMAC or token verification here
  const token = req.headers['x-webhook-secret'];
  if (token !== 'replace_with_strong_secret') {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.post('/odoo/webhook/order', verifyWebhook, (req, res) => {
  try {
    const order = req.body;
    // Accept: { order_number, customer_name, contact, salesman, deviceId(optional) }
    const payload = { type: 'order_created', order };
    if (order.deviceId) {
      const ws = devices.get(order.deviceId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        return res.json({ ok: true, targeted: true });
      } else {
        // device offline
        return res.status(404).json({ ok:false, error:'device_offline' });
      }
    }
    // broadcast
    for (const [id, ws] of devices) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    }
    return res.json({ ok: true, broadcast: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false });
  }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Simple token-based auth on WebSocket upgrade using query token
wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const deviceId = url.searchParams.get('deviceId') || ('dev_' + Math.random().toString(36).slice(2,8));
    if (!token) {
      ws.close(4001, 'missing_token');
      return;
    }
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      // Optionally verify decoded.deviceId matches deviceId
    } catch (err) {
      ws.close(4002, 'invalid_token');
      return;
    }
    devices.set(deviceId, ws);
    ws.deviceId = deviceId;
    console.log('Device connected:', deviceId);

    ws.on('message', (m) => {
      try {
        const msg = JSON.parse(m);
        if (msg.type === 'register' && msg.deviceId) {
          devices.set(msg.deviceId, ws);
          ws.deviceId = msg.deviceId;
        }
      } catch (e) {}
    });

    ws.on('close', () => {
      console.log('Device disconnected:', ws.deviceId);
      devices.delete(ws.deviceId);
    });
  } catch (e) {
    console.error('connection error', e);
    ws.close();
  }
});

server.listen(PORT, () => console.log('Server listening on', PORT));
