// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === Config ===
const symbols = ['AAPL','GOOG','MSFT','TSLA','AMZN'];
const seedPrice = { AAPL:150, GOOG:2800, MSFT:300, TSLA:700, AMZN:3500 };
const HISTORY_POINTS = 120; // number of historical seconds to provide per symbol
const MAX_LENGTH = 500;     // keep history size bounded

// state: for each symbol we keep an array of {t, price}
const state = {};

function now() { return Date.now(); }

// initialize history with a gentle random walk
function initHistory(){
  symbols.forEach(sym => {
    let p = seedPrice[sym] || 100;
    state[sym] = [];
    for(let i = HISTORY_POINTS - 1; i >= 0; i--){
      const t = Date.now() - i * 1000;
      // small random move
      p = Math.max(0.01, p * (1 + (Math.random() - 0.5) * 0.002));
      state[sym].push({ t, price: Number(p.toFixed(2)) });
    }
  });
}
initHistory();

// tick: generate a new price for each symbol and broadcast
function tick() {
  const t = Date.now();
  symbols.forEach(sym => {
    const last = state[sym][state[sym].length - 1].price;
    // random walk with modest volatility
    const change = (Math.random() - 0.5) * 0.02 * last; // ±1% roughly
    const next = Math.max(0.01, last + change);
    state[sym].push({ t, price: Number(next.toFixed(2)) });
    if (state[sym].length > MAX_LENGTH) state[sym].shift();
  });

  // Build a compact payload of latest quotes
  const payload = symbols.map(sym => ({
    symbol: sym,
    t,
    price: state[sym][state[sym].length - 1].price
  }));

  const message = JSON.stringify({ type: 'tick', payload });
  // broadcast to all clients
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(message); } catch(e){/*ignore*/ }
    }
  });
}

// REST endpoint: get history for a symbol
app.get('/api/history', (req, res) => {
  const symbol = (req.query.symbol || symbols[0]).toUpperCase();
  if (!state[symbol]) return res.status(404).json({ error: 'Unknown symbol' });
  res.json({ symbol, history: state[symbol] });
});

// WebSocket handshake: allows subscribe messages from client
wss.on('connection', ws => {
  // send available symbols
  ws.send(JSON.stringify({ type: 'symbols', payload: symbols }));

  ws.on('message', msg => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'subscribe' && typeof data.symbol === 'string') {
        const sym = data.symbol.toUpperCase();
        if (state[sym]) {
          // send history immediately
          ws.send(JSON.stringify({ type: 'history', symbol: sym, history: state[sym] }));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Unknown symbol' }));
        }
      }
      // handle other message types if needed
    } catch (e) {
      // ignore malformed
    }
  });
});

// start periodic tick every 1 second
setInterval(tick, 1000);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
