#!/usr/bin/env python3
"""Assembla workflow_v3.json (bollettino su richiesta, una località per volta)."""
import json, os, uuid

SP = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(SP, 'js')
OUT = os.path.abspath(os.path.join(SP, '..', 'workflow_v3.json'))
TABELLA = 'bollettini'
CFG = "$('0. Config').first().json"


def js(name):
    with open(os.path.join(JS, name), encoding='utf-8') as f:
        return f.read().rstrip('\n')


nodes = []


def node(name, ntype, tv, pos, params, **extra):
    n = {"parameters": params,
         "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "meteo-v3/" + name)),
         "name": name, "type": ntype, "typeVersion": tv, "position": pos}
    n.update(extra)
    nodes.append(n)
    return n


def cred(slot, env_var, nome):
    """Riferimento a una credenziale n8n.

    Gli ID delle credenziali sono interni alla singola istanza: se finissero nel
    JSON pubblicato, chi lo importa vedrebbe riferimenti rotti. Quindi l'ID si
    prende da variabile d'ambiente e, se manca, il blocco `credentials` non viene
    scritto affatto: dopo l'import basta selezionare le proprie credenziali.
    """
    cid = os.environ.get(env_var, '').strip()
    if not cid:
        return {}
    return {"credentials": {slot: {"id": cid, "name": nome}}}


def sticky(content, pos, w, h, color=5):
    n = len([x for x in nodes if x["type"].endswith("stickyNote")]) + 1
    node(f"Nota {n}", "n8n-nodes-base.stickyNote", 1, pos,
         {"content": content, "height": h, "width": w, "color": color})


def telegram_url(metodo):
    return "={{ 'https://api.telegram.org/bot' + " + CFG + ".telegram_token + '/" + metodo + "' }}"


# --------------------------------------------------------------- ingestione ---
node("Poll Telegram", "n8n-nodes-base.scheduleTrigger", 1.2, [-1500, 400],
     {"rule": {"interval": [{"field": "minutes", "minutesInterval": 3}]}})

node("0. Config", "n8n-nodes-base.code", 2, [-1290, 400],
     {"jsCode": js("b00_config.js")},
     notes="Token, API key, località e profili: tutto qui.", notesInFlow=True)

node("Get Offset", "n8n-nodes-base.code", 2, [-1080, 400],
     {"jsCode": js("b01_get_offset.js")})

node("Telegram getUpdates", "n8n-nodes-base.httpRequest", 4.2, [-870, 400],
     {
         "url": telegram_url("getUpdates"),
         "sendQuery": True,
         "queryParameters": {"parameters": [
             {"name": "offset", "value": "={{ $json.offset ?? 0 }}"},
             {"name": "timeout", "value": "0"},
             {"name": "allowed_updates", "value": "[\"message\"]"},
         ]},
         "options": {"timeout": 20000},
     },
     retryOnFail=True, maxTries=2, waitBetweenTries=2000,
     onError="continueRegularOutput")

node("Leggi Richiesta", "n8n-nodes-base.code", 2, [-660, 400],
     {"jsCode": js("b02_richiesta.js")},
     notes="Formato: <email> <località>")

node("Risolvi Località", "n8n-nodes-base.code", 2, [-450, 400],
     {"jsCode": js("b03_risolvi_localita.js")})

node("Richiesta Valida?", "n8n-nodes-base.if", 2.2, [-240, 400],
     {
         "conditions": {
             "options": {"caseSensitive": True, "leftValue": "",
                         "typeValidation": "loose", "version": 2},
             "conditions": [{
                 "id": "senza-errore",
                 "leftValue": "={{ $json.errore }}",
                 "rightValue": "",
                 "operator": {"type": "object", "operation": "empty", "singleValue": True},
             }],
             "combinator": "and",
         },
         "looseTypeValidation": True,
         "options": {},
     })

# ------------------------------------------------------------- ramo errore ---
node("Messaggio di Errore", "n8n-nodes-base.code", 2, [-30, 620],
     {"jsCode": js("b10_messaggio_errore.js")})

