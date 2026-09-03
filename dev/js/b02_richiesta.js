// ============================================================================
// LEGGI RICHIESTA — dal messaggio Telegram a { destinatari, località }
// ============================================================================
// Formato atteso:  <email> <località>
//   mario@esempio.it limone piemonte
//   a@b.com, c@d.it garessio
//
// I token che contengono "@" sono email, tutto il resto unito è il nome della
// località: così funzionano sia più destinatari sia i nomi di due parole.
//
// Le richieste malformate NON vengono buttate via in silenzio: escono con un
// campo `errore` e un nodo a valle risponde su Telegram.
// ============================================================================

const cfg = $('0. Config').first().json;
const data = $getWorkflowStaticData('global');

const updates = Array.isArray($json.result) ? $json.result : [];
if (updates.length === 0) return [];

// Avanza sempre l'offset, anche per i messaggi che scarteremo.
const maxUpdateId = updates.reduce((max, u) => Math.max(max, Number(u.update_id) || 0), 0);
if (maxUpdateId > 0) data.telegramOffset = maxUpdateId + 1;

// Primissima esecuzione: la coda accumulata su Telegram fa da baseline e non
// viene processata. Da qui in poi basta l'offset. (Nessun controllo a orologio:
// aveva una finestra morta all'attivazione.)
if (!data.telegramInitialized) {
  data.telegramInitialized = true;
  return [];
}

const allowed = (cfg.allowed_chat_ids || []).map(Number);
const emailRegex = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const out = [];

for (const u of updates) {
  const msg = u.message;
  if (!msg) continue;

  const chatId = Number(msg.chat?.id);
  if (allowed.length > 0 && !allowed.includes(chatId)) continue;

  const text = String(msg.text || '').trim();
  if (!text) continue;

  // I comandi non sono richieste di bollettino: ignorati senza risposta.
  if (text.startsWith('/')) continue;

  const base = {
    text,
    chat_id: chatId,
    user_id: msg.from?.id,
    username: msg.from?.username ?? null,
    update_id: u.update_id
  };

  const token = text.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean);
  const grezzeEmail = token.filter(t => t.includes('@'));
  const restanti = token.filter(t => !t.includes('@'));

  const emails = [...new Set(grezzeEmail.map(e => e.toLowerCase()))];
  const nonValide = emails.filter(e => !emailRegex.test(e));

  if (!emails.length) {
    out.push({ json: { ...base, errore: 'nessuna_email' } });
    continue;
  }
  if (nonValide.length) {
    out.push({ json: { ...base, errore: 'email_non_valida', dettaglio: nonValide.join(', ') } });
    continue;
  }

  const localita = restanti.join(' ').trim();
  if (!localita) {
    out.push({ json: { ...base, errore: 'localita_mancante' } });
    continue;
  }

  out.push({
    json: {
      ...base,
      emails: emails.slice(0, cfg.max_destinatari || 5),
      scartati: Math.max(0, emails.length - (cfg.max_destinatari || 5)),
      localita_richiesta: localita,
      errore: null
    }
  });
}

return out;
