"""Synchronise la table Notion des saisines vers data/saisines.json.

N'exporte QUE les champs publics listés dans FIELDS (les autres colonnes
de la table Notion ne quittent jamais Notion).
Les illustrations sont téléchargées dans images/ car les URL de fichiers
Notion expirent au bout d'une heure.

Variables d'environnement :
  NOTION_TOKEN         jeton de l'intégration Notion (secret)
  NOTION_DATABASE_ID   identifiant de la base (32 caractères hex)
"""

import hashlib
import io
import json
import os
import re
import sys
from datetime import datetime, timezone
from html import escape
from pathlib import Path

import requests

try:
    from PIL import Image
except ImportError:  # redimensionnement optionnel
    Image = None

ROOT = Path(__file__).parent
OUT_JSON = ROOT / "data" / "saisines.json"
IMG_DIR = ROOT / "images"
IMG_MAX_WIDTH = 1200

NOTION_VERSION = "2022-06-28"

# Clé JSON -> nom de la colonne Notion. Les champs marqués optionnels
# peuvent ne pas exister dans la table.
FIELDS = {
    "name": "Name",
    "media": "Media",
    "emission": "Emission",
    "date": "Date",
    "propos": "Propos tenus",
    "science": "Etat des connaissances scientifiques",
    "illustration": "Illustration",
    "statut": "Statut",
    "decryptage": "Decryptage",
    "instance": "Type",   # Arcom / CDJM
    "motif": "Motif",
}
REQUIRED = {"name", "media", "date", "statut"}

# Case à cocher : seules les lignes cochées sont publiées.
PUBLISH_FIELD = "Public"


# ---------------------------------------------------------------- Notion ---

def notion_query(token, database_id):
    url = f"https://api.notion.com/v1/databases/{database_id}/query"
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }
    body = {"page_size": 100}
    if PUBLISH_FIELD:
        body["filter"] = {"property": PUBLISH_FIELD, "checkbox": {"equals": True}}
    while True:
        r = requests.post(url, headers=headers, json=body, timeout=60)
        if r.status_code != 200:
            sys.exit(f"Erreur Notion {r.status_code} : {r.text[:500]}")
        data = r.json()
        yield from data["results"]
        if not data.get("has_more"):
            break
        body["start_cursor"] = data["next_cursor"]


def rich_text_to_html(parts):
    """Rich text Notion -> HTML minimal et sûr (gras, italique, liens, sauts de ligne)."""
    out = []
    for p in parts or []:
        txt = escape(p.get("plain_text", "")).replace("\n", "<br>")
        ann = p.get("annotations", {})
        if ann.get("bold"):
            txt = f"<strong>{txt}</strong>"
        if ann.get("italic"):
            txt = f"<em>{txt}</em>"
        href = p.get("href")
        if href and href.startswith(("http://", "https://")):
            txt = f'<a href="{escape(href)}" target="_blank" rel="noopener">{txt}</a>'
        out.append(txt)
    return "".join(out)


def plain(parts):
    return "".join(p.get("plain_text", "") for p in parts or []).strip()


def prop(page, name):
    return page["properties"].get(name)


def as_text(p):
    if not p:
        return ""
    t = p["type"]
    if t in ("title", "rich_text"):
        return plain(p[t])
    if t in ("select", "status"):
        return (p[t] or {}).get("name", "")
    if t == "multi_select":
        return ", ".join(o["name"] for o in p[t])
    if t == "url":
        return p[t] or ""
    if t == "formula":
        f = p[t]
        return str(f.get(f["type"]) or "")
    return ""


def as_html(p):
    if p and p["type"] in ("title", "rich_text"):
        return rich_text_to_html(p[p["type"]])
    return escape(as_text(p))


def as_date(p):
    if not p or p["type"] != "date" or not p["date"]:
        return ""
    return p["date"]["start"]  # "2026-01-13" ou "2026-01-13T10:00:00.000+01:00"


def as_files(p):
    if not p or p["type"] != "files":
        return []
    urls = []
    for f in p["files"]:
        if f["type"] == "file":
            urls.append(f["file"]["url"])
        elif f["type"] == "external":
            urls.append(f["external"]["url"])
    return urls


def as_link(p):
    """Décryptage : colonne URL, ou texte contenant un lien."""
    if not p:
        return "", ""
    if p["type"] == "url":
        return p["url"] or "", ""
    if p["type"] in ("rich_text", "title"):
        parts = p[p["type"]]
        href = next((x["href"] for x in parts if x.get("href")), "")
        text = plain(parts)
        if not href and re.match(r"^https?://\S+$", text):
            href, text = text, ""
        return href, rich_text_to_html(parts) if text and not href else ""
    return "", ""