node("Avvisa su Telegram", "n8n-nodes-base.httpRequest", 4.2, [180, 620],
     {
         "method": "POST",
         "url": telegram_url("sendMessage"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ chat_id: $json.chat_id, text: $json.testo }) }}",
         "options": {"timeout": 15000},
     },
     onError="continueRegularOutput")

# --------------------------------------------------------------- pipeline ----
node("Leggi Bollettino Ufficiale", "n8n-nodes-base.dataTable", 1.1, [-30, 300],
     {
         "resource": "row",
         "operation": "get",
         "dataTableId": {"__rl": True, "mode": "name", "value": TABELLA},
         "matchType": "allConditions",
         "filters": {"conditions": [
             {"keyName": "regione", "condition": "eq", "keyValue": "={{ $json.regione }}"},
         ]},
         "returnAll": False,
         "limit": 1,
     },
     alwaysOutputData=True,
     onError="continueRegularOutput",
     notes="Scritta dal workflow 'Aggiorna Bollettini Ufficiali'.")

node("Prepara Bollettino Ufficiale", "n8n-nodes-base.code", 2, [180, 300],
     {"jsCode": js("b04_prepara_bollettino.js")})

node("Dati Open-Meteo", "n8n-nodes-base.httpRequest", 4.2, [390, 300],
     {
         "url": "https://api.open-meteo.com/v1/forecast",
         "sendQuery": True,
         "queryParameters": {"parameters": [
             {"name": "latitude", "value": "={{ $json.citta.lat }}"},
             {"name": "longitude", "value": "={{ $json.citta.lon }}"},
             {"name": "models",
              "value": "icon_d2,meteofrance_arome_france_hd,italia_meteo_arpae_icon_2i,ecmwf_ifs025,gfs_seamless"},
             # La lista è costruita da "Risolvi Località" secondo il profilo:
             # si scarica solo ciò che verrà davvero usato.
             {"name": "hourly", "value": "={{ $json.hourly }}"},
             {"name": "forecast_days", "value": "={{ " + CFG + ".forecast_days }}"},
             {"name": "timezone", "value": "auto"},
         ]},
         "options": {"timeout": 45000},
     },
     retryOnFail=True, maxTries=3, waitBetweenTries=3000)

node("Aggregatore", "n8n-nodes-base.code", 2, [600, 300],
     {"jsCode": js("b05_aggregatore.js")},
     notes="Qui nasce ogni numero del bollettino.")

node("Micro-Agenti", "n8n-nodes-base.code", 2, [810, 300],
     {"jsCode": js("b06_richiesta_llm.js")},
     notes="2 chiamate in parallelo, con retry e degrado morbido.")

node("Agente Capo", "@n8n/n8n-nodes-langchain.chainLlm", 1.9, [1020, 300],
     {
         "promptType": "define",
         # Il "=" iniziale marca il campo come ESPRESSIONE: senza, i {{ }} del
         # prompt verrebbero mandati al modello alla lettera.
         "text": "=" + js("b09_prompt_capo.txt"),
         "needsFallback": True,
         "messages": {"messageValues": []},
         "batching": {},
     })

# Flash Lite PRIMARIO: 500 richieste/giorno contro le 20 di 3.7 Flash, che
# resta agganciato come fallback (withFallbacks scatta anche sui 429).
node("Gemini Flash Lite (primario)", "@n8n/n8n-nodes-langchain.lmChatGoogleGemini", 1.1, [960, 540],
     {"modelName": "models/gemini-3.5-flash-lite",
      "options": {"temperature": 0.3, "maxOutputTokens": 8192}},
     **cred("googlePalmApi", "N8N_CRED_GEMINI_ID", "Google Gemini(PaLM) Api account"))

