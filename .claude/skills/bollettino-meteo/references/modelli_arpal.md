# Come leggere le tavole BOLAM / MOLOCH

Fonte: [visualizzatore modelli ARPAL](https://cmi-servizi.arpal.liguria.it/visualizzatore-modelli/)
(CMI Liguria, modelli ISAC-CNR). Corse alle 00, 06 e 12 UTC.

| modello | risoluzione | orizzonte | a cosa serve |
|---|---|---|---|
| **MOLOCH** | ~3 km, convection-permitting | +48 h | dove e quando piove, celle convettive, raffiche, effetti orografici (Appennino, Alpi Liguri, Marittime) |
| **BOLAM** | ~10 km, idrostatico | +72 h | struttura sinottica, masse d'aria, vento, zero termico, terzo giorno |

Il passo pubblicato è **3 h**: ogni fotogramma vale per l'istante indicato
(i campi cumulati, come `tp03h` e `sf03h`, valgono per le 3 h che *finiscono*
in quell'istante). Le etichette sono già in ora locale. Non esistono mappe
orarie: per il dettaglio orario resta `dati.md` (Open-Meteo).

## Cosa guardare, tavola per tavola

Segui i fotogrammi **in ordine** e annota solo i cambiamenti sul mirino e
nell'area attorno (fino a qualche decina di km, cioè ciò che sta per arrivare):

- **tp03h** (pioggia 3 h + isobare): primo fotogramma con colore sul mirino
  (inizio), picco (colore più intenso, leggi la scala), ultimo fotogramma
  bagnato (fine). Guarda da dove arriva la banda nei fotogrammi precedenti
  (da mare, da ovest, da nord?) e se le isobare si stringono.
- **tcc100** (nubi + vento): quando si chiude e quando si apre il cielo;
  nubi basse addossate ai rilievi = stau.
- **fg10 / wspd10** (raffiche / vento): rinforzi e rotazioni del vento
  (le barbe), tramontana nei fondovalle appenninici, libeccio sul mare.
- **cape + shear**: CAPE colorato SUL mirino **e** pioggia in `tp03h` allo
  stesso istante = convezione realizzata; CAPE senza pioggia = energia
  inespressa (coerente con la classe dell'aggregatore).
- **t2c** (temperatura 2 m + zero termico): andamento diurno e ingressi
  freddi; isolinea dello zero vicina alla quota della località = neve/gelo.
- **sf03h** (neve 3 h, solo montagna/fondovalle): quando e se la neve
  arriva alla quota della località.
- **thetae@850** (masse d'aria): un fronte è il passaggio da colori caldi a
  freddi; aria calda e umida (theta-e alta) in arrivo da sud = carburante per
  le piogge sul versante ligure.
- **zeroT** (zero termico BOLAM): tendenza nei 3 giorni.
- **sinottica** (mappe intere ogni 12 h): posizione di saccature e
  promontori a 500 hPa, per il `quadro_generale`.

## Come usarle nel bollettino

- Sono una **terza fonte**, accanto a Open-Meteo e al bollettino ufficiale.
  I numeri restano quelli dell'aggregatore: dalle mappe ricavi tempi, forme,
  provenienze ed evoluzione, non valori da scrivere.
- MOLOCH è il riferimento migliore per **dove** cadono i fenomeni intensi in
  Liguria e basso Piemonte (risolve l'orografia meglio dei modelli globali).
  Se MOLOCH colloca il massimo a pochi km dal mirino, dillo come incertezza
  di localizzazione, non come certezza.
- Se BOLAM/MOLOCH anticipano o ritardano di un fotogramma o più le finestre
  di `dati.md`, descrivi l'intervallo comprensivo ("dal pomeriggio, più
  probabilmente tra le 14 e le 20") e abbassa la confidenza se lo scarto è
  grande. Se concordano, alza la confidenza.
- Nel `confronto_ufficiale` cita in una frase come si collocano BOLAM e
  MOLOCH rispetto alla fonte ufficiale e a Open-Meteo.
- Le tavole partono dall'ultima corsa disponibile: se è vecchia di più di
  12 h (vedi l'intestazione della tavola), segnalalo.
