// HU05: conectar la API del Banco Mundial para traer datos reales
// (antes usábamos data/countries.json como mock, HU04, para no depender
// de la API mientras se armaba el resto)

const WORLD_BANK_BASE = "https://api.worldbank.org/v2/country";

// Los 3 indicadores que pide HU03, con su código real en la API del Banco Mundial
const INDICATORS = [
  {
    code: "FI.RES.TOTL.CD",
    label: "Reservas internacionales (USD)",
    format: (v) => `US$ ${new Intl.NumberFormat("es-AR").format(Math.round(v))}`,
  },
  {
    code: "FP.CPI.TOTL.ZG",
    label: "Inflación anual (%)",
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    code: "SP.POP.TOTL",
    label: "Población",
    format: (v) => new Intl.NumberFormat("es-AR").format(Math.round(v)),
  },
];

// MIDP-21 / MIDP-22: "datos profundos" que solo se ven con sesión
// iniciada (login real con Firebase, en auth.js).
const ADVANCED_INDICATORS = [
  {
    code: "NY.GDP.MKTP.CD",
    label: "PBI total (USD)",
    format: (v) => `US$ ${new Intl.NumberFormat("es-AR").format(Math.round(v))}`,
  },
  {
    code: "SL.UEM.TOTL.ZS",
    label: "Desempleo (%)",
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    code: "SP.DYN.LE00.IN",
    label: "Esperanza de vida (años)",
    format: (v) => `${v.toFixed(1)} años`,
  },
  {
    code: "SE.ADT.LITR.ZS",
    label: "Tasa de alfabetización (%)",
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    code: "SH.XPD.CHEX.GD.ZS",
    label: "Gasto en salud (% del PBI)",
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    code: "AG.SRF.TOTL.K2",
    label: "Superficie (km²)",
    format: (v) => `${new Intl.NumberFormat("es-AR").format(Math.round(v))} km²`,
  },
  {
    code: "EN.POP.DNST",
    label: "Densidad poblacional (hab/km²)",
    format: (v) => `${v.toFixed(1)} hab/km²`,
  },
];

let activePath = null;
let datosRespaldo = null; // countries.json (HU04), se usa solo si falla la API real

// MIDP-21/22: el panel de datos avanzados va del lado izquierdo, debajo
// del mapa. En vez de agregarlo a mano en index.html, lo creamos acá con
// JavaScript la primera vez que hace falta (insertAdjacentElement, "insert
// adjacent element", pronunciado "ínsert adyéisent élement", significa
// "insertar un elemento al lado de otro" que ya existe en la página).
function ensureAdvancedPanel() {
  let panel = document.getElementById("advanced-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "advanced-panel";
    panel.className = "advanced-panel";
    panel.innerHTML = `
      <div class="locked-msg">
        Elegí un país en el mapa para ver acá los datos avanzados
        (necesitás tener sesión iniciada).
      </div>`;
    const mapPanel = document.querySelector(".map-panel");
    mapPanel.insertAdjacentElement("afterend", panel);
  }
  return panel;
}

