// app.js - frontend logic
const symbolListEl = document.getElementById('symbolList');
const titleEl = document.getElementById('title');
const currentPriceEl = document.getElementById('currentPrice');
const trendEl = document.getElementById('trend');
const smaPeriodInput = document.getElementById('smaPeriod');
const pauseBtn = document.getElementById('pauseBtn');

let ws;
let paused = false;
let selectedSymbol = null;
let chart;
let maxPoints = 120;
let datasets = {
  price: [],
  sma: []
};

// helper: format time
function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

// SMA algorithm: given array of numbers compute SMA array
function computeSMA(values, period) {
  if (!values || values.length === 0) return [];
  const res = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
      res.push(Number((sum / period).toFixed(4)));
    } else {
      // for first few points, compute average of available values
      res.push(Number((sum / (i + 1)).toFixed(4)));
    }
  }
  return res;
}

// build chart
function createChart() {
  const ctx = document.getElementById('chart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [], // times
      datasets: [
        {
          label: 'Price',
          data: [],
          borderWidth: 1.5,
          pointRadius: 0.5,
          tension: 0.15,
        },
        {
          label: 'SMA',
          data: [],
          borderWidth: 1,
          borderDash: [6,4],
          pointRadius: 0,
          tension: 0.15,
        }
      ]
    },
    options: {
      animation: false,
      parsing: false,
      normalized: true,
      scales: {
        x: { display: true, ticks: { maxRotation: 0 } },
        y: { display: true, beginAtZero: false }
      },
      plugins: {
        legend: { display: true }
      }
    }
  });
}

// update chart with arrays of {t, price}
function renderData(history) {
  const labels = history.map(h => fmtTime(h.t));
  const prices = history.map(h => h.price);
  const period = Math.max(2, parseInt(smaPeriodInput.value || '20', 10));
  const sma = computeSMA(prices, period);

  // trim to maxPoints
  const start = Math.max(0, prices.length - maxPoints);
  const l = labels.slice(start);
  const p = prices.slice(start);
  const s = sma.slice(start);

  chart.data.labels = l;
  chart.data.datasets[0].data = p.map((v, i) => ({ x: l[i], y: v }));
  chart.data.datasets[1].data = s.map((v, i) => ({ x: l[i], y: v }));
  chart.update('none');

  // update meta
  if (p.length > 0) {
    const last = p[p.length - 1];
    currentPriceEl.innerText = last.toFixed(2);
    // simple trend: compare price to sma last
    const lastSMA = s[s.length - 1] || last;
    trendEl.innerText = (last >= lastSMA) ? 'UP' : 'DOWN';
    trendEl.style.color = (last >= lastSMA) ? '#60d394' : '#ff6b6b';
  }
}

// handle incoming tick broadcast
function handleTick(payload) {
  // payload is array of quotes [{symbol, t, price}, ...]
  const quote = payload.find(q => q.symbol === selectedSymbol);
  if (!quote) return;
  // append to chart
  const label = fmtTime(quote.t);
  const price = quote.price;
  // push
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(price);
  // compute SMA on latest window
  const prices = chart.data.datasets[0].data.map(x => (typeof x === 'object' ? x.y : x));
  const period = Math.max(2, parseInt(smaPeriodInput.value || '20', 10));
  const sma = computeSMA(prices, period);
  chart.data.datasets[1].data = sma.map(v => v);

  // trim
  while (chart.data.labels.length > maxPoints) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
    chart.data.datasets[1].data.shift();
  }

  chart.update('none');

  // update meta
  currentPriceEl.innerText = price.toFixed(2);
  const lastSMA = sma[sma.length - 1] || price;
  trendEl.innerText = (price >= lastSMA) ? 'UP' : 'DOWN';
  trendEl.style.color = (price >= lastSMA) ? '#60d394' : '#ff6b6b';
}

// Connect WebSocket
function connectWS() {
  const loc = window.location;
  const wsURL = (loc.protocol === 'https:' ? 'wss://' : 'ws://') + loc.host;
  ws = new WebSocket(wsURL);

  ws.onopen = () => {
    console.log('ws open');
  };
  ws.onmessage = (evt) => {
    if (paused) return;
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'symbols') {
        populateSymbols(msg.payload);
      } else if (msg.type === 'history') {
        if (msg.symbol === selectedSymbol) {
          renderData(msg.history);
        }
      } else if (msg.type === 'tick') {
        handleTick(msg.payload);
      }
    } catch (e) {
      console.warn('bad ws data', e);
    }
  };
  ws.onclose = () => {
    console.log('ws closed, reconnecting in 1s...');
    setTimeout(connectWS, 1000);
  };
}

// populate symbol list in sidebar
function populateSymbols(symbols) {
  symbolListEl.innerHTML = '';
  symbols.forEach(sym => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${sym}</span><span id="price-${sym}" class="muted">—</span>`;
    li.onclick = () => selectSymbol(sym, li);
    symbolListEl.appendChild(li);
    // auto select first
    if (!selectedSymbol) {
      selectSymbol(sym, li);
    }
  });
}

// select symbol: subscribe via ws, fetch history
function selectSymbol(sym, liEl) {
  // mark active
  Array.from(symbolListEl.children).forEach(li => li.classList.remove('active'));
  if (liEl) liEl.classList.add('active');

  selectedSymbol = sym;
  titleEl.innerText = `${sym} • Live Price`;

  // subscribe via websocket: server replies with history
  try {
    ws.send(JSON.stringify({ type: 'subscribe', symbol: sym }));
  } catch (e) {
    // if ws not open yet, fetch REST endpoint directly as fallback
    fetch(`/api/history?symbol=${sym}`).then(r => r.json()).then(data => {
      renderData(data.history || []);
    });
  }
}

// pause button
pauseBtn.onclick = () => {
  paused = !paused;
  pauseBtn.innerText = paused ? 'Resume' : 'Pause';
};

// when SMA period changed, recompute chart overlay
smaPeriodInput.onchange = () => {
  // refresh overlay from existing chart dataset
  // fetch data currently in chart
  const prices = chart.data.datasets[0].data.map(x => (typeof x === 'object' ? x.y : x));
  const period = Math.max(2, parseInt(smaPeriodInput.value || '20', 10));
  const sma = computeSMA(prices, period);
  chart.data.datasets[1].data = sma;
  chart.update('none');
};

// init
createChart();
connectWS();

// also fetch initial REST history if ws not ready
window.addEventListener('load', () => {
  // nothing extra
});
