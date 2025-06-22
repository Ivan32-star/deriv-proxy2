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
};

let ultimaSenal = { mensaje: 'Aún no hay datos disponibles' };

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
      if (json.type === 'config' && json.granularity) {
        config.granularity = json.granularity;
        if (derivWs) {
          derivWs.removeAllListeners();
          derivWs.close();
          derivWs = null;
        }
        console.log('⚙️ Configuración actualizada:', config);
        ws.send(JSON.stringify({ type: 'config', status: 'ok', config }));
        conectarDeriv();
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
let reconectando = false;
let velas = [];
let historialSenales = [];

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

  // Algunos indicadores requieren más datos para ser válidos
  const rsi = technicalindicators.RSI.calculate({ values: closes, period: 14 });
  const sma20 = technicalindicators.SMA.calculate({ values: closes, period: 20 });
  const ema20 = technicalindicators.EMA.calculate({ values: closes, period: 20 });
  const macd = technicalindicators.MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false
  });
  const bb = technicalindicators.BollingerBands.calculate({
    period: 20,
    values: closes,
    stdDev: 2
  });
  const adx = technicalindicators.ADX.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14
  });
  const stochastic = technicalindicators.Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 14,
    signalPeriod: 3
  });

  return { rsi, sma20, ema20, macd, bb, adx, stochastic };
}

// Función que evalúa la señal combinando todos los indicadores
function evaluarSenal(indicadores) {
  if (velas.length < 50) return { decision: 'ESPERAR', razon: 'Datos insuficientes' };

  const ultimoClose = velas[velas.length - 1].close;

  // Tomar últimos valores de cada indicador (algunos pueden no tener datos si el historial es muy corto)
  const rsi = indicadores.rsi.slice(-1)[0];
  const sma20 = indicadores.sma20.slice(-1)[0];
  const ema20 = indicadores.ema20.slice(-1)[0];
  const macdObj = indicadores.macd.slice(-1)[0];
  const bbObj = indicadores.bb.slice(-1)[0];
  const adx = indicadores.adx.slice(-1)[0];
  const stochasticObj = indicadores.stochastic.slice(-1)[0];

  // Validar que existan los valores
  if ([rsi, sma20, ema20, macdObj, bbObj, adx, stochasticObj].some(v => v === undefined)) {
    return { decision: 'ESPERAR', razon: 'Indicadores incompletos' };
  }

  // Ejemplo de reglas combinadas:

  // RSI baja <30 (sobreventa) y cierre sobre SMA y EMA => posible compra
  const rsiSobreVenta = rsi < 30;
  const precioSobreMedias = ultimoClose > sma20 && ultimoClose > ema20;

  // MACD: el histograma positivo indica fuerza alcista
  const macdAlcista = macdObj.histogram > 0;

  // Bollinger: precio tocando banda inferior indica posible rebote alcista
  const precioEnBandaInferior = ultimoClose <= bbObj.lower;

  // ADX > 25 indica tendencia fuerte
  const tendenciaFuerte = adx.adx > 25;

  // Stochastic: %K cruzando %D hacia arriba indica compra
  const stochasticCompra = stochasticObj.k > stochasticObj.d && stochasticObj.k < 20;

  // Señal de COMPRA
  if (
    rsiSobreVenta &&
    precioSobreMedias &&
    macdAlcista &&
    (precioEnBandaInferior || stochasticCompra) &&
    tendenciaFuerte
  ) {
    return { decision: 'COMPRAR', razon: 'Condiciones técnicas alcistas fuertes detectadas' };
  }

  // Señal de VENTA (simétrico)
  const rsiSobreCompra = rsi > 70;
  const precioBajoMedias = ultimoClose < sma20 && ultimoClose < ema20;
  const macdBajista = macdObj.histogram < 0;
  const precioEnBandaSuperior = ultimoClose >= bbObj.upper;
  const stochasticVenta = stochasticObj.k < stochasticObj.d && stochasticObj.k > 80;

  if (
    rsiSobreCompra &&
    precioBajoMedias &&
    macdBajista &&
    (precioEnBandaSuperior || stochasticVenta) &&
    tendenciaFuerte
  ) {
    return { decision: 'VENDER', razon: 'Condiciones técnicas bajistas fuertes detectadas' };
  }

  return { decision: 'ESPERAR', razon: 'Condiciones no claras o mercado lateral' };
}

function guardarSenal(senal) {
  historialSenales.push(senal);
  if (historialSenales.length >= 20) {
    fs.writeFileSync('historialSenales.json', JSON.stringify(historialSenales, null, 2));
    historialSenales = [];
  }
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

    derivWs.send(JSON.stringify({
      ticks_history: 'R_75',
      adjust_start_time: 1,
      count: 150,
      end: 'latest',
      start: 1,
      style: 'candles',
      granularity: config.granularity,
      subscribe: 1,
    }));
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
          mensaje: `Señal: ${decision.decision} | Razón: ${decision.razon}`,
          indicadores: {
            rsi: indicadores.rsi.slice(-1)[0],
            sma20: indicadores.sma20.slice(-1)[0],
            ema20: indicadores.ema20.slice(-1)[0],
            macd_histogram: indicadores.macd.slice(-1)[0]?.histogram,
            bb_upper: indicadores.bb.slice(-1)[0]?.upper,
            bb_lower: indicadores.bb.slice(-1)[0]?.lower,
            adx: indicadores.adx.slice(-1)[0]?.adx,
            stochastic_k: indicadores.stochastic.slice(-1)[0]?.k,
            stochastic_d: indicadores.stochastic.slice(-1)[0]?.d,
          }
        };

        guardarSenal(ultimaSenal);

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

app.get('/', (req, res) => {
  res.send('🔗 Proxy y bot inteligente con múltiples indicadores para Deriv V75');
});
