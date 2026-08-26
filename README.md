# ICC Control Room

Dashboard de monitoreo del Índice del Costo de la Construcción (ICC, INDEC) con
motor de cortes de adecuación (5%), análisis de exposición y simulador de
impacto económico sobre contratos de obra.

## Qué incluye

```
icc-dashboard/
├── index.html                     ← el dashboard (abrilo directo en el navegador)
├── data/icc-history.json          ← serie mensual del ICC (esto es lo que se actualiza)
├── scripts/
│   ├── update-data.js             ← script que trae el último dato mensual
│   └── config.json                ← acá van los IDs de las series a consultar
└── .github/workflows/update-icc.yml  ← corre el script solo, todos los meses
```

El dashboard viene con datos reales del ICC (nivel general, materiales, mano de
obra, gastos generales) de diciembre 2025 a julio 2026, cargados a mano a partir
de los informes de prensa de INDEC. El período 2026-05 quedó marcado como
`"fuente": "estimado"` porque no pude confirmar el dato oficial exacto — conviene
reemplazarlo por el valor real de INDEC antes de usar el sistema para decisiones
contractuales.

## 1. Probarlo ya (sin instalar nada)

Abrí `index.html` con doble clic. Funciona offline: si no encuentra
`data/icc-history.json` (por ejemplo al abrirlo como archivo local sin
servidor), usa una copia de los mismos datos embebida en el propio HTML.

## 2. Publicarlo online (GitHub + Vercel)

1. Creá un repositorio nuevo en GitHub y subí esta carpeta completa.
2. Entrá a [vercel.com](https://vercel.com) → **Add New → Project** → elegí el
   repo. Como es HTML estático, no hace falta configurar build command ni
   output directory: dejalo todo por defecto y desplegá.
3. Listo — cada push a `main` actualiza el sitio automáticamente.

## 3. Automatizar la carga mensual del dato

INDEC publica el ICC como informe PDF, no tiene un endpoint JSON propio. El
camino de automatización que arma `scripts/update-data.js` es la **API de
Series de Tiempo** (`apis.datos.gob.ar/series/api/series`), que republica
series oficiales — entre ellas el ICC — con IDs estables aptos para consumir
por código.

**Paso único de configuración:**

1. Entrá a <https://datos.gob.ar/dataset/sspm-indice-costo-construccion-icc>
2. Anotá el ID de cada serie (nivel general, materiales, mano de obra, gastos
   generales).
3. Pegalos en `scripts/config.json`, reemplazando los `"REEMPLAZAR_CON_ID_REAL"`.

Con eso configurado, `.github/workflows/update-icc.yml` corre automáticamente
el día 20 de cada mes (día en que suele salir el informe de INDEC), trae el
dato nuevo, lo agrega a `data/icc-history.json` y lo commitea solo. También lo
podés disparar a mano desde la pestaña **Actions** del repo (botón *Run
workflow*).

**Mientras no configures los IDs:** el script no rompe nada — avisa por
consola y no toca el archivo de datos.

### Carga manual (mientras tanto, o si preferís no automatizar)

Editá `data/icc-history.json` y agregá un objeto al array `periodos`:

```json
{ "periodo": "2026-08", "var_nivel_general": 2.0, "var_materiales": 1.5, "var_mano_obra": 2.2, "var_gastos_generales": 2.0, "fuente": "INDEC" }
```

Los valores son las variaciones % mensuales que informa INDEC en el resumen
ejecutivo del informe de prensa del ICC (sección "Este resultado es
consecuencia de las alzas de X% en Materiales, Y% en Mano de obra...").

## 4. Cómo funciona el motor de cortes

- Toma el primer período de la serie como mes base (índice 100).
- Acumula la variación del nivel general mes a mes.
- Apenas la acumulada llega al umbral configurado (5% por defecto, ajustable
  en el simulador), registra un **corte de adecuación** y ese mes pasa a ser
  el nuevo mes base.
- Repite hasta el último dato cargado. Lo que queda acumulado desde el último
  corte es la **exposición actual** (pantalla 03).

## 5. El simulador (pantalla 04)

Dado un monto contractual, un mes base y un mes de análisis, corre el mismo
motor de cortes sobre ese rango y estima:
- cuántos cortes se hubieran disparado,
- el monto contractual ya ajustado por esos cortes,
- el **impacto económico** = la variación acumulada desde el último corte
  reconocido, aplicada sobre el monto ya ajustado — es decir, el descalce que
  todavía no se reconoció contractualmente.

## Notas

- Todo el cálculo corre en el navegador (sin backend). Es un único archivo
  HTML con JS vanilla — no depende de librerías externas, así que funciona
  también sin conexión a internet una vez cargado.
- Los gráficos son SVG generado a mano, sin CDN.
