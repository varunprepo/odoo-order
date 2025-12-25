const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");

const app = express();
app.use(bodyParser.json());

const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "replace_with_strong_secret";

const devices = new Map();

// ---- HTTP webhook endpoint ----
app.post("/odoo/webhook/order", (req, res) => {
  try {
    const order = req.body;
    const payload = { type: "order_created", order };

    // targeted print
    if (order.deviceId) {
      const ws = devices.get(order.deviceId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        return res.json({ ok: true, targeted: true });
      }
      return res.status(404).json({ ok: false, error: "device_offline" });
    }

    // broadcast
    for (const [, ws] of devices) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    }
    return res.json({ ok: true, broadcast: true });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false });
  }
});

// ---- Create HTTP server ----
const server = http.createServer(app);

// ---- WebSocket Server bound to "/ws" ----
const wss = new WebSocket.Server({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (!req.url.startsWith("/ws")) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

// ---- WS connection ----
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  const deviceId = url.searchParams.get("deviceId") || "dev_" + Math.random().toString(36).slice(2);

  console.log("WS CONNECT REQUEST:", req.url);

  if (!token) return ws.close(4001, "missing_token");

  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    return ws.close(4002, "invalid_token");
  }

  ws.deviceId = deviceId;
  devices.set(deviceId, ws);
  console.log("Device connected:", deviceId);

  ws.on("close", () => {
    console.log("Device disconnected:", deviceId);
    devices.delete(deviceId);
  });
});

// ---- Required on Render ----
server.listen(PORT, "0.0.0.0", () => {
  console.log(`WS server listening on ${PORT} (Render)`);
});

// ---- Ping keepalive ----
setInterval(() => {
  for (const [, ws] of devices) {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }
}, 20000);
