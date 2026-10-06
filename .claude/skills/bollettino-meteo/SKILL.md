---
name: bollettino-meteo
description: Redige un bollettino meteo ragionato a 4 giorni per una località configurata (Bordighera, Genova, Limone Piemonte, Torino, Garessio), incrociando il bollettino ufficiale ARPAL / ARPA Piemonte con i modelli Open-Meteo ad alta risoluzione, e produce la mail HTML del workflow n8n. Usala quando l'utente chiede previsioni, meteo, tempo o un bollettino per una di queste località (anche "che tempo fa a Limone?", "bollettino per Genova", "meteo weekend Torino").
---

# Bollettino meteo ragionato

È il Workflow B di questo repository (`workflow_v3.json`) senza n8n, Telegram
e Gemini: gli script riusano **gli stessi nodi Code** di `dev/js/`, e tu fai
la parte che lì facevano i micro-agenti e l'Agente Capo.

Principio non negoziabile, identico al workflow: **i numeri li fa lo script,
tu scrivi solo il testo.** `finalizza.js` riscrive ogni valore dalle
statistiche deterministiche e la lista dei giorni la decide lui.

Requisiti: `node` (≥18), `pdftotext` (poppler-utils), `python3` con Pillow,
`git` o `curl`+`tar` al primo avvio fuori dal repo. Nessuna API key.

## Procedura

Gli script stanno in `scripts/` accanto a questo file (chiamalo `$SKILL`).

1. **Prepara i dati**

   ```bash
   node $SKILL/scripts/prepara.js "<località>"
   ```

   Stampa la cartella di lavoro. Uscita 2 = località non configurata: riferisci
   l'elenco disponibile e fermati (aggiungere località si fa in
   `dev/js/b00_config.js`, poi `python3 dev/build_b.py`). Se la fonte ufficiale
   non si legge lo script prosegue coi soli modelli e lo scrive in `nota:`.

2. **Scarica i modelli ARPAL BOLAM e MOLOCH**

   ```bash
   python3 $SKILL/scripts/arpal_modelli.py <cartella>
   ```

   Prende l'ultima corsa dal
   [visualizzatore modelli ARPAL](https://cmi-servizi.arpal.liguria.it/visualizzatore-modelli/),
   scarica **tutte le scadenze** (ogni 3 h, il passo più fitto pubblicato:
   MOLOCH fino a +48 h, BOLAM fino a +72 h) e compone per ogni variabile una
   tavola in sequenza temporale, ritagliata sulla località (mirino) e con la
   scala colori. L'indice è `<cartella>/arpal.md`. Se il sito non risponde,
   prosegui senza e dillo nel `confronto_ufficiale`.

3. **Leggi** `<cartella>/dati.md` per intero,
   [`references/regole_redazione.md`](references/regole_redazione.md) e
   [`references/modelli_arpal.md`](references/modelli_arpal.md); poi **apri
   con Read ogni tavola elencata in `arpal.md`** e segui fotogramma per
   fotogramma come cambia il campo sul mirino (vedi `modelli_arpal.md`).

4. **Ragiona e scrivi** `<cartella>/testo.json` seguendo le regole: diagnosi in
   quota e al suolo giorno per giorno, confronto tra Open-Meteo, BOLAM/MOLOCH e
   fonte ufficiale, classe di convezione rispettata alla lettera, orari
   ricopiati, niente numeri fisici, 60+ parole per giorno.

5. **Finalizza**

   ```bash
   node $SKILL/scripts/finalizza.js <cartella>
   ```

   Produce `bollettino.html` (la mail del workflow) e `bollettino.txt`.
   Se tra gli avvisi compaiono "descrizioni più brevi del previsto", allunga
   quelle giornate e rilancia.

6. **Consegna**: mostra all'utente il contenuto di `bollettino.txt` (è breve),
   poi una sezione "Evoluzione secondo BOLAM e MOLOCH" con la sequenza
   ricavata dalle tavole (blocchi di 3 h in ora locale, solo quelli in cui
   cambia qualcosa), il percorso di `bollettino.html` e gli avvisi. Non inviare
   mail: se l'utente vuole spedirla, chiedi conferma prima.

## Note

- Se l'utente chiede solo una risposta veloce ("piove domani a Torino?"),
  fai i passi 1-3 (delle tavole ARPAL apri solo quelle pertinenti) e
  rispondi in poche righe senza generare l'HTML.
- Le date sono quelle di `dati.md` (oggi + 3): se l'utente chiede un giorno
  oltre l'orizzonte, dillo.
- **Funziona anche fuori dal repo.** Gli script cercano i nodi Code in
  quest'ordine: `METEO_DEV_JS`, poi il repo che contiene la skill
  (`../../../../dev/js`), poi una copia di
  [andre6226/workflow-bollettino](https://github.com/andre6226/workflow-bollettino)
  in `~/.cache/bollettino-meteo/` (o `$METEO_CACHE`). Se manca la clonano
  (git, oppure curl + tar), e la aggiornano al massimo una volta al giorno.
  Offline usano la copia in cache con un avviso; senza cache e senza rete si
  fermano con un errore chiaro.
- Per installarla per tutti i progetti copia questa cartella in
  `~/.claude/skills/bollettino-meteo/`.
