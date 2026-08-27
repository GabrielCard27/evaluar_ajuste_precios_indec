# ICC Control Room — V2

Monitor de Adecuación Contractual basado en el Índice del Costo de la Construcción (ICC, INDEC).

## Estructura de archivos

```
icc-v2/
├── index.html                        ← dashboard (mismo diseño y navegación de la V1)
├── api/
│   └── icc.js                        ← función serverless: obtiene y valida el dato oficial
├── data/
│   └── icc-fallback.json             ← fallback local, EXPLÍCITAMENTE marcado como contingencia
├── scripts/
│   ├── config.json
│   └── update-fallback.js            ← red de seguridad secundaria (no es la fuente primaria)
├── .github/workflows/update-icc.yml  ← chequeo mensual, deja el CSV crudo para revisión humana
├── vercel.json
└── README.md
```

---

## 1. Qué cambié respecto a la V1

- **Arquitectura de datos**: antes el HTML tenía los datos cargados a mano y reconstruía un
  índice sintético base 100. Ahora hay una función serverless (`api/icc.js`) que es la fuente
  primaria, y el archivo local pasó a ser explícitamente un **fallback de contingencia**, nunca
  la fuente "normal".
- **Motor de cálculo**: separado en funciones independientes (`getICCData`, `validateICCData`,
  `normalizeICCData`, `calculateVariation`, `detectAdjustmentCuts`, `calculateExposure`,
  `runSimulator`, `renderDashboard`/render por pantalla), en vez de una única función monolítica.
- **Últimos 12 meses**: el Monitor ahora calcula automáticamente la ventana de 12 meses a partir
  del último dato disponible — no hay ningún rango escrito a mano.
- **Estados de proximidad al corte** (verde/amarillo/naranja/rojo) en el módulo de Cortes,
  calculados por distancia real al umbral, no por color fijo.
- **Renombrado conceptual** (sección 8 y 9 de tu pedido): "descalce económico-financiero" pasó a
  llamarse **"exposición económica estimada"** (simulador) y **"brecha de actualización"**
  (pestaña 05), con las advertencias metodológicas que pediste.
- **Trazabilidad de origen del dato**: cada período queda etiquetado (`oficial_indice`,
  `oficial_variacion` o `estimado`), visible en la tabla del Monitor. El dato de mayo-2026 sigue
  marcado `estimado` — nunca se muestra como si fuera INDEC.
- **Validaciones de calidad** (`validateICCData` + validación server-side en `api/icc.js`): sin
  duplicados, orden cronológico, sin nulos, sin saltos inexplicables (>40% en un mes aborta la
  carga en vez de propagar un posible error de parseo).
- **Aviso de contingencia visible**: si el dashboard usa el fallback, aparece un banner
  "Modo contingencia — datos locales" con el período de esos datos. Nunca queda implícito.

Lo que **no toqué**: diseño visual, paleta de colores, navegación por pestañas, estructura de
5 pantallas, estilo general "control room".

---

## 2. Cómo se obtiene el dato del ICC (y una limitación técnica real)

Investigué antes de escribir una sola línea de `fetch`, como pediste. Esto es lo que encontré:

- INDEC **no publica el ICC como API JSON**. Lo publica como informe de prensa en PDF cada mes.
- Cada informe de prensa cita, como fuente oficial de series históricas:
  `https://www.indec.gob.ar/indec/web/Nivel4-Tema-3-5-33` — confirmé que esta URL es real y está
  citada en informes oficiales hasta junio de 2026 (no es un endpoint inventado).
- **El problema**: esa página arma el link de descarga del `.csv` con JavaScript del lado del
  cliente. Mi herramienta de lectura web no ejecuta JavaScript de navegador, así que puedo
  confirmar que la página existe y es la fuente correcta, pero no puedo extraer por mi cuenta la
  URL final del archivo `.csv` — necesita que una persona la abra en un navegador una vez.

Por eso `api/icc.js` está armado así:

1. Lee una variable de entorno `INDEC_ICC_CSV_URL` (configurada en Vercel).
2. Si no está configurada, **no inventa nada**: devuelve `ok:false` con un mensaje explícito, y el
   frontend pasa a modo contingencia mostrando el aviso correspondiente.
3. Si está configurada, descarga el CSV, lo valida (columnas, fechas, saltos raros) y lo sirve
   como JSON al dashboard.

### Paso único que falta de tu lado

1. Abrí `https://www.indec.gob.ar/indec/web/Nivel4-Tema-3-5-33` en un navegador.
2. Buscá el enlace de descarga del `.csv` de "Índice del costo de la construcción — Nivel general
   y capítulos".
3. Copiá esa URL (termina en `.csv`) y cargala en Vercel como variable de entorno
   `INDEC_ICC_CSV_URL` (Project Settings → Environment Variables).

