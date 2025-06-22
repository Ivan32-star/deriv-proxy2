const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

let ultimaSenal = { mensaje: '⏳ Aún sin señal' };

// 💡 Tu token Deriv real
const TOKEN = 'h1JZ1vGjMHPBw9V';  // ← Este es el tuyo, ya listo

const ws = new WebSocket('wss://ws.deriv.com/websockets/v3?app_id=1089');

// Enviar mensaje inicial para V75
ws.on('open', () => {
  console.log('📡 Conectado a Deriv WebSocket');

  ws.send(JSON.stringify({
    ticks_history: 'R_75',
    adjust_start_time: 1,
    count: 100,
    end: 'latest',
    start: 1,
    style: 'candles',
    granularity: 60,
    subscribe: 1
  }));
});

// Análisis técnico
function calcularIndicadores(candles) {
  const cierres = candles.map(c => parseFloat(c.close));
  const altos = candles.map(c => parseFloat(c.high));
  const bajos = candles.map(c => parseFloat(c.low));

  const rsi = calcularRSI(cierres);
  const { adx, pdi, ndi } = calcularADX(altos, bajos, cierres);

  let tendencia = '❔ Indefinida';
  if (adx > 25) {
    tendencia = pdi > ndi ? '📈 Tendencia Alcista' : '📉 Tendencia Bajista';
  } else {
    tendencia = '🔁 Rango o consolidación';
  }

  return { rsi, adx, pdi, ndi, tendencia };
}

// RSI simple
function calcularRSI(cierres, periodo = 14) {
  let ganancias = 0, perdidas = 0;
  for (let i = 1; i <= periodo; i++) {
    const cambio = cierres[i] - cierres[i - 1];
    if (cambio >= 0) ganancias += cambio;
    else perdidas -= cambio;
  }
  const rs = ganancias / (perdidas || 1);
  return +(100 - (100 / (1 + rs))).toFixed(2);
}

// ADX básico
function calcularADX(highs, lows, closes, periodo = 14) {
  let tr = [], plusDM = [], minusDM = [];

  for (let i = 1; i < highs.length; i++) {
    const highDiff = highs[i] - highs[i - 1];
    const lowDiff = lows[i - 1] - lows[i];

    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);

    const highLow = highs[i] - lows[i];
    const highClose = Math.abs(highs[i] - closes[i - 1]);
    const lowClose = Math.abs(lows[i] - closes[i - 1]);

    tr.push(Math.max(highLow, highClose, lowClose));
  }

  const atr = tr.reduce((a, b) => a + b, 0) / periodo;
  const pdi = 100 * (plusDM.reduce((a, b) => a + b, 0) / periodo) / atr;
  const ndi = 100 * (minusDM.reduce((a, b) => a + b, 0) / periodo) / atr;
  const dx = 100 * Math.abs(pdi - ndi) / (pdi + ndi || 1);

  return {
    adx: +dx.toFixed(2),
    pdi: +pdi.toFixed(2),
    ndi: +ndi.toFixed(2)
  };
}

// Recibir datos de vela
ws.on('message', data => {
  const json = JSON.parse(data);
  const candles = json.history?.candles || json.candles;

  if (candles && candles.length > 15) {
    const indicadores = calcularIndicadores(candles);
    const precioActual = candles[candles.length - 1].close;

    ultimaSenal = {
      precio: precioActual,
      ...indicadores,
      hora: new Date().toLocaleTimeString()
    };

    console.log(`✅ Señal: ${indicadores.tendencia} | RSI ${indicadores.rsi} | ADX ${indicadores.adx}`);
  }
});

ws.on('error', err => {
  console.error('❌ Error WebSocket:', err.message);
});

// Endpoint API
app.get('/api/senal', (req, res) => {
  res.json(ultimaSenal);
});

app.listen(10000, () => {
  console.log('🚀 Servidor en http://localhost:10000');
});
