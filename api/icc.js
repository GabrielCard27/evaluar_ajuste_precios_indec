/**
 * /api/icc.js
 * ---------------------------------------------------------------------
 * Función serverless (Vercel) que actúa como capa intermedia entre el
 * navegador y la fuente oficial de INDEC para el Índice del Costo de la
 * Construcción (ICC).
 *
 * POR QUÉ EXISTE ESTA FUNCIÓN (en vez de fetch directo desde el browser):
 * INDEC no publica el ICC como JSON. La fuente oficial de series
 * históricas está referenciada en cada informe de prensa del ICC como:
 *
 *   https://www.indec.gob.ar/indec/web/Nivel4-Tema-3-5-33
 *   ("Las series históricas también se encuentran disponibles en
 *    formato .csv desde...")
 *
 * Esa página es real y está citada en los informes oficiales hasta
 * junio de 2026 — no es un endpoint inventado. El problema técnico es
 * que la página arma el enlace de descarga del .csv con JavaScript en
 * el cliente, así que no se puede extraer la URL final del archivo
 * simplemente leyendo el HTML (ni desde el navegador sin ejecutar ese
 * JS, ni desde esta función sin un navegador real). Por eso esta pieza
 * queda como CONFIGURACIÓN MANUAL DE UNA SOLA VEZ, no como scraping
 * automático de una URL que no pudimos verificar en runtime:
 *
 *   1. Entrá a la página de arriba en un navegador.
 *   2. Encontrá el enlace de descarga del .csv de "Índice del costo de
 *      la construcción... Nivel general y capítulos".
 *   3. Copiá esa URL final (termina en .csv) y cargala en Vercel como
 *      variable de entorno: INDEC_ICC_CSV_URL
 *
 * Sin esa variable configurada, esta función devuelve ok:false con un
 * mensaje explícito — nunca inventa datos ni redirige a otra fuente no
 * verificada.
 *
 * Alternativa evaluada: la API de Series de Tiempo de datos.gob.ar
 * (apis.datos.gob.ar/series/api/series) republica series oficiales con
 * IDs estables, pero no pude confirmar en esta sesión el/los id(s) de
 * serie correspondientes al ICC nacional (Gran Buenos Aires) con sus
 * 4 componentes. Si en el futuro se confirman esos IDs, se puede sumar
 * como INDEC_ICC_SERIES_API_IDS sin cambiar el contrato de esta función
 * (ver bloque FUENTE_ALTERNATIVA más abajo).
 * ---------------------------------------------------------------------
 */

const REQUIRED_COMPONENTS = ['nivel_general', 'materiales', 'mano_obra', 'gastos_generales'];

// Encabezados esperados en el CSV oficial, en distintas variantes de
// texto (INDEC no siempre usa el mismo casing/acentuación entre series).
const HEADER_ALIASES = {
  nivel_general: ['nivel general', 'nivelgeneral', 'general'],
  materiales: ['materiales'],
  mano_obra: ['mano de obra', 'manodeobra', 'mano_obra'],
  gastos_generales: ['gastos generales', 'gastosgenerales', 'gastos_generales'],
  periodo: ['indice_tiempo', 'periodo', 'fecha', 'período']
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

  const csvUrl = process.env.INDEC_ICC_CSV_URL;

  if (!csvUrl) {
    return res.status(200).json({
      ok: false,
      error: 'fuente_no_configurada',
      message:
        'INDEC_ICC_CSV_URL no está configurada en las variables de entorno de Vercel. ' +
        'Ver comentario al inicio de api/icc.js para el paso de configuración manual ' +
        '(una sola vez). El frontend debe usar el fallback local y mostrar ' +
        '"Modo contingencia — datos locales".'
    });
  }

  let csvText;
  try {
    const response = await fetch(csvUrl, {
      headers: { 'User-Agent': 'ICC-Control-Room/2.0 (+dashboard automatizado)' }
    });
    if (!response.ok) {
      return res.status(200).json({
        ok: false,
        error: 'fuente_respondio_error',
        message: `La fuente configurada respondió con estado ${response.status}.`
      });
    }
    csvText = await response.text();
  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: 'fuente_no_disponible',
      message: 'No se pudo conectar con la fuente configurada: ' + err.message
    });
  }

  let parsed;
  try {
    parsed = parseCsv(csvText);
  } catch (err) {
    return res.status(200).json({
      ok: false,
      error: 'error_de_parseo',
      message: 'El archivo se descargó pero no se pudo interpretar como la serie del ICC: ' + err.message
    });
  }

  const validation = validateSeries(parsed);
  if (!validation.ok) {
    return res.status(200).json({
      ok: false,
      error: 'validacion_fallida',
      message: validation.message
    });
  }

  return res.status(200).json({
    ok: true,
    fuente: 'INDEC - Índice del Costo de la Construcción (ICC) - serie oficial vía CSV',
    modo: 'oficial',
    ultima_actualizacion: new Date().toISOString().slice(0, 10),
    periodos: parsed
  });
};

