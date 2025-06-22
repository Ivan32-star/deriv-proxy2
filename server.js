const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());

let config = {
  granularity: 60, // duración de vela en segundos
};

let ultimaSenal = { mensaje: 'Aún no hay datos' };

// Conexión WebSocket a Deriv (V75)
let derivWs;
function conectarDeriv() {
  derivWs = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');

  derivWs.on('open', () => {
    console.log('📡 Conectado a WebSocket de Deriv');

    derivWs.send(JSON.stringify({
      ticks_history: 'R_75',
      adjust_start_time: 1,
      count: 100,
      end: 'latest',
      start: 1,
      style: 'candles',
      granularity: config.granularity,
      subscribe: 1,
    }));
  });

  derivWs.on('message', data => {
    const parsed = JSON.parse(data);

    if (parsed.candles && parsed.candles.length > 0) {
      const ultimaVela = parsed.candles[parsed.candles.length - 1];

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

      // Notificar a clientes WebSocket conectados
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'senal', data: ultimaSenal }));
        }
      });

      console.log(`✅ Vela ${tendencia} - Open: ${open} | Close: ${close}`);
    }
  });

  derivWs.on('error', err => {
    console.error('❌ Error WebSocket Deriv:', err.message);
  });

  derivWs.on('close', () => {
    console.log('🔁 Conexión Deriv cerrada. Reintentando en 5 segundos...');
    setTimeout(conectarDeriv, 5000);
  });
}

conectarDeriv();

// Servidor Express
app.get('/api/senal', (req, res) => {
  res.json(ultimaSenal);
});

app.get('/', (req, res) => {
  res.send('🔗 Proxy y puerta trasera activa para Deriv V75');
});

const server = app.listen(port, () => {
  console.log(`🚀 Servidor HTTP en http://localhost:${port}`);
});

// Servidor WebSocket propio para clientes (tú y yo)
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  console.log('🔗 Cliente conectado al WebSocket interno');

  // Al conectar, enviamos la última señal
  ws.send(JSON.stringify({ type: 'senal', data: ultimaSenal }));

  // Recibir mensajes (para controlar/configurar)
  ws.on('message', msg => {
    try {
      const json = JSON.parse(msg);

      if (json.type === 'config' && json.granularity) {
        config.granularity = json.granularity;

        // Reiniciar conexión con Deriv con nuevo config
        if (derivWs) derivWs.close();

        console.log('⚙️ Configuración actualizada:', config);

        ws.send(JSON.stringify({ type: 'config', status: 'ok', config }));
      }
    } catch (e) {
      console.error('Mensaje no válido:', msg);
    }
  });

  ws.on('close', () => {
    console.log('🔌 Cliente desconectado');
  });
});
