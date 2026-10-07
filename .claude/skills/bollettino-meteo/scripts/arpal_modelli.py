#!/usr/bin/env python3
# =============================================================================
# MODELLI ARPAL — BOLAM e MOLOCH dal visualizzatore del CMI Liguria
# =============================================================================
#   python3 arpal_modelli.py <cartella_lavoro>
#
# Il visualizzatore (cmi-servizi.arpal.liguria.it/visualizzatore-modelli/)
# pubblica solo mappe, una per variabile e scadenza (ogni 3 h: MOLOCH fino a
# +48 h, BOLAM fino a +72 h). Questo script, per la località di contesto.json:
#
#  1. trova l'ultima corsa disponibile di ciascun modello (versione "zoom",
#     Nord-Ovest Italia, stessa cornice per entrambi)
#  2. scarica tutte le scadenze delle variabili utili al profilo
#  3. ritaglia intorno alla località, la segna con un mirino e mette i
#     fotogrammi in sequenza con l'ora locale di validità e la scala colori
#  4. scrive arpal.md con l'elenco delle tavole da guardare
#
# Le tavole sono fatte per essere LETTE da Claude: la lettura è visiva, i
# numeri del bollettino restano quelli dell'aggregatore.
# =============================================================================

import concurrent.futures as cf
import datetime as dt
import io
import json
import re
import sys
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont

BASE = 'https://cmi-servizi.arpal.liguria.it/visualizzatore-modelli'
ROMA = ZoneInfo('Europe/Rome')
GIORNI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']

# Cornice delle mappe "zoom" (1024x768): 6–13.5 °E, 42–47 °N, griglia regolare
# in lat/lon. Misurata sui bordi neri del riquadro, uguale per BOLAM e MOLOCH.
X0, X1, LON0, LON1 = 83.5, 892.5, 6.0, 13.5
Y0, Y1, LAT0, LAT1 = 67.5, 695.5, 47.0, 42.0
SCALA_COLORI = (915, 35, 1000, 730)

# Finestra del ritaglio attorno alla località, in gradi.
MEZZA_LON, MEZZA_LAT = 0.9, 0.6
INGRANDIMENTO = 1.4
COLONNE = 4

# (prefisso della variabile, titolo, profili a cui serve; None = tutti)
VARIABILI = {
    'moloch_zoom': [
        ('tp03h', 'Precipitazione 3 h + pressione', None),
        ('tcc100', 'Nuvolosità (totale, alta, bassa) + vento 10 m', None),
        ('fg10', 'Raffiche 10 m', None),
        ('cape', 'CAPE + shear 0-6 km', None),
        ('t2c', 'Temperatura 2 m + zero termico', None),
        ('sf03h', 'Neve 3 h', {'montagna', 'fondovalle'}),
    ],
    'bolam_zoom': [
        ('tp03h', 'Precipitazione 3 h + pressione', None),
        ('wspd10', 'Vento 10 m', None),
        ('thetae@850', 'Theta-e e vento a 850 hPa (masse d\'aria)', None),
        ('cape', 'CAPE + shear 0-6 km', None),
        ('zeroT', 'Zero termico', {'montagna', 'fondovalle', 'pianura'}),
    ],
}
# Quadro sinottico: mappe intere, una ogni 12 h.
SINOTTICA = ('bolam_zoom', 'tp12h', 'Precipitazione 12 h + geopotenziale 500 hPa')


def leggi(url, binario=False):
    req = urllib.request.Request(url, headers={'User-Agent': 'bollettino-meteo/1.0'})
    for tentativo in range(3):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                dati = r.read()
            return dati if binario else dati.decode('utf-8', 'replace')
        except Exception:
            if tentativo == 2:
                raise


def ultima_corsa(modello):
    """Corsa più recente (AAAAMMGGHH) pubblicata per il modello."""
    oggi = dt.datetime.now(dt.timezone.utc).date()
    for giorni_fa in range(3):
        giorno = (oggi - dt.timedelta(days=giorni_fa)).strftime('%Y%m%d')
        pagina = leggi(f'{BASE}/{giorno}/')
        corse = sorted(set(re.findall(rf'/visualizzatore-modelli/(\d{{10}})/{modello}/', pagina)))
        if corse:
            return corse[-1]
    return None


def slug_variabili(corsa, modello):
    pagina = leggi(f'{BASE}/{corsa}/{modello}/')
    return re.findall(rf'/visualizzatore-modelli/{corsa}/{modello}/_([^/"]+)/', pagina)


def immagini(corsa, modello, slug):
    """{scadenza: url} delle mappe a piena risoluzione."""
    pagina = leggi(f'{BASE}/{corsa}/{modello}/_{slug}/')
    out = {}
    for path in re.findall(r'"(/visualizzatore-modelli/data/models/[^"]+\.webp)"', pagina):
        if '/thumbs/' in path:
            continue
        m = re.search(rf'{modello}_{corsa}_(\d+)_', path)
        if m:
            out[int(m.group(1))] = 'https://cmi-servizi.arpal.liguria.it' + path
    return dict(sorted(out.items()))


