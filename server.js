const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const technicalindicators = require('technicalindicators');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());

let config = {
  granularity: 60,
  stake: 1,
  duration: 1,
  riskPercentage: 1, // % de balance a arriesgar por operación
  maxOperationsPerHour: 3,
};

let ultimaSenal = { mensaje: 'Aún no hay datos disponibles' };
let historialSenales = [];
let operacionesEjecutadas = [];
let operacionesUltimaHora = 0;

const server = app.listen(port, () => {
  console.log(`🚀 Servidor HTTP en http://localhost:${port}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  console.log('🔗 Cliente conectado al WebSocket interno');
  ws.send(JSON.stringify({ type: 'senal', data: ultimaSenal }));
  ws.on('message', msg => {
    try {
      const json = JSON.parse(msg);
      if (json.type === 'config') {
        config = { ...config, ...json };
        console.log('⚙️ Configuración actualizada:', config);
        ws.send(JSON.stringify({ type: 'config', status: 'ok', config }));
      }
    } catch (e) {
      console.error('❌ Mensaje no válido:', msg);
    }
  });
  ws.on('close', () => {
    console.log('🔌 Cliente desconectado');
  });
});

let derivWs = null;
let derivToken = 'ohmWKRLTRia4Ljq';
let velas = [];
let reconectando = false;

function actualizarVelas(nuevasVelas) {
  velas = velas.concat(nuevasVelas);
  if (velas.length > 150) {
    velas.splice(0, velas.length - 150);
  }
}

function calcularIndicadores() {
  const closes = velas.map(v => v.close);
  const highs = velas.map(v => v.high);
  const lows = velas.map(v => v.low);

  return {
    rsi: technicalindicators.RSI.calculate({ values: closes, period: 14 }),
    sma20: technicalindicators.SMA.calculate({ values: closes, period: 20 }),
    ema20: technicalindicators.EMA.calculate({ values: closes, period: 20 }),
    macd: technicalindicators.MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }),
    bb: technicalindicators.BollingerBands.calculate({ period: 20, values: closes, stdDev: 2 }),
    adx: technicalindicators.ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }),
    stochastic: technicalindicators.Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 })
  };
}

function evaluarSenal(ind) {
  if (velas.length < 50) return { decision: 'ESPERAR', razon: 'Datos insuficientes' };
  const c = velas[velas.length - 1].close;
  const rsi = ind.rsi.slice(-1)[0];
  const sma = ind.sma20.slice(-1)[0];
  const ema = ind.ema20.slice(-1)[0];
  const macd = ind.macd.slice(-1)[0];
  const bb = ind.bb.slice(-1)[0];
  const adx = ind.adx.slice(-1)[0];
  const st = ind.stochastic.slice(-1)[0];
  if ([rsi, sma, ema, macd, bb, adx, st].some(v => v === undefined)) return { decision: 'ESPERAR', razon: 'Indicadores incompletos' };
  const compra = rsi < 30 && c > sma && c > ema && macd.histogram > 0 && (c <= bb.lower || (st.k > st.d && st.k < 20)) && adx.adx > 25;
  const venta = rsi > 70 && c < sma && c < ema && macd.histogram < 0 && (c >= bb.upper || (st.k < st.d && st.k > 80)) && adx.adx > 25;
  if (compra) return { decision: 'COMPRAR', razon: 'Condiciones técnicas alcistas fuertes detectadas' };
  if (venta) return { decision: 'VENDER', razon: 'Condiciones técnicas bajistas fuertes detectadas' };
  return { decision: 'ESPERAR', razon: 'Condiciones no claras o mercado lateral' };
}

function guardarSenal(senal) {
  historialSenales.push(senal);
  if (historialSenales.length >= 20) {
    fs.writeFileSync('historialSenales.json', JSON.stringify(historialSenales, null, 2));
    historialSenales = [];
  }
}

function ejecutarOperacion(decision) {
  if (operacionesUltimaHora >= config.maxOperationsPerHour) return console.log('⛔ Límite de operaciones por hora alcanzado.');

  const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
  ws.on('open', () => {
    ws.send(JSON.stringify({ authorize: derivToken }));
  });

  ws.on('message', m => {
    const data = JSON.parse(m);
    if (data.msg_type === 'authorize') {
      const buyContract = {
        buy: 1,
        price: config.stake,
        parameters: {
          amount: config.stake,
          basis: 'stake',
          contract_type: decision === 'COMPRAR' ? 'CALL' : 'PUT',
          currency: 'USD',
          duration: config.duration,
          duration_unit: 'm',
          symbol: 'R_75',
        }
      };
      ws.send(JSON.stringify(buyContract));
    } else if (data.msg_type === 'buy') {
      console.log(`📈 Operación ejecutada: ${decision}`);
      operacionesEjecutadas.push({ decision, id: data.buy.transaction_id, time: new Date().toLocaleTimeString() });
      operacionesUltimaHora++;
      setTimeout(() => operacionesUltimaHora--, 60 * 60 * 1000);
    }
  });
}

function conectarDeriv() {
  if (derivWs) {
    derivWs.removeAllListeners();
    derivWs.close();
    derivWs = null;
  }
  derivWs = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
  derivWs.on('open', () => {
    console.log('📡 Conectado a WebSocket de Deriv');
    derivWs.send(JSON.stringify({ ticks_history: 'R_75', adjust_start_time: 1, count: 150, end: 'latest', start: 1, style: 'candles', granularity: config.granularity, subscribe: 1 }));
  });
  derivWs.on('message', data => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.candles && parsed.candles.length > 0) {
        actualizarVelas(parsed.candles);
        const indicadores = calcularIndicadores();
        const decision = evaluarSenal(indicadores);
        const ultimaVela = velas[velas.length - 1];
        const open = parseFloat(ultimaVela.open);
        const close = parseFloat(ultimaVela.close);
        ultimaSenal = {
          tiempo: new Date(ultimaVela.epoch * 1000).toLocaleString(),
          open,
          close,
          decision: decision.decision,
          razon: decision.razon,
          mensaje: `Señal: ${decision.decision} | Razón: ${decision.razon}`
        };
        guardarSenal(ultimaSenal);
        if (decision.decision === 'COMPRAR' || decision.decision === 'VENDER') {
          ejecutarOperacion(decision.decision);
        }
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'senal', data: ultimaSenal }));
          }
        });
        console.log(`📊 ${ultimaSenal.mensaje} - Apertura: ${open} | Cierre: ${close}`);
      }
    } catch (err) {
      console.error('❌ Error procesando datos:', err.message);
    }
  });
  derivWs.on('error', err => {
    console.error('❌ Error en WebSocket Deriv:', err.message);
  });
  derivWs.on('close', () => {
    console.log('🔁 Conexión cerrada. Reintentando en 5 segundos...');
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

app.get('/api/operaciones', (req, res) => {
  res.json(operacionesEjecutadas);
});

app.get('/', (req, res) => {
  res.send('🤖 Bot inteligente operando V75 en Deriv con indicadores técnicos y gestión de riesgo');
});
