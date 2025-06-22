const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());

let config = {
  granularity: 60, // duración de la vela en segundos (1 minuto)
};

let ultimaSenal = { mensaje: 'Aún no hay datos' };

// Servidor HTTP
const server = app.listen(port, () => {
  console.log(`🚀 Servidor HTTP en http://localhost:${port}`);
});

// Servidor WebSocket propio para clientes (tú y yo)
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  console.log('🔗 Cliente conectado al WebSocket interno');

  // Enviar última señal al conectar
  ws.send(JSON.stringify({ type: 'senal', data: ultimaSenal }));

  ws.on('message', msg => {
    try {
      const json = JSON.parse(msg);

      if (json.type === 'config' && json.granularity) {
        config.granularity = json.granularity;

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

let derivWs;
let reconectando = false;

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

      if (wss && wss.clients.size > 0) {
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'senal', data: ultimaSenal }));
          }
        });
      }

      console.log(`✅ Vela ${tendencia} - Open: ${open} | Close: ${close}`);
    }
  });

  derivWs.on('error', err => {
    console.error('❌ Error WebSocket Deriv:', err.message);
  });

  derivWs.on('close', () => {
    console.log('🔁 Conexión Deriv cerrada. Reintentando en 5 segundos...');
    if (!reconectando) {
      reconectando = true;
      setTimeout(() => {
        reconectando = false;
        conectarDeriv();
      }, 5000);
    }
  });
}

conectarDeriv();

app.get('/api/senal', (req, res) => {
  res.json(ultimaSenal);
});

app.get('/', (req, res) => {
  res.send('🔗 Proxy y puerta trasera activa para Deriv V75');
});
