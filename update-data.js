#!/usr/bin/env node
/**
 * update-data.js
 * ---------------------------------------------------------------
 * Actualiza data/icc-history.json con el último dato mensual del
 * ICC publicado por INDEC, vía la API de Series de Tiempo de
 * datos.gob.ar (apis.datos.gob.ar/series/api/series).
 *
 * INDEC publica el ICC como informe PDF mensual, no como API propia.
 * datos.gob.ar republica series oficiales (incluido el ICC) con IDs
 * estables aptos para consumo automático — ese es el camino que usa
 * este script. Los IDs concretos deben confirmarse una vez en
 * scripts/config.json (buscá "Índice del costo de la construcción"
 * en https://datos.gob.ar y copiá el id de cada serie).
 *
 * Modo de uso:
 *   node scripts/update-data.js
 *
 * Si los IDs en config.json siguen en "REEMPLAZAR_CON_ID_REAL", el
 * script no rompe: avisa por consola y sale sin tocar el archivo de
 * datos, para que puedas cargar el mes manualmente mientras tanto
 * (ver "Carga manual" más abajo).
 * ---------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const DATA_PATH = path.join(__dirname, '..', config.output_path);

async function fetchSeries(ids){
  const idList = Object.values(ids).join(',');
  const url = `https://apis.datos.gob.ar/series/api/series/?ids=${idList}:${config.representation_mode}&format=json&limit=1000`;
  const res = await fetch(url);
  if(!res.ok) throw new Error(`API respondió ${res.status}`);
  return res.json();
}

function idsConfigured(ids){
  return Object.values(ids).every(v => v && !v.startsWith('REEMPLAZAR'));
}

async function main(){
  if(!idsConfigured(config.series_ids)){
    console.log('[update-data] Los series_ids en scripts/config.json todavía son placeholders.');
    console.log('[update-data] Buscá los IDs reales en https://datos.gob.ar/dataset/sspm-indice-costo-construccion-icc');
    console.log('[update-data] y completá scripts/config.json. Mientras tanto, cargá el mes a mano en data/icc-history.json');
    console.log('[update-data] (ver sección "Carga manual" en el README). No se modificó ningún archivo.');
    process.exitCode = 0;
    return;
  }

  const json = await fetchSeries(config.series_ids);
  // La respuesta trae filas [fecha, nivel_general, materiales, mano_obra, gastos_generales]
  const rows = json.data;
  const current = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const existingPeriods = new Set(current.periodos.map(p => p.periodo));

  let added = 0;
  rows.forEach(row => {
    const periodo = row[0].slice(0,7); // "YYYY-MM"
    if(existingPeriods.has(periodo)) return;
    current.periodos.push({
      periodo,
      var_nivel_general: round(row[1]),
      var_materiales: round(row[2]),
      var_mano_obra: round(row[3]),
      var_gastos_generales: round(row[4]),
      fuente: 'INDEC'
    });
    added++;
  });

  current.periodos.sort((a,b)=> a.periodo.localeCompare(b.periodo));
  current.meta.ultima_actualizacion = new Date().toISOString().slice(0,10);

  fs.writeFileSync(DATA_PATH, JSON.stringify(current, null, 2));
  console.log(`[update-data] Listo. ${added} período(s) nuevo(s) agregado(s).`);
}

function round(n){
  return Math.round(n*100)/100;
}

main().catch(err => {
  console.error('[update-data] Error:', err.message);
  process.exitCode = 1;
});