node("Gemini 3.7 Flash (fallback)", "@n8n/n8n-nodes-langchain.lmChatGoogleGemini", 1.1, [1140, 540],
     {"modelName": "models/gemini-3.7-flash",
      "options": {"temperature": 0.3, "maxOutputTokens": 8192}},
     **cred("googlePalmApi", "N8N_CRED_GEMINI_ID", "Google Gemini(PaLM) Api account"),
     notes="Subentra se Flash Lite dà errore o 429.")

node("Validatore", "n8n-nodes-base.code", 2, [1230, 300],
     {"jsCode": js("b07_validatore.js")},
     notes="Le date le decide lo script, non il modello.")

node("Formatta HTML", "n8n-nodes-base.code", 2, [1440, 300],
     {"jsCode": js("b08_formatta_html.js")})

node("Invia Email", "n8n-nodes-base.emailSend", 2.1, [1650, 300],
     {
         "fromEmail": "={{ " + CFG + ".email_mittente }}",
         # I destinatari vanno in BCC (in emailSend v2 sta dentro "options"),
         # così nessun richiedente vede gli indirizzi degli altri.
         "toEmail": "={{ " + CFG + ".email_mittente }}",
         "subject": "=🌤️ Bollettino Meteo {{ $json.citta }} - {{ $now.setZone('Europe/Rome').toFormat('dd/MM/yyyy') }}",
         "emailFormat": "both",
         "text": "={{ $json.text }}",
         "html": "={{ $json.html }}",
         "options": {
             "bccEmail": "={{ ($json.emails || []).join(',') }}",
             "appendAttribution": False,
         },
     },
     retryOnFail=True, maxTries=2, waitBetweenTries=5000,
     **cred("smtp", "N8N_CRED_SMTP_ID", "SMTP account"))

node("Conferma Telegram", "n8n-nodes-base.httpRequest", 4.2, [1860, 300],
     {
         "method": "POST",
         "url": telegram_url("sendMessage"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ chat_id: $('Formatta HTML').item.json.chat_id, text: '✅ Bollettino per ' + $('Formatta HTML').item.json.citta + ' inviato a: ' + ($('Formatta HTML').item.json.emails || []).join(', ') }) }}",
         "options": {"timeout": 15000},
     },
     onError="continueRegularOutput")

# -------------------------------------------------------------------- note ---
sticky(
    "## 0. Configurazione\n"
    "Token Telegram, API key Gemini, **località e profili** stanno solo nel nodo "
    "`0. Config`.\n\n"
    "Valorizzali con `TELEGRAM_BOT_TOKEN` e `GEMINI_API_KEY`, oppure incollali "
    "nei fallback dentro il nodo.\n\n"
    "⚠️ Se `allowed_chat_ids` resta vuoto, **chiunque** conosca il bot può far "
    "partire mail verso indirizzi arbitrari dal tuo SMTP.",
    [-1520, 60], 420, 300, 3)

sticky(
    "## Come si chiede il bollettino\n"
    "Un messaggio al bot nel formato:\n\n"
    "```\n<email> <località>\n```\n\n"
    "Esempi:\n"
    "- `mario@esempio.it garessio`\n"
    "- `a@b.com, c@d.it limone piemonte`\n\n"
    "I token con `@` sono email, il resto è il nome della località: funzionano "
    "sia più destinatari sia i nomi di due parole.\n\n"
    "Richieste malformate ricevono **risposta su Telegram** invece di sparire "
    "nel nulla.",
    [-680, 60], 400, 320, 4)

sticky(
    "## Profili di località\n"
    "Il profilo decide **cosa si scarica, cosa si calcola e la quarta casella**:\n\n"
    "| profilo | 4ª casella | fenomeni |\n"
    "|---|---|---|\n"
    "| costa | 🌊 Mare | — |\n"
    "| pianura | 🌫️ Visibilità | nebbia, inversione, foehn |\n"
    "| montagna | 🏔️ Zero termico | neve, foehn |\n"
    "| fondovalle | 🏔️ Zero termico | tutti |\n\n"
    "La convezione (CAPE **+ shear**) si valuta ovunque.",
    [370, 60], 440, 300, 6)