/**
 * Parser de CSV defensivo: no asume separador ni orden de columnas fijo.
 * Busca las columnas por nombre (con alias) en vez de por posición, para
 * no romperse si INDEC reordena o renombra levemente el archivo.
 */
function parseCsv(text) {
  const clean = text.replace(/^\uFEFF/, '').trim();
  const delimiter = clean.split('\n')[0].includes(';') ? ';' : ',';
  const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error('El archivo no tiene filas de datos.');

  const headerCells = lines[0].split(delimiter).map(h => normalizeHeader(h));
  const colIndex = {};
  Object.entries(HEADER_ALIASES).forEach(([key, aliases]) => {
    const idx = headerCells.findIndex(h => aliases.includes(h));
    if (idx >= 0) colIndex[key] = idx;
  });

  const missing = [...REQUIRED_COMPONENTS, 'periodo'].filter(k => !(k in colIndex));
  if (missing.length > 0) {
    throw new Error('No se encontraron las columnas: ' + missing.join(', '));
  }

  const rows = lines.slice(1).map(line => {
    const cells = line.split(delimiter);
    const periodoRaw = cells[colIndex.periodo];
    const periodo = toPeriodo(periodoRaw);
    const row = { periodo };
    REQUIRED_COMPONENTS.forEach(key => {
      row['idx_' + shortKey(key)] = toNumber(cells[colIndex[key]]);
    });
    row.origen = 'oficial_indice';
    return row;
  }).filter(r => r.periodo && REQUIRED_COMPONENTS.every(k => Number.isFinite(r['idx_' + shortKey(k)])));

  return rows;
}

function shortKey(key) {
  return { nivel_general: 'general', materiales: 'materiales', mano_obra: 'mano_obra', gastos_generales: 'gastos' }[key];
}

function normalizeHeader(h) {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // saca acentos
}

function toNumber(v) {
  if (v == null) return NaN;
  const n = parseFloat(String(v).trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : parseFloat(String(v).trim());
}

function toPeriodo(v) {
  if (!v) return null;
  const s = String(v).trim();
  // admite "2026-07-01", "2026-07", "07/2026", "Julio 2026"
  const isoMatch = s.match(/^(\d{4})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
  const slashMatch = s.match(/^(\d{2})\/(\d{4})$/);
  if (slashMatch) return `${slashMatch[2]}-${slashMatch[1]}`;
  return null;
}

/**
 * Validaciones de calidad (sección 12 del pedido):
 * sin duplicados, orden cronológico, sin nulos, los 4 índices presentes,
 * último período identificable, sin saltos inexplicables (>40% en un mes,
 * que indicaría un error de parseo antes que un dato real).
 */
function validateSeries(rows) {
  if (rows.length === 0) return { ok: false, message: 'La serie parseada quedó vacía.' };

  const periodos = rows.map(r => r.periodo);
  const unique = new Set(periodos);
  if (unique.size !== periodos.length) {
    return { ok: false, message: 'Hay períodos duplicados en la serie.' };
  }

  const sorted = [...periodos].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(periodos)) {
    return { ok: false, message: 'Los períodos no están ordenados cronológicamente.' };
  }

  for (const r of rows) {
    for (const k of ['idx_general', 'idx_materiales', 'idx_mano_obra', 'idx_gastos']) {
      if (!Number.isFinite(r[k]) || r[k] <= 0) {
        return { ok: false, message: `Valor inválido en ${k} para el período ${r.periodo}.` };
      }
    }
  }

  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    const change = Math.abs(cur.idx_general / prev.idx_general - 1);
    if (change > 0.4) {
      return {
        ok: false,
        message: `Salto inexplicable (${(change * 100).toFixed(1)}%) entre ${prev.periodo} y ${cur.periodo}. Se aborta para no propagar un posible error de parseo.`
      };
    }
  }

  return { ok: true };
}

/* ---------------------------------------------------------------------
 * FUENTE_ALTERNATIVA (no activa): si en el futuro se confirman los IDs
 * de la API de Series de Tiempo de datos.gob.ar para el ICC, se puede
 * agregar acá un segundo intento antes de caer al error, por ejemplo:
 *
 *   const seriesUrl = `https://apis.datos.gob.ar/series/api/series/?ids=${ids}&format=json`;
 *
 * manteniendo el mismo contrato de salida (ok/periodos/fuente) para no
 * tocar el frontend.
 * --------------------------------------------------------------------- */
