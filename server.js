const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());

let ultimaSenal = { mensaje: 'Aún no hay datos disponibles' };

// Conectar al WebSocket real de Deriv
const ws = new WebSocket('wss://ws.deriv.com/websockets/v3?app_id=1089');

ws.on('open', () => {
  console.log('📡 Conectado al WebSocket de Deriv (V75)');

  // Solicitar datos de velas para Volatility 75
  ws.send(JSON.stringify({
    ticks_history: 'R_75',
    adjust_start_time: 1,
    count: 100,
    end: 'latest',
    start: 1,
    style: 'candles',
    granularity: 60, // Velas de 1 minuto
    subscribe: 1
  }));
});

ws.on('message', (data) => {
  const parsed = JSON.parse(data);

  if (parsed.candles && parsed.candles.length > 0) {
    const ultimasVelas = parsed.candles;
    const ultimaVela = ultimasVelas[ultimasVelas.length - 1];

    const open = parseFloat(ultimaVela.open);
    const close = parseFloat(ultimaVela.close);

    const tendencia = close > open ? 'ALCISTA' : (close < open ? 'BAJISTA' : 'LATERAL');

    ultimaSenal = {
      tiempo: new Date(ultimaVela.epoch * 1000).toLocaleString(),
      open,
      close,
      tendencia,
      mensaje: `Tendencia detectada: ${tendencia}`
    };

    console.log(`✅ Vela ${tendencia} - Open: ${open} | Close: ${close}`);
  }
});

ws.on('error', (err) => {
  console.error('❌ Error en WebSocket Deriv:', err.message);
});

ws.on('close', () => {
  console.log('🔁 Conexión cerrada. Reintentando en 5 segundos...');
  setTimeout(() => reconnect(), 5000);
});

function reconnect() {
  console.log('♻️ Reintentando conexión a Deriv...');
  const newWs = new WebSocket('wss://ws.deriv.com/websockets/v3?app_id=1089');
  newWs.on('open', ws.listeners('open')[0]);
  newWs.on('message', ws.listeners('message')[0]);
  newWs.on('error', ws.listeners('error')[0]);
  newWs.on('close', ws.listeners('close')[0]);
}

// Ruta para ver la señal actual como JSON
app.get('/api/senal', (req, res) => {
  res.json(ultimaSenal);
});

// Ruta principal
app.get('/', (req, res) => {
  res.send('🔗 Proxy de señales de Deriv V75 activo');
});

app.listen(port, () => {
  console.log(`🚀 Servidor en http://localhost:${port}`);
});