sticky(
    "## Quota Gemini\n"
    "**3 chiamate per bollettino** (2 micro-agenti + 1 Capo), tutte su Flash "
    "Lite: 500 richieste/giorno → ~166 bollettini.\n\n"
    "3.7 Flash si ferma a **20 al giorno**: come fallback bastano e avanzano.",
    [960, 700], 400, 240, 7)

sticky(
    "## Convezione onesta\n"
    "Il CAPE da solo non dice nulla. La classe combina energia, inibizione, "
    "**shear** e pioggia effettiva:\n\n"
    "- `inespressa` → c'è energia ma nessun modello bagna. **Non** è un "
    "temporale, e il prompt vieta di raccontarlo come tale.\n"
    "- `isolata` / `celle possibili` / `organizzata` → lo shear regge le celle.\n\n"
    "Senza questo incrocio 2330 J/kg con 0 mm di pioggia diventano un allarme.",
    [590, 700], 420, 260, 5)

# --------------------------------------------------------------- connessioni ---
def main(*targets):
    return {"main": [[{"node": t, "type": "main", "index": i} for t, i in targets]]}


connections = {
    "Poll Telegram": main(("0. Config", 0)),
    "0. Config": main(("Get Offset", 0)),
    "Get Offset": main(("Telegram getUpdates", 0)),
    "Telegram getUpdates": main(("Leggi Richiesta", 0)),
    "Leggi Richiesta": main(("Risolvi Località", 0)),
    # uscita 0 = valida, uscita 1 = errore
    "Risolvi Località": main(("Richiesta Valida?", 0)),
    "Richiesta Valida?": {"main": [
        [{"node": "Leggi Bollettino Ufficiale", "type": "main", "index": 0}],
        [{"node": "Messaggio di Errore", "type": "main", "index": 0}],
    ]},
    "Messaggio di Errore": main(("Avvisa su Telegram", 0)),
    "Avvisa su Telegram": {"main": [[]]},

    "Leggi Bollettino Ufficiale": main(("Prepara Bollettino Ufficiale", 0)),
    "Prepara Bollettino Ufficiale": main(("Dati Open-Meteo", 0)),
    "Dati Open-Meteo": main(("Aggregatore", 0)),
    "Aggregatore": main(("Micro-Agenti", 0)),
    "Micro-Agenti": main(("Agente Capo", 0)),
    "Agente Capo": main(("Validatore", 0)),
    "Validatore": main(("Formatta HTML", 0)),
    "Formatta HTML": main(("Invia Email", 0)),
    "Invia Email": main(("Conferma Telegram", 0)),
    "Conferma Telegram": {"main": [[]]},

    "Gemini Flash Lite (primario)": {"ai_languageModel": [[
        {"node": "Agente Capo", "type": "ai_languageModel", "index": 0}]]},
    "Gemini 3.7 Flash (fallback)": {"ai_languageModel": [[
        {"node": "Agente Capo", "type": "ai_languageModel", "index": 1}]]},
}

workflow = {
    "name": "Bollettino Meteo su Richiesta (v3)",
    "nodes": nodes,
    "connections": connections,
    "pinData": {},
    "settings": {
        "executionOrder": "v1",
        "timezone": "Europe/Rome",
        "saveManualExecutions": True,
        "saveExecutionProgress": True,
        "saveDataErrorExecution": "all",
        "saveDataSuccessExecution": "all",
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

# I riferimenti $('Nodo') dentro il codice devono puntare a nodi esistenti
import re
for n in nodes:
    code = n.get("parameters", {}).get("jsCode") or n.get("parameters", {}).get("text") or ""
    for rif in re.findall(r"\$\('([^']+)'\)", code):
        assert rif in names, f"{n['name']}: riferimento a nodo inesistente $('{rif}')"

print("scritto", OUT)
print("nodi:", len(nodes), "| connessioni e riferimenti: ok")