async function cargarRespaldo() {
  if (datosRespaldo) return datosRespaldo; // ya lo cargamos antes, no repetir
  try {
    const res = await fetch("data/countries.json");
    if (!res.ok) throw new Error(`HTTP ${res.status} al pedir data/countries.json`);
    datosRespaldo = await res.json();
  } catch (err) {
    console.error("No se pudo cargar el respaldo data/countries.json:", err);
    datosRespaldo = {};
  }
  return datosRespaldo;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// La API del Banco Mundial a veces falla de forma intermitente (corta la
// respuesta sin la cabecera de CORS, o tarda demasiado bajo carga), sobre
// todo cuando le mandamos varios pedidos en paralelo. Por eso reintentamos
// automáticamente hasta 2 veces antes de darnos por vencidos, esperando
// un poco más cada vez (backoff, pronunciado "bák-of", significa "espera
// creciente entre reintentos").
//
// Versión general: pide una SERIE de valores (mrv = cuántos años pedís,
// del más nuevo al más viejo, "most recent values" — pronunciado "moust
// ricent vállius", significa "valores más recientes"). La usamos con
// mrv=1 para "el dato actual" y con mrv=10 para el histórico (MIDP-21/22).
async function fetchIndicatorSerie(isoCode, indicatorCode, mrv = 1, intentos = 2) {
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      const url = `${WORLD_BANK_BASE}/${isoCode}/indicator/${indicatorCode}?format=json&mrv=${mrv}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();
      // La API devuelve [metadata, datos]. Si el país no existe para la API,
      // datos puede venir undefined.
      const datos = json[1];
      if (!datos || datos.length === 0) return [];

      // La API los devuelve del año más nuevo al más viejo; los damos
      // vuelta para mostrar el histórico en orden cronológico. Además
      // sacamos los años sin dato (value: null).
      return datos
        .filter((d) => d.value !== null)
        .map((d) => ({ valor: d.value, anio: d.date }))
        .reverse();
    } catch (err) {
      const esUltimoIntento = intento === intentos;
      if (esUltimoIntento) throw err;
      await esperar(intento * 1000); // 1s antes de reintentar
    }
  }
}

// Pide UN indicador para UN país (el dato más reciente disponible).
async function fetchIndicator(isoCode, indicatorCode) {
  const serie = await fetchIndicatorSerie(isoCode, indicatorCode, 1);
  if (serie.length === 0) return null;
  return serie[0];
}

// Antes pedíamos los 3 indicadores en paralelo con Promise.all, pero eso
// manda 3 pedidos al mismo tiempo y parece disparar más seguido los
// bloqueos de la API pública bajo carga. Ahora los pedimos uno detrás
// del otro (secuencial): tarda un poquito más, pero es más confiable.
async function fetchCountryData(isoCode) {
  const resultados = [];
  for (const ind of INDICATORS) {
    const r = await fetchIndicator(isoCode, ind.code);
    resultados.push(r);
  }
  return resultados;
}

function renderLoading(name, code) {
  const panel = document.getElementById("data-panel");
  panel.innerHTML = `
    <p class="country-code">${code}</p>
    <h2 class="country-name">${name}</h2>
    <div class="no-data-msg">Cargando datos desde el Banco Mundial...</div>
  `;
  const avanzadoPanel = ensureAdvancedPanel();
  avanzadoPanel.innerHTML = `<div class="no-data-msg">Cargando...</div>`;
}

// resultados: los 3 datos básicos (array paralelo a INDICATORS)
// historicos: null si no hay sesión iniciada, o array paralelo a
//   INDICATORS con la serie de hasta 10 años de cada uno
// avanzados: null si no hay sesión iniciada, o array paralelo a
//   ADVANCED_INDICATORS con el dato más reciente de cada uno
function renderCountry(name, code, resultados, historicos, avanzados) {
  const panel = document.getElementById("data-panel");

  const stats = INDICATORS.map((ind, i) => {
    const r = resultados[i];
    const valorMostrado =
      r && r.valor !== null ? `${ind.format(r.valor)} <span class="stat-year">(${r.anio})</span>` : "Sin datos disponibles";

    const serie = historicos ? historicos[i] : null;
    const historialHtml =
      serie && serie.length > 0
        ? `<details class="historial">
             <summary>Ver últimos ${serie.length} años</summary>
             <ul class="historial-list">
               ${serie.map((h) => `<li><span>${h.anio}</span><span>${ind.format(h.valor)}</span></li>`).join("")}
             </ul>
           </details>`
        : "";

    return `
      <div class="stat">
        <div class="stat-label">${ind.label}</div>
        <div class="stat-value">${valorMostrado}</div>
        ${historialHtml}
      </div>`;
  }).join("");

  panel.innerHTML = `
    <p class="country-code">${code}</p>
    <h2 class="country-name">${name}</h2>
    <div class="stat-list">${stats}</div>
  `;

  // MIDP-21/22: los datos avanzados van en el panel de la izquierda,
  // debajo del mapa (no acá, en el panel de la derecha).
  const avanzadoPanel = ensureAdvancedPanel();
  if (avanzados) {
    const avanzadosHtml = ADVANCED_INDICATORS.map((ind, i) => {
      const r = avanzados[i];
      const valorMostrado =
        r && r.valor !== null ? `${ind.format(r.valor)} <span class="stat-year">(${r.anio})</span>` : "Sin datos disponibles";
      return `
        <div class="stat">
          <div class="stat-label">${ind.label}</div>
          <div class="stat-value">${valorMostrado}</div>
        </div>`;
    }).join("");
    avanzadoPanel.innerHTML = `
      <p class="section-label">Datos avanzados de ${name} (usuario registrado)</p>
      <div class="stat-list">${avanzadosHtml}</div>`;
  } else {
    avanzadoPanel.innerHTML = `
      <div class="locked-msg">
        Iniciá sesión para ver PBI total, desempleo, esperanza de vida,
        alfabetización, gasto en salud, superficie, densidad poblacional
        y el histórico de los últimos 10 años de cada dato.
      </div>`;
  }
}

function renderCountryRespaldo(name, code, datos) {
  const panel = document.getElementById("data-panel");
  panel.innerHTML = `
    <p class="country-code">${code}</p>
    <h2 class="country-name">${datos.name || name}</h2>
    <div class="no-data-msg">
      La API del Banco Mundial no respondió. Mostrando datos de prueba
      (HU04) en su lugar.
    </div>
    <div class="stat-list">
      <div class="stat">
        <div class="stat-label">Reservas internacionales (USD millones)</div>
        <div class="stat-value">${new Intl.NumberFormat("es-AR").format(datos.reservas_usd_millones)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Inflación anual (%)</div>
        <div class="stat-value">${datos.inflacion_anual_pct}%</div>
      </div>
      <div class="stat">
        <div class="stat-label">Población (millones)</div>
        <div class="stat-value">${datos.poblacion_millones}</div>
      </div>
    </div>
  `;
  const avanzadoPanel = ensureAdvancedPanel();
  avanzadoPanel.innerHTML = `
    <div class="no-data-msg">
      No se pudieron pedir los datos avanzados porque la API no respondió.
    </div>`;
}

function renderError(name, code, path) {
  const panel = document.getElementById("data-panel");
  panel.innerHTML = `
    <p class="country-code">${code}</p>
    <h2 class="country-name">${name}</h2>
    <div class="no-data-msg">
      No se pudo conectar con la API del Banco Mundial para este país
      (aun después de reintentar). Puede ser un problema pasajero del
      servidor del Banco Mundial.
    </div>
    <button id="retry-btn" class="retry-btn">Reintentar</button>
  `;
  document.getElementById("retry-btn").addEventListener("click", () => {
    onCountryClick({ currentTarget: path });
  });
  const avanzadoPanel = ensureAdvancedPanel();
  avanzadoPanel.innerHTML = `
    <div class="no-data-msg">
      No se pudieron pedir los datos avanzados porque la API no respondió.
    </div>`;
}

async function onCountryClick(evt) {
  const path = evt.currentTarget;
  const code = path.dataset.id;
  const name = path.dataset.name || code;

  if (activePath) activePath.classList.remove("active");
  path.classList.add("active");
  activePath = path;

  renderLoading(name, code);

  try {
    const resultados = await fetchCountryData(code);

    // window.usuarioLogueado lo actualiza auth.js cada vez que Firebase
    // detecta que alguien inició o cerró sesión.
    let historicos = null;
    let avanzados = null;
    if (window.usuarioLogueado) {
      historicos = [];
      for (const ind of INDICATORS) {
        historicos.push(await fetchIndicatorSerie(code, ind.code, 10));
      }
      avanzados = [];
      for (const ind of ADVANCED_INDICATORS) {
        avanzados.push(await fetchIndicator(code, ind.code));
      }
    }

    renderCountry(name, code, resultados, historicos, avanzados);
  } catch (err) {
    console.error(err);
    const respaldo = await cargarRespaldo();
    if (respaldo[code]) {
      renderCountryRespaldo(name, code, respaldo[code]);
    } else {
      renderError(name, code, path);
    }
  }
}

function wireMapEvents() {
  document.querySelectorAll(".country").forEach((path) => {
    path.addEventListener("click", onCountryClick);
  });
  ensureAdvancedPanel();
}

document.addEventListener("DOMContentLoaded", wireMapEvents);

// Cuando alguien inicia o cierra sesión (evento disparado por auth.js),
// si ya había un país seleccionado, lo volvemos a cargar para que
// aparezcan/desaparezcan los datos avanzados sin tener que reclickear.
window.addEventListener("authchange", () => {
  if (activePath) onCountryClick({ currentTarget: activePath });
});