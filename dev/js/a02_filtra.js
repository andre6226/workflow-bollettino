// ============================================================================
// FILTRA E RIABBINA
// ============================================================================
// Il nodo HTTP con fullResponse SOSTITUISCE il json dell'item con i metadati
// della risposta (statusCode, headers): regione e provider andrebbero persi.
// Qui li si riattacca abbinando per indice, si scartano le fonti che hanno
// risposto 304 (nulla di nuovo) e si lascia passare il binario del PDF.
//
// L'abbinamento per indice è sicuro perché a monte non è stato scartato nulla:
// il nodo HTTP produce esattamente un item per ogni fonte, anche in errore
// (neverError + onError: continueRegularOutput).
// ============================================================================

const fonti = $('Fonti da Controllare').all();
const risultati = [];

$input.all().forEach((item, i) => {
  const meta = fonti[i]?.json ?? {};
  const stato = Number(item.json?.statusCode ?? 0);

  // 304 = il file non è cambiato dall'ultimo giro. È il caso normale:
  // su ~72 controlli al giorno ci aspettiamo 70 volte questo.
  if (stato === 304) return;

  if (stato !== 200) {
    // Errore di rete o server giù: si riproverà tra 20 minuti, senza far
    // fallire l'esecuzione né toccare quello che c'è già in tabella.
    return;
  }

  if (!item.binary?.data) return;

  // Il Last-Modified nuovo diventa quello da salvare per il prossimo confronto.
  const headers = item.json?.headers || {};
  const nuovoLM = headers['last-modified'] || headers['Last-Modified'] || meta.last_modified;

  risultati.push({
    json: { ...meta, statusCode: stato, last_modified: nuovoLM },
    binary: item.binary
  });
});

return risultati;
