// ============================================================================
// MICRO-AGENTI (2 chiamate: quota + suolo della località richiesta)
// ============================================================================
// Girano a ogni richiesta perché i dati numerici cambiano nell'arco della
// giornata, mentre il bollettino ufficiale no (quello sta in cache).
//
// Quota: 2 chiamate qui + 1 dell'Agente Capo = 3 per bollettino, tutte su
// Flash Lite (500 richieste/giorno) -> ~166 bollettini. 3.7 Flash, che si
// ferma a 20 al giorno, resta solo come fallback dell'Agente Capo.
// ============================================================================

const cfg = $('0. Config').first().json;
const contesto = $input.first().json;
const citta = contesto.citta;

const apiKey = cfg.gemini_api_key;
const model = cfg.gemini_model_micro || 'gemini-3.5-flash-lite';
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

if (!apiKey || apiKey.startsWith('INCOLLA_QUI')) {
  throw new Error('API key Gemini non configurata nel nodo "0. Config".');
}

const ctx = this; // serve per this.helpers.httpRequest
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dati = contesto.dati_modelli || '';
const fenomeni = contesto.fenomeni || [];

// Righe extra chieste al micro-agente SUOLO solo dove il profilo le prevede.
const righeFenomeni = [
  fenomeni.includes('nebbia')
    ? '  * Visibilità: [Nebbia o foschia con le ore già calcolate, oppure "visibilità buona"]' : null,
  fenomeni.includes('foehn')
    ? '  * Foehn: [Riporta la finestra oraria se indicata, altrimenti "nessun segnale"]' : null,
  fenomeni.includes('inversione')
    ? '  * Inversione notturna: [Solo se indicata nei dati; è un proxy, non una misura]' : null,
  fenomeni.includes('neve')
    ? '  * Zero termico e neve: [Quota dello zero termico e neve prevista, valori pre-calcolati]' : null
].filter(Boolean).join('\n');

const promptQuota = `Sei l'Agente Specialista QUOTA per ${citta.nome} (${citta.quota} m s.l.m.).
Analizza i dati pre-calcolati:
${dati}

REGOLE TASSATIVE:
Lavora esclusivamente giorno per giorno. Non ricalcolare nulla: i valori sono già definitivi.

Sulla convezione usa la classificazione già presente nei dati, che combina
energia (CAPE), inibizione (CIN), shear e pioggia effettiva:
- ASSENTE: niente da segnalare.
- INESPRESSA: c'è energia ma nessun modello bagna. NON è un temporale: è
  energia bloccata o priva di forzante. Vietato trasformarla in allarme.
- ISOLATA: rovesci brevi e localizzati, poco organizzati.
- CELLE POSSIBILI / ORGANIZZATA: lo shear regge le celle, possibili colpi
  di vento associati.

TEMPLATE PER OGNI GIORNO:
* **[Data MM-GG]:**
  * Sinottica & 850hPa: [Stato di T850, Z500 e vento in quota, max 20 parole]
  * Giudizio Termodinamico: [Classe di convezione e cosa comporta davvero. Max 15 parole.]`;

const promptSuolo = `Sei l'Agente Specialista SUOLO per ${citta.nome} (${citta.quota} m s.l.m.).
Analizza i dati pre-calcolati:
${dati}

REGOLE TASSATIVE:
Lavora esclusivamente giorno per giorno. Usa i valori pre-calcolati così come
sono, non ricalcolarli e non arrotondarli.

TEMPLATE PER OGNI GIORNO:
* **[Data MM-GG]:**
  * Tmin_Tmax: [Valori pre-calcolati, inclusa la percepita]
  * Cielo: [Copertura media e come evolve nella giornata]
  * Vento_Previsto: [Valori pre-calcolati con direzione]
  * Pioggia_Prevista: [Totale giornaliero e intensità oraria max]
${righeFenomeni}
  * Finestra Fenomeni: [Riporta le finestre orarie già calcolate. Se non ci
    sono fenomeni scrivi "Fenomeni assenti". Max 12 parole.]`;

async function callLlm(key, promptText) {
  const tentativi = 1 + (cfg.gemini_retry ?? 2);
  let ultimoErrore;

  for (let n = 0; n < tentativi; n++) {
    try {
      const res = await ctx.helpers.httpRequest({
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: {
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: cfg.gemini_max_output_tokens || 4096,
            thinkingConfig: { thinkingBudget: -1 }
          }
        },
        json: true,
        timeout: cfg.gemini_timeout_ms || 120000
      });

      const blocco = res.promptFeedback?.blockReason;
      if (blocco) throw new Error(`prompt bloccato dai filtri (${blocco})`);

      const cand = res.candidates?.[0];
      const parts = cand?.content?.parts || [];
      const testo = parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();

      if (!testo) {
        // MAX_TOKENS = budget consumato tutto dal reasoning: alzare
        // gemini_max_output_tokens in "0. Config".
        throw new Error(`nessun testo utile (finishReason: ${cand?.finishReason || 'risposta vuota'})`);
      }
      return { key, text: testo };
    } catch (error) {
      ultimoErrore = error;
      const codice = error.statusCode || error.httpCode || error.response?.status || 0;
      const ritentabile = [408, 409, 425, 429, 500, 502, 503, 504].includes(Number(codice))
        || /timeout|ECONNRESET|ETIMEDOUT|socket hang up/i.test(error.message || '');
      if (n === tentativi - 1 || !ritentabile) break;
      await sleep(1500 * Math.pow(2, n)); // 1.5s, 3s, 6s
    }
  }
  throw new Error(`[${key}] ${ultimoErrore?.message || 'errore sconosciuto'}`);
}

const job = [
  { key: 'rep_quota', prompt: promptQuota },
  { key: 'rep_suolo', prompt: promptSuolo }
];

const esiti = await Promise.allSettled(job.map(j => callLlm(j.key, j.prompt)));

const falliti = [];
const reports = {};
esiti.forEach((e, i) => {
  const key = job[i].key;
  if (e.status === 'fulfilled') {
    reports[key] = e.value.text;
  } else {
    // Degrado morbido: l'Agente Capo riceve una nota esplicita invece di un
    // buco silenzioso, che riempirebbe di invenzioni.
    reports[key] = '(report non disponibile: micro-agente in errore)';
    falliti.push(`${key}: ${e.reason?.message || e.reason}`);
  }
});

if (falliti.length === job.length) {
  throw new Error('Entrambi i micro-agenti hanno fallito:\n' + falliti.join('\n'));
}

return [{ json: { ...contesto, ...reports, micro_agenti_falliti: falliti } }];
