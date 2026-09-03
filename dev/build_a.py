#!/usr/bin/env python3
"""Assembla workflow_bollettini.json (workflow A: cache dei bollettini ufficiali)."""
import json, os, uuid

SP = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(SP, 'js')
OUT = os.path.abspath(os.path.join(SP, '..', 'workflow_bollettini.json'))
TABELLA = 'bollettini'


def js(name):
    with open(os.path.join(JS, name), encoding='utf-8') as f:
        return f.read().rstrip('\n')


nodes = []


def node(name, ntype, tv, pos, params, **extra):
    n = {"parameters": params,
         "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "meteo-boll/" + name)),
         "name": name, "type": ntype, "typeVersion": tv, "position": pos}
    n.update(extra)
    nodes.append(n)
    return n


def sticky(content, pos, w, h, color=5):
    n = len([x for x in nodes if x["type"].endswith("stickyNote")]) + 1
    node(f"Nota {n}", "n8n-nodes-base.stickyNote", 1, pos,
         {"content": content, "height": h, "width": w, "color": color})


def tabella():
    return {"__rl": True, "mode": "name", "value": TABELLA}


def colonna(nome):
    return {"id": nome, "displayName": nome, "required": False,
            "defaultMatch": False, "display": True, "type": "string",
            "canBeUsedToMatch": True}


# ---------------------------------------------------------------------------
node("Ogni 20 Minuti", "n8n-nodes-base.scheduleTrigger", 1.2, [-900, 320],
     {"rule": {"interval": [{"field": "minutes", "minutesInterval": 20}]}},
     notes="Tutto il giorno: ARPA Piemonte ripubblica anche fuori orario.")

# Legge tutte le righe in un colpo solo: l'abbinamento regione->riga lo fa il
# nodo dopo, in codice. Evita i problemi di pairing di una get per-item.
node("Leggi Stato Corrente", "n8n-nodes-base.dataTable", 1.1, [-680, 320],
     {
         "resource": "row",
         "operation": "get",
         "dataTableId": tabella(),
         "matchType": "anyCondition",
         "filters": {"conditions": [{"keyName": "regione", "condition": "isNotEmpty"}]},
         "returnAll": True,
     },
     alwaysOutputData=True,
     onError="continueRegularOutput",
     notes="alwaysOutputData: alla prima esecuzione la tabella è vuota.")

node("Fonti da Controllare", "n8n-nodes-base.code", 2, [-460, 320],
     {"jsCode": js("a01_fonti.js")})

node("Scarica se Cambiato", "n8n-nodes-base.httpRequest", 4.2, [-240, 320],
     {
         "url": "={{ $json.url }}",
         "sendHeaders": True,
         "headerParameters": {"parameters": [
             {"name": "If-Modified-Since", "value": "={{ $json.last_modified }}"},
         ]},
         "options": {
             "timeout": 60000,
             "redirect": {"redirect": {}},
             "response": {"response": {
                 "responseFormat": "file",
                 # fullResponse serve per leggere lo statusCode accanto al binario;
                 # neverError evita che un 304 (che NON è 2xx) faccia fallire il nodo.
                 "fullResponse": True,
                 "neverError": True,
             }},
         },
     },
     retryOnFail=True, maxTries=2, waitBetweenTries=5000,
     onError="continueRegularOutput",
     notes="Richiesta condizionale: se non è cambiato, 304 e zero byte scaricati.")

node("Filtra e Riabbina", "n8n-nodes-base.code", 2, [-20, 320],
     {"jsCode": js("a02_filtra.js")})

node("Estrai Testo PDF", "n8n-nodes-base.extractFromFile", 1, [200, 320],
     {"operation": "pdf", "options": {}},
     onError="continueRegularOutput")

node("Parser Bollettino Ufficiale", "n8n-nodes-base.code", 2, [420, 320],
     {"jsCode": js("a03_parser_bollettino.js")})

node("Solo se Cambiato", "n8n-nodes-base.filter", 2.2, [640, 320],
     {
         "conditions": {
             "options": {"caseSensitive": True, "leftValue": "",
                         "typeValidation": "strict", "version": 2},
             "conditions": [{
                 "id": "cambiato",
                 "leftValue": "={{ $json.cambiato }}",
                 "rightValue": "",
                 "operator": {"type": "boolean", "operation": "true", "singleValue": True},
             }],
             "combinator": "and",
         },
         "options": {},
     },
     notes="Seconda rete di sicurezza: stesso numero di bollettino = niente scrittura.")

