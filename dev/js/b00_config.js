// ============================================================================
// 0. CONFIG — segreti, località e impostazioni
// ============================================================================
// Ordine di priorità: variabile d'ambiente -> valore scritto qui sotto.
//   TELEGRAM_BOT_TOKEN=123456:AA...   GEMINI_API_KEY=AQ...
//   EMAIL_MITTENTE=tua_email@esempio.com
// Su n8n Cloud $env è bloccato: incolla i valori nei fallback.
// ============================================================================

function env(name) {
  try {
    return ($env && $env[name]) ? String($env[name]) : '';
  } catch (e) {
    return ''; // accesso a $env disabilitato
  }
}

const TELEGRAM_BOT_TOKEN = env('TELEGRAM_BOT_TOKEN') || 'INCOLLA_QUI_IL_TOKEN_TELEGRAM';
const GEMINI_API_KEY     = env('GEMINI_API_KEY')     || 'INCOLLA_QUI_LA_API_KEY_GEMINI';

// Chi può chiedere il bollettino. [] = chiunque (sconsigliato: chiunque
// conosca il bot può far partire mail verso indirizzi arbitrari dal tuo SMTP).
const ALLOWED_CHAT_IDS = [];

// ---------------------------------------------------------------------------
// PROFILI — decidono variabili scaricate, fenomeni calcolati e quarta casella
// della mail. La convezione (CAPE + shear) si calcola sempre, ovunque.
// ---------------------------------------------------------------------------
const PROFILI = {
  costa:      { fenomeni: [],                                           riquadro: 'mare' },
  pianura:    { fenomeni: ['nebbia', 'inversione', 'foehn'],             riquadro: 'visibilita' },
  montagna:   { fenomeni: ['neve', 'foehn'],                             riquadro: 'neve' },
  fondovalle: { fenomeni: ['nebbia', 'inversione', 'foehn', 'neve'],     riquadro: 'neve' }
};

const cfg = {
  telegram_token: TELEGRAM_BOT_TOKEN,
  gemini_api_key: GEMINI_API_KEY,

  // Flash Lite è il modello PRIMARIO: 500 richieste/giorno contro le 20 di
  // 3.7 Flash, che resta cablato come fallback sull'Agente Capo.
  gemini_model_micro: 'gemini-3.5-flash-lite',
  gemini_timeout_ms: 120000,
  gemini_max_output_tokens: 4096,
  gemini_retry: 2,

  allowed_chat_ids: ALLOWED_CHAT_IDS,
  max_destinatari: 5,
  // Casella SMTP da cui parte la mail (compare come mittente e in To:).
  email_mittente: env('EMAIL_MITTENTE') || 'tua_email@esempio.com',
  forecast_days: 4,

  // Oltre queste ore il bollettino ufficiale in tabella è considerato vecchio
  // e la mail lo segnala (senza bloccare l'invio).
  ore_max_bollettino: 30,

  profili: PROFILI,

  citta: [
    { id: 'bordighera', nome: 'Bordighera', lat: 43.7794, lon: 7.6697, quota: 10,
      regione: 'liguria', rif: 'Imperia', zona_mare: 'ponente', profilo: 'costa',
      alias: ['bordighera', 'bordi'] },

    { id: 'genova', nome: 'Genova Centro', lat: 44.4056, lon: 8.9463, quota: 20,
      regione: 'liguria', rif: 'Genova', zona_mare: 'centro', profilo: 'costa',
      alias: ['genova', 'genova centro', 'genoa', 'ge'] },

    { id: 'limone', nome: 'Limone Piemonte', lat: 44.2017, lon: 7.5769, quota: 1010,
      regione: 'piemonte', rif: 'CN', profilo: 'montagna',
      alias: ['limone', 'limone piemonte'] },

    { id: 'torino', nome: 'Torino', lat: 45.0703, lon: 7.6869, quota: 239,
      regione: 'piemonte', rif: 'TO', profilo: 'pianura',
      alias: ['torino', 'turin', 'to'] },

    { id: 'garessio', nome: 'Garessio', lat: 44.2033, lon: 8.0203, quota: 621,
      regione: 'piemonte', rif: 'CN', profilo: 'fondovalle',
      alias: ['garessio', 'val tanaro'] }
  ]
};

cfg._warnings = [];
if (cfg.telegram_token.startsWith('INCOLLA_QUI')) cfg._warnings.push('Token Telegram non configurato');
if (cfg.gemini_api_key.startsWith('INCOLLA_QUI')) cfg._warnings.push('API key Gemini non configurata');
if (!cfg.allowed_chat_ids.length) cfg._warnings.push('allowed_chat_ids vuoto: il bot risponde a CHIUNQUE');
if (cfg.email_mittente.endsWith('@esempio.com')) cfg._warnings.push('email_mittente non configurata');

return [{ json: cfg }];