def pixel(lat, lon):
    x = X0 + (lon - LON0) / (LON1 - LON0) * (X1 - X0)
    y = Y0 + (lat - LAT0) / (LAT1 - LAT0) * (Y1 - Y0)
    return x, y


def validita(corsa, scadenza):
    t0 = dt.datetime.strptime(corsa, '%Y%m%d%H').replace(tzinfo=dt.timezone.utc)
    return (t0 + dt.timedelta(hours=scadenza)).astimezone(ROMA)


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10.1
        return ImageFont.load_default()


def mirino(draw, x, y):
    for r, colore, spessore in ((9, 'white', 4), (9, 'black', 2)):
        draw.ellipse([x - r, y - r, x + r, y + r], outline=colore, width=spessore)
    for dx, dy in ((1, 0), (0, 1)):
        draw.line([x - 15 * dx, y - 15 * dy, x - 10 * dx, y - 10 * dy], fill='black', width=2)
        draw.line([x + 10 * dx, y + 10 * dy, x + 15 * dx, y + 15 * dy], fill='black', width=2)


def tavola_locale(fotogrammi, corsa, citta, titolo, modello):
    """Fotogrammi ritagliati sulla località in griglia + scala colori."""
    cx, cy = pixel(citta['lat'], citta['lon'])
    x0, y1 = pixel(citta['lat'] - MEZZA_LAT, citta['lon'] - MEZZA_LON)
    x1, y0 = pixel(citta['lat'] + MEZZA_LAT, citta['lon'] + MEZZA_LON)
    box = tuple(round(v) for v in (x0, y0, x1, y1))
    w = round((box[2] - box[0]) * INGRANDIMENTO)
    h = round((box[3] - box[1]) * INGRANDIMENTO)
    etichetta = 22

    righe = -(-len(fotogrammi) // COLONNE)
    primo = next(iter(fotogrammi.values()))
    scala = primo.crop(SCALA_COLORI)
    testa = 34
    tav = Image.new('RGB', (COLONNE * w + scala.width + 10, testa + righe * (h + etichetta)), 'white')
    d = ImageDraw.Draw(tav)
    d.text((6, 6), f'{modello.split("_")[0].upper()} corsa {corsa[8:]} UTC {corsa[6:8]}/{corsa[4:6]} - '
                   f'{titolo} - {citta["nome"]} (mirino)', fill='black', font=font(16))

    for i, (scad, im) in enumerate(fotogrammi.items()):
        col, riga = i % COLONNE, i // COLONNE
        px, py = col * w, testa + riga * (h + etichetta)
        pezzo = im.crop(box).resize((w, h), Image.LANCZOS)
        tav.paste(pezzo, (px, py + etichetta))
        mirino(ImageDraw.Draw(tav), px + (cx - box[0]) * INGRANDIMENTO,
               py + etichetta + (cy - box[1]) * INGRANDIMENTO)
        v = validita(corsa, scad)
        d.text((px + 4, py + 3), f'{GIORNI[v.weekday()]} {v:%d} ore {v:%H} (+{scad}h)', fill='black', font=font(14))
        d.rectangle([px, py + etichetta, px + w - 1, py + etichetta + h - 1], outline='#888')

    tav.paste(scala, (COLONNE * w + 6, testa))
    return tav


def tavola_sinottica(fotogrammi, corsa, titolo):
    scelti = {s: im for s, im in fotogrammi.items() if s % 12 == 0}
    w, h = 512, 384
    righe = -(-len(scelti) // 2)
    tav = Image.new('RGB', (2 * w, 30 + righe * (h + 20)), 'white')
    d = ImageDraw.Draw(tav)
    d.text((6, 6), f'BOLAM corsa {corsa[8:]} UTC {corsa[6:8]}/{corsa[4:6]} - {titolo}', fill='black', font=font(16))
    for i, (scad, im) in enumerate(scelti.items()):
        px, py = (i % 2) * w, 30 + (i // 2) * (h + 20)
        tav.paste(im.resize((w, h), Image.LANCZOS), (px, py + 20))
        v = validita(corsa, scad)
        d.text((px + 4, py + 2), f'{GIORNI[v.weekday()]} {v:%d} ore {v:%H} (+{scad}h)', fill='black', font=font(14))
    return tav


def scarica_tutte(urls, corsa):
    # Le scadenze già passate non servono a prevedere: se ne tiene solo una
    # (l'ultima prima di adesso) come stato di partenza.
    adesso = dt.datetime.now(ROMA)
    passate = [s for s in urls if validita(corsa, s) <= adesso]
    urls = {s: u for s, u in urls.items() if s not in passate[:-1]}
    with cf.ThreadPoolExecutor(8) as ex:
        dati = dict(zip(urls, ex.map(lambda u: leggi(u, binario=True), urls.values())))
    return {s: Image.open(io.BytesIO(dati[s])).convert('RGB') for s in urls}


def main():
    if len(sys.argv) < 2:
        sys.exit('uso: python3 arpal_modelli.py <cartella_lavoro>')
    cartella = Path(sys.argv[1])
    contesto = json.loads((cartella / 'contesto.json').read_text())
    citta = contesto['citta']
    out = cartella / 'arpal'
    out.mkdir(exist_ok=True)

    righe_md = [f'# Modelli ARPAL — {citta["nome"]}', '']
    istanti = {}  # modello -> istanti di validità disponibili (ora locale)
    for modello, variabili in VARIABILI.items():
        try:
            corsa = ultima_corsa(modello)
            if not corsa:
                raise RuntimeError('nessuna corsa negli ultimi 3 giorni')
            disponibili = slug_variabili(corsa, modello)
        except Exception as e:
            righe_md += [f'- {modello}: NON DISPONIBILE ({e})', '']
            print(f'{modello}: non disponibile ({e})')
            continue

        v0, v1 = None, None
        richieste = [(p, t) for p, t, profili in variabili if profili is None or citta['profilo'] in profili]
        if modello == SINOTTICA[0]:
            richieste.append((SINOTTICA[1], None))
        righe_md.append(f'## {modello.split("_")[0].upper()} — corsa {corsa}')
        for prefisso, titolo in richieste:
            slug = next((s for s in disponibili if s.startswith(prefisso)), None)
            if not slug:
                righe_md.append(f'- {prefisso}: variabile non pubblicata in questa corsa')
                continue
            try:
                fotogrammi = scarica_tutte(immagini(corsa, modello, slug), corsa)
            except Exception as e:
                righe_md.append(f'- {prefisso}: download fallito ({e})')
                continue
            if not fotogrammi:
                continue
            if titolo is None:
                tav, nome = tavola_sinottica(fotogrammi, corsa, SINOTTICA[2]), f'{modello}_sinottica.png'
                titolo = SINOTTICA[2] + ' (mappe intere ogni 12 h)'
            else:
                tav, nome = tavola_locale(fotogrammi, corsa, citta, titolo, modello), f'{modello}_{prefisso}.png'
            tav.save(out / nome, optimize=True)
            scad = list(fotogrammi)
            if titolo != SINOTTICA[2] + ' (mappe intere ogni 12 h)':
                istanti.setdefault(modello.split('_')[0].upper(), set()).update(
                    validita(corsa, x) for x in scad)
            a, b = validita(corsa, scad[0]), validita(corsa, scad[-1])
            v0 = a if v0 is None or a < v0 else v0
            v1 = b if v1 is None or b > v1 else v1
            righe_md.append(f'- `{out / nome}` — {titolo}, {len(scad)} scadenze ogni 3 h')
            print(f'{modello} {prefisso}: {len(scad)} fotogrammi -> {nome}')
        if v0:
            righe_md.append(f'- copertura: dalle {v0:%H} di {GIORNI[v0.weekday()]} {v0:%d} '
                            f'alle {v1:%H} di {GIORNI[v1.weekday()]} {v1:%d} (ora locale)')
        righe_md.append('')

    (cartella / 'arpal.md').write_text('\n'.join(righe_md) + '\n')
    print(f'indice: {cartella / "arpal.md"}')
    # Riscritta a ogni esecuzione: nuove tavole, nuova lettura.
    scheda = cartella / 'arpal_note.md'
    scheda.write_text(scheda_giorni(contesto.get('giorni_previsti') or [], istanti))
    print(f'scheda da compilare: {scheda}')


def scheda_giorni(giorni, istanti):
    """Scheletro per giorno di arpal_note.md: lo compila Claude guardando le
    tavole, e da lì passa nelle descrizioni giornaliere."""
    r = ['# Lettura di BOLAM e MOLOCH, giorno per giorno', '',
         'Compila ogni giorno coperto PRIMA di scrivere testo.json: una riga per',
         'fascia di 3 h in cui cambia qualcosa sul mirino o nei dintorni',
         '(pioggia, nubi, vento, energia convettiva, massa d\'aria, temperatura).',
         'Chiudi ogni giorno con la sintesi da portare nella descrizione.', '']
    for iso in giorni:
        d = dt.date.fromisoformat(iso)
        r.append(f'## {iso} ({GIORNI[d.weekday()]} {d:%d})')
        coperto = False
        for nome, tempi in sorted(istanti.items(), reverse=True):  # MOLOCH prima
            ore = sorted(t.hour for t in tempi if t.date() == d)
            if ore:
                coperto = True
                r.append(f'- {nome}: fotogrammi alle ore {", ".join(f"{h:02d}" for h in ore)}')
        if not coperto:
            r += ['- nessun modello ARPAL copre questo giorno: niente punto BOLAM/MOLOCH nella descrizione', '']
            continue
        r += ['', '| fascia | MOLOCH | BOLAM |', '|---|---|---|', '|  |  |  |', '',
              '**Sintesi per la descrizione:** ', '']
    return '\n'.join(r) + '\n'


if __name__ == '__main__':
    main()
