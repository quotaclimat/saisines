# Saisines Arcom de QuotaClimat

Tableau public des saisines de l'Arcom déposées par QuotaClimat.
La source de vérité est la table Notion des saisines ; ce dépôt en publie une
copie filtrée (champs publics uniquement) via GitHub Pages.

## Fonctionnement

```
Notion ──(GitHub Actions, chaque jour 5h UTC)──> data/saisines.json + images/
                                                        │
                                          GitHub Pages ─┴─> saisines.js / saisines.css
                                                        │
                                   WordPress (bloc HTML personnalisé) ou index.html
```

- `sync_notion.py` interroge l'API Notion, n'exporte que les champs publics
  (Name, Media, Emission, Date, Motif, Propos tenus, Etat des connaissances scientifiques,
  Illustration, Statut, Decryptage) des lignes cochées « Public » dont le Statut est rempli, et
  télécharge les illustrations (les URL de fichiers Notion expirent après 1 h).
- Le workflow `.github/workflows/sync.yml` committe uniquement si quelque chose a changé.

## Mise en place

1. Dans Notion : créer une intégration interne (notion.so/my-integrations),
   puis sur la table « ⋯ > Connexions » ajouter cette intégration (lecture seule suffit).
2. Dans le dépôt GitHub : `Settings > Secrets and variables > Actions`
   - `NOTION_TOKEN` : le jeton de l'intégration
   - `NOTION_DATABASE_ID` : l'identifiant de 32 caractères présent dans l'URL de la table
3. `Settings > Pages` : source = branche `main`, dossier `/ (root)`.
4. Lancer le workflow une première fois via `Actions > Run workflow`.

## Intégration WordPress

Dans un bloc « HTML personnalisé » :

```html
<div data-qc-saisines></div>
<script src="https://<organisation>.github.io/<depot>/saisines.js" defer></script>
```

Le script injecte sa feuille de style (classes préfixées `qcs-`), récupère le JSON
et affiche : chiffres clés, filtres, grille de cartes, fiche détaillée. Pas d'iframe : la page hérite de la police Poppins du site.
Chaque saisine a un lien direct du type `…/page/#saisine-<id>`.

Options du conteneur : `data-src` (autre URL de JSON), `data-css="false"`
(si le thème embarque le CSS), `data-page-size="9"`.

## Statuts

Valeurs attendues dans Notion : vide (saisine non publique, jamais exportée),
En cours, Recours gracieux (refus de l'Arcom contesté par QuotaClimat), Intervention, Mise en garde, Mise en demeure, Sanction financière, Perdue.
Intervention, mise en garde, mise en demeure et sanction financière comptent
dans « Saisines gagnées » (voir `statutKey` dans `saisines.js`).

## En local

```bash
pip install -r requirements.txt
NOTION_TOKEN=... NOTION_DATABASE_ID=... python sync_notion.py
python -m http.server 8765
```

Aperçu avec des données fictives : http://localhost:8765/?demo (nécessite `data/demo.json`, non versionné).
