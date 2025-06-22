const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 10000;

let mensajeRecibido = 'Aún no hay mensajes del WebSocket';

// Middleware
app.use(cors());

// Ruta principal
app.get('/', (req, res) => {
  res.send(`
    <h1>🔗 Proxy conectado</h1>
    <p><strong>Último mensaje del WebSocket:</strong> ${mensajeRecibido}</p>
    <p>Visita <code>/api/senal</code> para obtener los datos como JSON.</p>
  `);
});

// Ruta API
app.get('/api/senal', (req, res) => {
  res.json({ mensaje: mensajeRecibido });
});

// Iniciar WebSocket de prueba
function conectarWebSocket() {
  const ws = new WebSocket('wss://echo.websocket.events');

  ws.on('open', () => {
    console.log('📡 Conectado a WebSocket de prueba (echo)');
    ws.send('Hola desde el proxy de prueba');
  });

  ws.on('message', (data) => {
    const mensaje = data.toString();
    console.log('Mensaje recibido:', mensaje);
    mensajeRecibido = mensaje;
  });

  ws.on('close', () => {
    console.log('🔁 Conexión cerrada. Reintentando en 5 segundos...');
    setTimeout(conectarWebSocket, 5000);
  });

  ws.on('error', (err) => {
    console.error('❌ Error en WebSocket:', err.message);
  });
}

// Iniciar servidor y WebSocket
app.listen(PORT, () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  conectarWebSocket();
});