# ---------------------------------------------------------------- Images ---

def download_image(url, page_id):
    """Télécharge une image, la redimensionne, renvoie le chemin relatif."""
    key = hashlib.sha1(url.split("?")[0].encode()).hexdigest()[:10]
    stem = f"{page_id.replace('-', '')[:12]}-{key}"
    existing = list(IMG_DIR.glob(stem + ".*"))
    if existing:
        return f"images/{existing[0].name}"
    try:
        r = requests.get(url, timeout=60)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"  ! image non récupérée ({e})")
        return ""
    IMG_DIR.mkdir(exist_ok=True)
    if Image is not None:
        try:
            im = Image.open(io.BytesIO(r.content))
            im = im.convert("RGB")
            if im.width > IMG_MAX_WIDTH:
                im = im.resize((IMG_MAX_WIDTH, round(im.height * IMG_MAX_WIDTH / im.width)))
            path = IMG_DIR / f"{stem}.jpg"
            im.save(path, "JPEG", quality=82, optimize=True, progressive=True)
            return f"images/{path.name}"
        except Exception as e:  # format non géré par Pillow : on garde le fichier brut
            print(f"  ! redimensionnement impossible ({e})")
    ext = {"image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}.get(
        r.headers.get("content-type", "").split(";")[0], ".jpg")
    path = IMG_DIR / f"{stem}{ext}"
    path.write_bytes(r.content)
    return f"images/{path.name}"


# ------------------------------------------------------------------ Main ---

def main():
    token = os.environ.get("NOTION_TOKEN")
    database_id = os.environ.get("NOTION_DATABASE_ID", "").replace("-", "")
    if not token or not database_id:
        sys.exit("NOTION_TOKEN et NOTION_DATABASE_ID sont requis.")

    pages = list(notion_query(token, database_id))
    print(f"{len(pages)} lignes récupérées depuis Notion")
    if pages:
        missing = [FIELDS[k] for k in REQUIRED if FIELDS[k] not in pages[0]["properties"]]
        if missing:
            sys.exit(f"Colonnes introuvables dans Notion : {missing}. "
                     f"Colonnes disponibles : {sorted(pages[0]['properties'])}")

    saisines, used_images = [], set()
    for page in pages:
        name = as_text(prop(page, FIELDS["name"]))
        statut = as_text(prop(page, FIELDS["statut"]))
        # Statut vide = saisine pas encore publique, même si « Public » est coché.
        if not name or not statut:
            continue
        images = []
        for url in as_files(prop(page, FIELDS["illustration"])):
            path = download_image(url, page["id"])
            if path:
                images.append(path)
                used_images.add(Path(path).name)
        decryptage_url, decryptage_html = as_link(prop(page, FIELDS["decryptage"]))
        saisines.append({
            "id": page["id"].replace("-", "")[:12],
            "name": name,
            "media": as_text(prop(page, FIELDS["media"])),
            "emission": as_text(prop(page, FIELDS["emission"])),
            "date": as_date(prop(page, FIELDS["date"])),
            "instance": as_text(prop(page, FIELDS["instance"])),
            "statut": statut,
            "motif": as_text(prop(page, FIELDS["motif"])),
            "propos_html": as_html(prop(page, FIELDS["propos"])),
            "science_html": as_html(prop(page, FIELDS["science"])),
            "illustration": images[0] if images else "",
            "decryptage_url": decryptage_url,
            "decryptage_html": decryptage_html,
        })

    saisines.sort(key=lambda s: s["date"], reverse=True)

    # Nettoyage des images qui ne sont plus référencées
    if IMG_DIR.exists():
        for f in IMG_DIR.iterdir():
            if f.is_file() and f.name not in used_images and f.name != ".gitkeep":
                f.unlink()

    # On ne change la date de mise à jour que si le contenu a changé,
    # pour éviter un commit quotidien vide.
    last_updated = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if OUT_JSON.exists():
        old = json.loads(OUT_JSON.read_text(encoding="utf-8"))
        if old.get("saisines") == saisines:
            last_updated = old.get("last_updated", last_updated)

    OUT_JSON.parent.mkdir(exist_ok=True)
    payload = {
        "last_updated": last_updated,
        "saisines": saisines,
    }
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(saisines)} saisines écrites dans {OUT_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
