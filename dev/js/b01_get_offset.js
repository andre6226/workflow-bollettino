// ============================================================================
// Offset di polling Telegram (memorizzato nello static data del workflow)
// ============================================================================
// ATTENZIONE: $getWorkflowStaticData viene salvato SOLO nelle esecuzioni di
// produzione (workflow attivo). Nei test manuali l'offset non avanza e vedrai
// sempre gli stessi update: è normale, non è un bug.
//
// NB: qui non c'è (più) nessun controllo basato sull'orario. Una versione
// precedente teneva un "telegramStartTime" impostato al momento del primo
// poll schedulato: siccome lo Schedule Trigger non scatta subito
// all'attivazione (aspetta il primo tick, fino a 3 minuti), un messaggio
// mandato subito dopo aver attivato il workflow arrivava con una data
// precedente a quella soglia e veniva scartato per sempre. Il filtro
// "solo il nuovo" ora si basa unicamente sull'offset di Telegram, gestito
// in "Only /start": è la stessa API a garantire che un update_id già
// consumato non venga mai ripresentato, senza bisogno dell'orologio.
// ============================================================================

const data = $getWorkflowStaticData('global');

return [{
  json: {
    offset: Number.isInteger(data.telegramOffset) ? data.telegramOffset : 0
  }
}];
