const WebSocket = require('ws');
const https = require('https');
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// URL de WebSocket temporal para prueba (servidor de eco)
const DERIV_API_URL = 'wss://echo.websocket.events';

let ws;

app.use(cors());

let ultimaRespuesta = {
  mensaje: 'Aún no hay datos',
  rsi: null,
  adx: null,
  tendencia: null,
  precio: null,
  hora: null
};

const opcionesWS = {
  headers: {
    'User-Agent': 'Mozilla/5.0'
  },
  agent: new https.Agent({
    servername: 'echo.websocket.events',
    rejectUnauthorized: true
  })
};

function conectarDeriv() {
  ws = new WebSocket(DERIV_API_URL, opcionesWS);

  ws.on('open', () => {
    console.log('📡 Conectado a WebSocket de prueba (echo)');

    // Enviar mensaje de prueba al servidor de eco
    ws.send('Hola desde el proxy de prueba');
  });

  ws.on('message', (data) => {
    console.log('Mensaje recibido:', data);

    ultimaRespuesta = {
      ...ultimaRespuesta,
      mensaje: `Eco recibido: ${data}`,
      hora: new Date().toLocaleTimeString()
    };
  });

  ws.on('close', () => {
    console.log('🔁 Conexión cerrada. Reintentando en 5 segundos...');
    setTimeout(conectarDeriv, 5000);
  });

  ws.on('error', (err) => {
    console.error('❌ Error en WebSocket de prueba:', err.message);
  });
}

app.get('/', (req, res) => {
  res.send(`
    <h1>📈 Panel de Señales - Proxy de Prueba</h1>
    <p><strong>Mensaje:</strong> ${ultimaRespuesta.mensaje}</p>
    <p><strong>Hora:</strong> ${ultimaRespuesta.hora || '...'}</p>
  `);
});

app.get('/api/senal', (req, res) => {
  res.json(ultimaRespuesta);
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  conectarDeriv();
});
