// ============================================================================
// MESSAGGIO DI ERRORE PER TELEGRAM
// ============================================================================
// Senza questo ramo una richiesta malformata sparisce nel nulla e chi scrive
// non capisce se il bot sia vivo.
// ============================================================================

return $input.all().map(item => {
  const j = item.json;
  const elenco = j.elenco_localita || '';

  let testo;
  switch (j.errore) {
    case 'nessuna_email':
      testo = '❌ Non ho trovato un indirizzo email nel messaggio.\n\n' +
              'Scrivimi così:\n<email> <località>\n\n' +
              'Esempio: mario@esempio.it garessio';
      break;
    case 'email_non_valida':
      testo = `❌ Indirizzo non valido: ${j.dettaglio}\n\n` +
              'Controlla e riprova con: <email> <località>';
      break;
    case 'localita_mancante':
      testo = '❌ Manca la località.\n\n' +
              'Scrivimi così:\n<email> <località>\n\n' +
              `Località disponibili: ${elenco}`;
      break;
    case 'localita_sconosciuta':
      testo = `❌ Non conosco la località "${j.localita_richiesta}".\n\n` +
              `Località disponibili: ${elenco}`;
      break;
    default:
      testo = '❌ Non sono riuscito a interpretare la richiesta.\n\n' +
              `Scrivimi: <email> <località>\n\nLocalità disponibili: ${elenco}`;
  }

  return { json: { chat_id: j.chat_id, testo } };
});
