// ============================================================================
// FONTI DA CONTROLLARE
// ============================================================================
// Riceve le righe già presenti nella Data table "bollettini" e produce un item
// per ciascuna fonte ufficiale, con il Last-Modified dell'ultima copia scaricata.
//
// Quel valore serve al nodo successivo per fare una richiesta CONDIZIONALE:
// se il file non è cambiato il server risponde 304 e non scarica un byte
// (verificato su ARPAL). Quando non abbiamo ancora nulla si manda una data
// del 1970, così la prima risposta è per forza un 200.
// ============================================================================

const FONTI = [
  {
    regione: 'liguria',
    provider: 'arpal',
    nome_fonte: 'ARPAL Liguria',
    url: 'https://www.arpal.liguria.it/images/pdfWS/bollettinoLiguria.pdf'
  },
  {
    regione: 'piemonte',
    provider: 'arpa_piemonte',
    nome_fonte: 'ARPA Piemonte',
    url: 'https://www.arpa.piemonte.it/rischi_naturali/boll/bollettino_meteotestuale.pdf'
  }
];

const MAI = 'Thu, 01 Jan 1970 00:00:00 GMT';

// Le righe della tabella: alla primissima esecuzione la tabella è vuota e il
// nodo di lettura (con alwaysOutputData) restituisce un item senza campi.
const stato = {};
for (const item of $input.all()) {
  const r = item.json || {};
  if (!r.regione) continue;
  try {
    stato[r.regione] = JSON.parse(r.testo_bollettino || '{}');
  } catch (e) {
    stato[r.regione] = null; // riga corrotta: la trattiamo come assente
  }
}

return FONTI.map(f => {
  const salvato = stato[f.regione] || null;
  return {
    json: {
      ...f,
      last_modified: salvato?.last_modified || MAI,
      // Serve al parser come guardia: se il numero di bollettino non cambia,
      // non riscriviamo la riga anche se il server ci ha dato un 200.
      precedente: salvato ? { bollettino: salvato.bollettino || null } : null,
      gia_presente: Boolean(salvato)
    }
  };
});
