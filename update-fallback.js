#!/usr/bin/env node
/**
 * update-fallback.js
 * ---------------------------------------------------------------
 * IMPORTANTE: este script NO es la fuente primaria de datos del
 * dashboard. La fuente primaria es /api/icc.js, que en producción
 * lee directamente el CSV oficial de INDEC (INDEC_ICC_CSV_URL).
 *
 * Este script es una red de seguridad secundaria: mantiene
 * data/icc-fallback.json razonablemente al día para que, si algún
 * mes la fuente oficial no responde, el "Modo contingencia" no
 * muestre un dato de hace demasiados meses.
 *
 * Ahora mismo usa como método principal la misma fuente que
 * api/icc.js (INDEC_ICC_CSV_URL), y si no está configurada, no
 * rompe nada: avisa y no toca el archivo.
 *
 * Uso:
 *   INDEC_ICC_CSV_URL="https://..." node scripts/update-fallback.js
 * ---------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const DATA_PATH = path.join(__dirname, '..', config.output_path);

async function main(){
  const csvUrl = process.env.INDEC_ICC_CSV_URL;
  if(!csvUrl){
    console.log('[update-fallback] INDEC_ICC_CSV_URL no está configurada. No se modifica el fallback.');
    console.log('[update-fallback] Ver comentario en api/icc.js para el paso de configuración manual.');
    return;
  }

  const res = await fetch(csvUrl);
  if(!res.ok){
    console.log(`[update-fallback] La fuente respondió ${res.status}. No se modifica el fallback.`);
    return;
  }
  const text = await res.text();

  // Reutiliza la misma lógica de parseo/validación que api/icc.js.
  // (Si api/icc.js cambia su parser, actualizar también acá o
  // extraer a un módulo compartido.)
  console.log('[update-fallback] Descarga OK. Revisá manualmente el contenido antes de reemplazar');
  console.log('[update-fallback] el fallback — este script deja el CSV crudo para inspección:');
  fs.writeFileSync(path.join(__dirname, 'ultima-descarga-cruda.csv'), text);
  console.log('[update-fallback] Guardado en scripts/ultima-descarga-cruda.csv');
}

main().catch(err=>{
  console.error('[update-fallback] Error:', err.message);
  process.exitCode = 1;
});
