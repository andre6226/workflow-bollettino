# Workflow meteo per n8n

Due workflow n8n che producono un bollettino meteo ragionato per una località,
combinando i bollettini ufficiali di ARPAL e ARPA Piemonte con i modelli
numerici di Open-Meteo e una sintesi fatta da Gemini.

| file | cosa fa |
|---|---|
| `workflow_bollettini.json` | **Workflow A** — scarica i bollettini ufficiali PDF, li interpreta e li tiene in cache in una Data Table di n8n |
| `workflow_v3.json` | **Workflow B** — riceve una richiesta su Telegram (`<email> <località>`), costruisce il bollettino e lo manda via mail |
| `dev/` | sorgenti: gli script che generano i due JSON, i nodi Code separati, le fixture e i test |

## Installazione

1. In n8n: **Import from File** per entrambi i JSON.
2. Nei nodi **Gemini Flash Lite / Gemini 3.7 Flash** e **Invia Email** seleziona
   le tue credenziali (i JSON sono pubblicati senza ID di credenziali, che sono
   interni a ogni istanza).
3. Crea una Data Table chiamata `bollettini`.
4. Apri il nodo **0. Config** del Workflow B e configura i segreti.

## Configurazione

Tutto sta nel nodo `0. Config`. I valori si prendono dalle variabili d'ambiente
e, se assenti, dai fallback scritti nel nodo — su n8n Cloud `$env` è bloccato,
quindi lì vanno incollati nei fallback.

| variabile | a cosa serve |
|---|---|
| `TELEGRAM_BOT_TOKEN` | token del bot che riceve le richieste |
| `GEMINI_API_KEY` | API key Google Gemini |
| `EMAIL_MITTENTE` | casella SMTP da cui parte la mail |

Nello stesso nodo si definiscono le **località** (coordinate, quota, profilo) e
`allowed_chat_ids`.

> ⚠️ Se `allowed_chat_ids` resta vuoto, **chiunque** conosca il bot può far
> partire mail verso indirizzi arbitrari dal tuo SMTP. Mettici il tuo chat id.

Nessun segreto è committato in questo repository: i JSON contengono solo
segnaposto. Non incollare token o API key nei file prima di un commit.

## Uso

Un messaggio al bot Telegram:

```
mario@esempio.it limone piemonte
```

I token che contengono `@` sono destinatari (in BCC, max 5), il resto è il nome
della località. Le richieste malformate ricevono una risposta di errore.

## Sviluppo

I JSON non si modificano a mano — vedi [`dev/README.md`](dev/README.md) per
rigenerarli e per la suite di test che gira senza n8n e senza consumare quota.
