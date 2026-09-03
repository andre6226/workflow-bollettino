# Sorgenti dei workflow

I due JSON nella cartella superiore non si modificano a mano: si rigenerano da
qui. Rieseguire i build produce file **byte per byte identici** a quelli in uso.

## Ricostruire

```
python3 build_a.py   # -> ../workflow_bollettini.json   (ingestione bollettini)
python3 build_b.py   # -> ../workflow_v3.json           (bollettino su richiesta)
```

Gli ID delle credenziali n8n sono interni alla singola istanza e non finiscono
nei JSON pubblicati. Per rigenerarli con le proprie credenziali già agganciate:

```
N8N_CRED_GEMINI_ID=... N8N_CRED_SMTP_ID=... python3 build_b.py
```

Senza quelle variabili il blocco `credentials` non viene scritto affatto: dopo
l'import basta selezionare le proprie credenziali nei nodi Gemini e SMTP.

## Provare senza n8n e senza consumare quota

```
export SP=$(pwd)
node test_parser.js     # parser ARPAL + ARPA Piemonte sui PDF reali (fixture/)
node test_wf_a.js       # 3 esecuzioni di fila del workflow A: 200 / 304 / ristampa
node test_richiesta.js  # parsing "<email> <località>" e i 4 messaggi d'errore
node test_agg_v3.js     # aggregatore + fenomeni sulle 5 località
node test_e2e_v3.js     # catena completa -> anteprime HTML in anteprime/
node check_a.js         # sintassi dei nodi Code del workflow A
node check_finale.js    # struttura di entrambi i JSON + caccia ai segreti
```

`test_e2e_v3.js` toglie apposta il 4º giorno dalla risposta finta dell'LLM:
serve a verificare che la mail esca comunque completa.

## Contenuto

| | |
|---|---|
| `js/a*` | nodi Code del workflow A (ingestione) |
| `js/b*` | nodi Code del workflow B (richiesta), `b09` è il prompt dell'Agente Capo |
| `fixture/` | testo dei PDF e risposte Open-Meteo del 2026-09-01/02, congelati |
| `anteprime/` | mail HTML generate dall'ultimo `test_e2e_v3.js` |

Le fixture sono datate: servono a far girare i test in modo ripetibile, non sono
previsioni valide.
