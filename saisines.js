/* Tableau des saisines QuotaClimat (Arcom).
 *
 * Intégration :
 *   <div data-qc-saisines></div>
 *   <script src="https://<hôte>/saisines.js" defer></script>
 *
 * Attributs optionnels sur le conteneur :
 *   data-src="…/saisines.json"   source des données (défaut : data/saisines.json à côté du script)
 *   data-css="false"             ne pas injecter saisines.css (si le thème l'embarque déjà)
 *   data-page-size="9"           nombre de cartes affichées par « Voir plus »
 */
(function () {
  "use strict";

  var SCRIPT = document.currentScript;
  var BASE = SCRIPT ? new URL(".", SCRIPT.src).href : new URL(".", location.href).href;

  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
    "août", "septembre", "octobre", "novembre", "décembre"];

  // Issues considérées comme « saisine gagnée », dans l'ordre d'affichage.
  var WON = [
    { key: "intervention", label: "Interventions", always: true },
    { key: "garde", label: "Mises en garde", always: true },
    { key: "demeure", label: "Mises en demeure", always: true },
    { key: "sanction", label: "Sanctions financières", always: true }
  ];

  /* ------------------------------------------------------------ utils --- */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function h(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // Statuts Notion : En cours, Recours gracieux, Intervention, Mise en garde, Mise en demeure,
  // Sanction financière, Perdue (vide = saisine non publique, filtrée à la synchro).
  function statutKey(statut) {
    var s = norm(statut);
    if (!s) return "";
    if (/recours/.test(s)) return "recours";
    if (/cours/.test(s)) return "encours";
    if (/sanction/.test(s)) return "sanction";
    if (/demeure/.test(s)) return "demeure";
    if (/garde/.test(s)) return "garde";
    if (/intervention/.test(s)) return "intervention";
    if (/perdu/.test(s)) return "perdue";
    return "autre";
  }
  function isWon(key) {
    return WON.some(function (w) { return w.key === key; });
  }

  // Les dates Notion arrivent en "2026-01-13" ou "2026-01-13T10:00:00.000+01:00" :
  // on lit les composantes telles quelles pour garder l'heure de diffusion.
  function fmtDate(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(d || "");
    if (!m) return "";
    var out = (+m[3]) + " " + MOIS[+m[2] - 1] + " " + m[1];
    if (m[4] && !(m[4] === "00" && m[5] === "00")) out += " · " + m[4] + ":" + m[5];
    return out;
  }
  function year(d) { return (d || "").slice(0, 4); }

  function metaLine(s) {
    return [s.media && "<strong>" + esc(s.media) + "</strong>", esc(s.emission), esc(fmtDate(s.date))]
      .filter(Boolean).join(" · ");
  }

  function badge(s) {
    if (!s.statut) return "";
    return '<span class="qcs-badge qcs-badge--' + statutKey(s.statut) + '">' + esc(s.statut) + "</span>";
  }

  function thumb(s, dataUrl) {
    if (s.illustration) {
      var src = new URL(s.illustration, dataUrl).href;
      return '<div class="qcs-thumb"><img src="' + esc(src) + '" alt="" loading="lazy" decoding="async"></div>';
    }
    return '<div class="qcs-thumb"><span class="qcs-thumb-empty">' + esc(s.media || "QuotaClimat") + "</span></div>";
  }

  function uniq(arr) {
    return arr.filter(function (v, i) { return v && arr.indexOf(v) === i; });
  }
  function countBy(list, fn) {
    var c = {};
    list.forEach(function (x) { var k = fn(x); if (k) c[k] = (c[k] || 0) + 1; });
    return c;
  }

  /* ------------------------------------------------------------ widget --- */

  function mount(root) {
    if (root.__qcsMounted) return;
    root.__qcsMounted = true;
    root.classList.add("qcs-root");

    if (root.getAttribute("data-css") !== "false" && !document.querySelector("link[data-qcs-css]")) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = BASE + "saisines.css";
      link.setAttribute("data-qcs-css", "");
      document.head.appendChild(link);
    }

    var dataUrl = new URL(root.getAttribute("data-src") || "data/saisines.json", BASE).href;
    var pageSize = parseInt(root.getAttribute("data-page-size"), 10) || 9;

    root.innerHTML = '<div class="qcs-loading">Chargement des saisines…</div>';

    fetch(dataUrl, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { render(root, data, dataUrl, pageSize); })
      .catch(function () {
        root.innerHTML = '<div class="qcs-error">Impossible de charger les saisines. Réessayez plus tard.</div>';
      });
  }

  function render(root, data, dataUrl, pageSize) {
    var all = (data.saisines || []).slice().sort(function (a, b) {
      return (b.date || "").localeCompare(a.date || "");
    });
    var state = { year: "", media: "", statut: "", shown: pageSize };

    /* ---- Chiffres clés ---- */
    var byMedia = countBy(all, function (s) { return s.media; });
    var mediaRows = Object.keys(byMedia).sort(function (a, b) {
      return byMedia[b] - byMedia[a] || a.localeCompare(b, "fr");
    });
    var byStatut = countBy(all, function (s) { return statutKey(s.statut); });
    var wonTotal = all.filter(function (s) { return isWon(statutKey(s.statut)); }).length;
    var wonRows = WON.filter(function (w) { return w.always || byStatut[w.key]; });

    function li(k, v) {
      return '<li><span class="qcs-k">' + esc(k) + '</span><span class="qcs-v">' + v + "</span></li>";
    }

    var statsHtml =
      '<section class="qcs-section">' +
        '<h2 class="qcs-h2">Les saisines réalisées par QuotaClimat</h2>' +
        '<div class="qcs-stats">' +
          '<div class="qcs-stat">' +
            '<div class="qcs-stat-total">' + all.length + "</div>" +
            '<div class="qcs-stat-label">Saisine' + (all.length > 1 ? "s" : "") + " réalisée" + (all.length > 1 ? "s" : "") + "</div>" +
            '<ul class="qcs-stat-list">' + mediaRows.map(function (m) { return li(m, byMedia[m]); }).join("") + "</ul>" +
          "</div>" +
          '<div class="qcs-stat qcs-stat--won">' +
            '<div class="qcs-stat-total">' + wonTotal + "</div>" +
            '<div class="qcs-stat-label">Saisine' + (wonTotal > 1 ? "s" : "") + " gagnée" + (wonTotal > 1 ? "s" : "") + "</div>" +
            '<ul class="qcs-stat-list">' + wonRows.map(function (w) { return li(w.label, byStatut[w.key] || 0); }).join("") + "</ul>" +
          "</div>" +
        "</div>" +
        (data.last_updated ? '<p class="qcs-updated">Données mises à jour le ' + esc(fmtDate(data.last_updated)) + "</p>" : "") +
      "</section>";

    /* ---- Filtres ---- */
    var years = uniq(all.map(function (s) { return year(s.date); })).sort().reverse();
    var medias = uniq(all.map(function (s) { return s.media; })).sort(function (a, b) { return a.localeCompare(b, "fr"); });
    // Statuts dans l'ordre du parcours d'une saisine, les inconnus en fin de liste.
    var ORDER = ["encours", "recours", "intervention", "garde", "demeure", "sanction", "perdue", "autre"];
    var statuts = uniq(all.map(function (s) { return s.statut; })).sort(function (a, b) {
      return ORDER.indexOf(statutKey(a)) - ORDER.indexOf(statutKey(b)) || a.localeCompare(b, "fr");
    });
    var statutOptions = (wonTotal ? [["__gagnee", "Saisines gagnées (toutes)"]] : [])
      .concat(statuts.map(function (v) { return [v, v]; }));

    function select(name, label, allLabel, values) {
      return '<div class="qcs-filter"><label for="qcs-f-' + name + '">' + label + "</label>" +
        '<select id="qcs-f-' + name + '" data-f="' + name + '"><option value="">' + allLabel + "</option>" +
        values.map(function (v) {
          var val = Array.isArray(v) ? v[0] : v, lab = Array.isArray(v) ? v[1] : v;
          return '<option value="' + esc(val) + '">' + esc(lab) + "</option>";
        }).join("") +
        "</select></div>";
    }

    var listHtml =
      '<section class="qcs-section">' +
        '<h2 class="qcs-h2">Nos saisines</h2>' +
        '<div class="qcs-filters">' +
          select("year", "Date", "Toutes les années", years) +
          select("media", "Média", "Tous les médias", medias) +
          select("statut", "Type", "Tous les types", statutOptions) +
          '<button type="button" class="qcs-reset">Réinitialiser</button>' +
          '<span class="qcs-count" aria-live="polite"></span>' +
        "</div>" +
        '<div class="qcs-grid"></div>' +
        '<div class="qcs-more-wrap"><button type="button" class="qcs-btn qcs-btn--ghost qcs-more">Voir plus</button></div>' +
      "</section>";

    var demoHtml = data.demo
      ? '<div class="qcs-error" style="padding:.75rem;margin-bottom:1.5rem;border:1px dashed currentColor;border-radius:.5rem">' +
        "Données fictives de démonstration : la synchronisation Notion n’est pas encore branchée.</div>"
      : "";

    root.innerHTML = demoHtml + statsHtml + listHtml;

    var grid = root.querySelector(".qcs-grid");
    var more = root.querySelector(".qcs-more");
    var count = root.querySelector(".qcs-count");
    var dialog = buildDialog(root);

    function filtered() {
      return all.filter(function (s) {
        return (!state.year || year(s.date) === state.year) &&
          (!state.media || s.media === state.media) &&
          (!state.statut || (state.statut === "__gagnee" ? isWon(statutKey(s.statut)) : s.statut === state.statut));
      });
    }

    function draw() {
      var list = filtered();
      var visible = list.slice(0, state.shown);
      count.textContent = list.length + " saisine" + (list.length > 1 ? "s" : "");
      grid.innerHTML = visible.length ? "" : '<div class="qcs-empty">Aucune saisine ne correspond à ces filtres.</div>';
      visible.forEach(function (s) {
        var card = h(
          '<button type="button" class="qcs-card" aria-haspopup="dialog">' +
            '<div class="qcs-card-top">' + badge(s) + "</div>" +
            '<span class="qcs-card-title">' + esc(s.name) + "</span>" +
            thumb(s, dataUrl) +
            '<p class="qcs-meta">' + metaLine(s) + "</p>" +
          "</button>");
        card.addEventListener("click", function () { dialog.open(s, card); });
        grid.appendChild(card);
      });
      more.parentElement.hidden = list.length <= state.shown;
    }

    root.querySelectorAll("select[data-f]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        state[sel.getAttribute("data-f")] = sel.value;
        state.shown = pageSize;
        draw();
      });
    });
    root.querySelector(".qcs-reset").addEventListener("click", function () {
      state.year = state.media = state.statut = "";
      state.shown = pageSize;
      root.querySelectorAll("select[data-f]").forEach(function (sel) { sel.value = ""; });
      draw();
    });
    more.addEventListener("click", function () {
      var firstNew = state.shown;
      state.shown += pageSize;
      draw();
      var next = grid.children[firstNew];
      if (next) next.focus({ preventScroll: true });
    });

    draw();

    // Lien direct vers une saisine : …#saisine-<id>
    function openFromHash() {
      var m = /^#saisine-([\w-]+)$/.exec(location.hash);
      if (!m) return;
      var s = all.filter(function (x) { return x.id === m[1]; })[0];
      if (s) dialog.open(s, null);
    }
    openFromHash();
    window.addEventListener("hashchange", openFromHash);

    function buildDialog() {
      var dlg = h('<dialog class="qcs-dialog qcs-root" aria-labelledby="qcs-dlg-title"></dialog>');
      document.body.appendChild(dlg);
      var opener = null;

      dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
      dlg.addEventListener("close", function () {
        if (/^#saisine-/.test(location.hash)) {
          history.replaceState(null, "", location.pathname + location.search);
        }
        if (opener) opener.focus();
      });

      function acc(title, html, extraClass) {
        if (!html) return "";
        return '<details class="qcs-acc ' + (extraClass || "") + '" open><summary>' + title + "</summary>" +
          '<div class="qcs-acc-content">' + html + "</div></details>";
      }

      return {
        open: function (s, from) {
          opener = from;
          var dec = "";
          if (s.decryptage_url) {
            dec = '<a class="qcs-btn" href="' + esc(s.decryptage_url) + '" target="_blank" rel="noopener">Lire notre analyse</a>';
          }
          dlg.innerHTML =
            '<button type="button" class="qcs-close" aria-label="Fermer">×</button>' +
            '<div class="qcs-dialog-scroll">' +
              thumb(s, dataUrl) +
              '<div class="qcs-dialog-body">' +
                '<div class="qcs-dialog-meta">' + badge(s) + "<span>" + metaLine(s) + "</span></div>" +
                '<h3 class="qcs-dialog-title" id="qcs-dlg-title">' + esc(s.name) + "</h3>" +
                (s.motif ? '<p class="qcs-dialog-motif">' + esc(s.motif) + "</p>" : "") +
                acc("Propos tenus", s.propos_html, "qcs-acc--quote") +
                acc("État des connaissances scientifiques", s.science_html) +
                acc("Notre décryptage", s.decryptage_html) +
                (dec ? '<div class="qcs-dialog-foot">' + dec + "</div>" : "") +
              "</div>" +
            "</div>";
          dlg.querySelector(".qcs-close").addEventListener("click", function () { dlg.close(); });
          if (!dlg.open) dlg.showModal();
          dlg.querySelector(".qcs-dialog-scroll").scrollTop = 0;
          if (s.id && location.hash !== "#saisine-" + s.id) {
            history.replaceState(null, "", "#saisine-" + s.id);
          }
        }
      };
    }
  }

  function init() {
    document.querySelectorAll("[data-qc-saisines]").forEach(mount);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