node("Salva Bollettino", "n8n-nodes-base.dataTable", 1.1, [860, 320],
     {
         "resource": "row",
         "operation": "upsert",
         "dataTableId": tabella(),
         "matchType": "allConditions",
         "filters": {"conditions": [
             {"keyName": "regione", "condition": "eq", "keyValue": "={{ $json.regione }}"},
         ]},
         "columns": {
             "mappingMode": "defineBelow",
             "value": {
                 "regione": "={{ $json.regione }}",
                 "testo_bollettino": "={{ $json.testo_bollettino }}",
             },
             "schema": [colonna("regione"), colonna("testo_bollettino")],
         },
     },
     notes="Upsert su regione: una riga per regione, sempre l'ultima versione.")

# ---------------------------------------------------------------------------
sticky(
    "## A cosa serve\n"
    "Tiene aggiornata la Data table **`bollettini`** con l'ultima versione del "
    "bollettino ufficiale di ogni regione.\n\n"
    "Il workflow del bollettino su richiesta legge da qui invece di riscaricare "
    "1,4 MB di PDF a ogni messaggio Telegram.\n\n"
    "**Una riga per regione**, sovrascritta in upsert.",
    [-920, -80], 420, 300, 4)

sticky(
    "## Come capisce che è cambiato\n"
    "Due controlli in cascata:\n\n"
    "1. **`If-Modified-Since`** → il server risponde `304` e non manda un byte "
    "(verificato su ARPAL). È il caso normale: su ~72 controlli al giorno, ~70 "
    "finiscono qui.\n"
    "2. **Numero di bollettino** → se il file è stato ripubblicato ma il "
    "contenuto è lo stesso, il filtro blocca comunque la scrittura.\n\n"
    "⚠️ Orari reali osservati: ARPAL pubblica verso le **12:33**, ARPA Piemonte "
    "dichiara le **14:00** ma il file risultava ritoccato anche alle **23:35**. "
    "Per questo si controlla tutto il giorno.",
    [-460, -80], 470, 300, 3)

sticky(
    "## Cosa finisce in tabella\n"
    "`testo_bollettino` contiene un **JSON** (non testo piatto), così non si "
    "perde la struttura:\n\n"
    "- `clean` → testo compatto pronto per il prompt\n"
    "- `by_date` → cielo / venti / mare / zero termico e attendibilità per data\n"
    "- `tendenza` → il 4° giorno\n"
    "- `rif_localita` → temperature ufficiali (province, fasce di quota, zero termico)\n\n"
    "Nessuna colonna aggiuntiva richiesta.",
    [420, -80], 460, 300, 6)

sticky(
    "## Il PDF di ARPAL è malformato\n"
    "Non è un PDF pulito: è un corpo `multipart/form-data` salvato su disco per "
    "errore, con il `%PDF` vero al **byte 131**.\n\n"
    "Funziona perché i parser accettano l'header entro i primi 1024 byte. Se un "
    "giorno l'estrazione smette di funzionare senza motivo apparente, la causa "
    "è questa.\n\n"
    "ARPA Piemonte invece è regolare.",
    [200, 560], 420, 260, 7)

# ---------------------------------------------------------------------------
def main(*targets):
    return {"main": [[{"node": t, "type": "main", "index": i} for t, i in targets]]}


connections = {
    "Ogni 20 Minuti": main(("Leggi Stato Corrente", 0)),
    "Leggi Stato Corrente": main(("Fonti da Controllare", 0)),
    "Fonti da Controllare": main(("Scarica se Cambiato", 0)),
    "Scarica se Cambiato": main(("Filtra e Riabbina", 0)),
    "Filtra e Riabbina": main(("Estrai Testo PDF", 0)),
    "Estrai Testo PDF": main(("Parser Bollettino Ufficiale", 0)),
    "Parser Bollettino Ufficiale": main(("Solo se Cambiato", 0)),
    "Solo se Cambiato": main(("Salva Bollettino", 0)),
    "Salva Bollettino": {"main": [[]]},
}

workflow = {
    "name": "Aggiorna Bollettini Ufficiali",
    "nodes": nodes,
    "connections": connections,
    "pinData": {},
    "settings": {
        "executionOrder": "v1",
        "timezone": "Europe/Rome",
        "saveManualExecutions": True,
        "saveExecutionProgress": True,
        "saveDataErrorExecution": "all",
        # Le esecuzioni "nulla di nuovo" sono la stragrande maggioranza: non ha
        # senso conservarle tutte.
        "saveDataSuccessExecution": "none",
        "callerPolicy": "workflowsFromSameOwner",
    },
    "meta": {"templateCredsSetupCompleted": False},
    "tags": [],
}

with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(workflow, f, ensure_ascii=False, indent=2)

names = [n["name"] for n in nodes]
for src, conn in connections.items():
    assert src in names, "connessione da nodo inesistente: " + src
    for key in conn:
        for group in conn[key]:
            for c in group:
                assert c["node"] in names, "connessione verso nodo inesistente: " + c["node"]

print("scritto", OUT)
print("nodi:", len(nodes), "| connessioni: ok")