Con eso configurado, el dashboard pasa a modo "oficial" solo. Mientras tanto, funciona igual mostrando el fallback y avisando que está en contingencia.

**Alternativa evaluada y descartada por ahora**: la API de Series de Tiempo de datos.gob.ar
(`apis.datos.gob.ar/series/api/series`) republica series oficiales con IDs estables — es un buen
camino en general, pero no pude confirmar el/los ID(s) de serie exactos del ICC nacional en esta
sesión. Dejé el lugar preparado en `scripts/config.json` (`series_ids_datos_gob_ar`, marcado
`NO_CONFIRMADO`) por si querés confirmarlos vos y sumarlos como fuente alternativa más adelante.

---

## 3. Fórmula utilizada

```
Variación = ((Índice actual / Índice base) - 1) × 100
```

Se aplica siempre sobre **números índice**, nunca sumando variaciones porcentuales mensuales
(eso fue un error deliberadamente evitado: sumar 2,1% + 3,7% + 4,8% no da lo mismo que la
variación acumulada real de encadenar esos tres meses multiplicativamente).

Cuando la fuente primaria entrega el número índice oficial (base 1993=100), se usa directamente.
Cuando se cae a contingencia con variaciones mensuales, se reconstruye un índice encadenado
(`idxG *= (1 + var/100)` mes a mes) — y ese origen queda marcado como `oficial_variacion` o
`estimado`, nunca confundido con el índice absoluto real de INDEC.

---

## 4. Cómo detecta los cortes del 5%

`detectAdjustmentCuts(series, thresholdPct)`:

1. Toma el primer período de la serie (o el mes base que elijas en el Simulador) como referencia.
2. Recorre los períodos siguientes calculando la variación acumulada respecto de esa referencia
   (con la fórmula de arriba, sobre índices).
3. En cuanto esa variación acumulada llega o supera el umbral (5% por defecto), registra un corte
   con: número de corte, período, índice base, índice del corte, variación acumulada y meses
   transcurridos desde el corte anterior.
4. Ese período pasa a ser la nueva referencia y se repite hasta el último dato disponible.

---

## 5. Cómo calcula los meses de exposición

`calculateExposure(series, thresholdPct)` toma el último corte registrado (o el mes base si
todavía no hubo cortes) y cuenta cuántos períodos pasaron hasta el último dato disponible. Con
esos dos puntos calcula también la variación acumulada actual y la distancia en puntos
porcentuales al umbral (`umbral - variación acumulada`). Además agrega estadísticas del recorrido
completo: cantidad total de cortes, y promedio/máximo/mínimo de meses entre cortes.

---

## 6. Diferencia entre "Exposición económica estimada" y "Brecha de actualización"

- **Exposición económica estimada** (Simulador, pestaña 04): aplica la variación acumulada desde
  el último corte sobre el **monto contractual que vos ingresás**, ya ajustado por los cortes
  simulados. Es una estimación teórica puntual para un contrato hipotético — depende enteramente
  del monto que cargues.
- **Brecha de actualización** (pestaña 05): compara la evolución del **índice ICC** contra una
  actualización contractual simulada (ajustada en cada corte del 5%), ambas normalizadas a 100.
  No depende de ningún monto — es una comparación de curvas, no un cálculo monetario.

Ninguna de las dos es, por sí misma, un "descalce económico-financiero real": para eso hace falta
incorporar avance físico, certificación, monto ejecutado, adecuaciones ya reconocidas y saldo
contractual pendiente — ver la sección "Preparado para v3" dentro del dashboard (pestaña 05).

---

## 7. Instrucciones para desplegar en Vercel

1. Subí esta carpeta completa (los 8 archivos/carpetas de la estructura de arriba, incluyendo
   `.github` que es una carpeta oculta) a tu repo de GitHub — podés reemplazar el contenido del
   repo `evaluar_ajuste_precios_indec` que ya tenías conectado.
2. En Vercel, el proyecto ya está importado — solo hace falta un **redeploy** (Vercel lo dispara
   solo al detectar el push a `main`).
3. Para activar el modo "oficial": Project Settings → Environment Variables → agregá
   `INDEC_ICC_CSV_URL` con el valor que consigas siguiendo el paso de la sección 2. Volvé a
   desplegar (Redeploy) para que la función serverless la lea.
4. Sin esa variable, el sitio funciona igual, en modo contingencia, con el aviso correspondiente.

---

## Nota sobre prioridades

Como pediste, prioricé exactitud de datos y lógica de cálculo por sobre completar la
automatización a como dé lugar. Preferí dejar un paso de configuración manual (una sola vez, no
mensual) y ser explícito sobre la limitación técnica, antes que inventar un endpoint o asumir una
estructura de CSV que no pude verificar en esta sesión.
