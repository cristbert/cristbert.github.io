/*
 * Panel de configuración remota de Netsus.
 *
 * Lee y publica los parámetros `ui_overrides`, `posts_feed_disabled` y `announcements` de
 * Firebase Remote Config a través de la edge function `admin-remote-config`.
 *
 * El panel NO habla con Google directamente: las credenciales de servicio con permiso de
 * escritura no pueden vivir en un navegador. La edge function las guarda y valida que quien
 * llama es admin. El gate de esta página es cosmético; el control real está en el servidor.
 */
(function () {
  "use strict";

  const FUNCTION_URL =
    "https://ifvxhywcfxsobupctezb.supabase.co/functions/v1/admin-remote-config";

  const sb = window.NetsusSupabase;

  const els = {
    gate: document.getElementById("gate"),
    content: document.getElementById("content"),
    authChip: document.getElementById("authChip"),
    reloadButton: document.getElementById("reloadButton"),
    statusText: document.getElementById("statusText"),
    rollbackButton: document.getElementById("rollbackButton"),
    postsFeedDisabled: document.getElementById("postsFeedDisabled"),
    obsoleteCard: document.getElementById("obsoleteCard"),
    obsoleteList: document.getElementById("obsoleteList"),
    cleanObsoleteButton: document.getElementById("cleanObsoleteButton"),
    groups: document.getElementById("groups"),
    announcementList: document.getElementById("announcementList"),
    announcementEmpty: document.getElementById("announcementEmpty"),
    announcementJson: document.getElementById("announcementJson"),
    addAnnouncementButton: document.getElementById("addAnnouncementButton"),
    preview: document.getElementById("preview"),
    publishButton: document.getElementById("publishButton"),
    publishMessage: document.getElementById("publishMessage")
  };

  const state = {
    session: null,
    catalog: [],
    /** ETag de la plantilla leída. Se manda al publicar para no pisar cambios ajenos. */
    etag: null,
    version: null,
    /** Overrides en edición: { id: {hidden, label_es, label_en} } */
    overrides: {},
    /** Copia de lo último publicado, para el rollback. */
    previousJson: null,
    previousAnnouncementsJson: null,
    obsolete: [],
    /** Avisos en edición, en el orden en que se publicarán. */
    announcements: [],
    /** Idioma y tema con los que se dibuja la vista previa. No se publican. */
    previewLanguage: "es",
    previewDark: true
  };

  const preview = window.NetsusAnnouncementPreview;

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  function gateMessage(title, body, action) {
    els.gate.hidden = false;
    els.content.hidden = true;
    let html = "<h2>" + escapeHtml(title) + "</h2><p class=\"detail-note\">" +
      escapeHtml(body) + "</p>";
    if (action) {
      html += "<p><a class=\"primary-button\" href=\"" + action.href + "\">" +
        escapeHtml(action.label) + "</a></p>";
    }
    els.gate.innerHTML = html;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function message(text, kind) {
    els.publishMessage.textContent = text || "";
    els.publishMessage.className = "detail-note" + (kind ? " panel-" + kind : "");
  }

  // -------------------------------------------------------------------------
  // Llamadas a la edge function
  // -------------------------------------------------------------------------

  async function callFunction(method, body) {
    const token = (await sb.client.auth.getSession()).data?.session?.access_token;
    if (!token) throw new Error("sesión caducada, vuelve a iniciar sesión");

    const response = await fetch(FUNCTION_URL, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        apikey: sb.anonKey,
        Authorization: "Bearer " + token
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const payload = await response.json().catch(function () {
      return {};
    });
    if (!response.ok) {
      const error = new Error(payload.error || "error " + response.status);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  // -------------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------------

  async function loadCatalog() {
    const response = await fetch("action-catalog.json?v=" + Date.now());
    if (!response.ok) throw new Error("no se pudo cargar el catálogo de acciones");
    const data = await response.json();
    state.catalog = data.actions || [];
    // Generado del build.gradle.kts, no escrito a mano: el panel dice "a quién le llega" cada
    // aviso, y un número obsoleto ahí sería una mentira difícil de detectar.
    state.appVersionCode = data.app?.versionCode ?? null;
    state.appVersionName = data.app?.versionName ?? null;
  }

  async function loadTemplate() {
    const data = await callFunction("GET");
    state.etag = data.etag;
    state.version = data.version;

    const params = data.parameters || {};
    const rawOverrides = params.ui_overrides?.defaultValue?.value ?? "{}";
    state.previousJson = rawOverrides;

    let parsed = {};
    try {
      parsed = JSON.parse(rawOverrides) || {};
    } catch (error) {
      // La app también cae a {} ante un JSON roto, así que el panel muestra lo mismo que ve
      // la app en lugar de fingir que el texto inválido es configuración válida.
      message("El JSON guardado en Firebase no es válido; se muestra vacío.", "warn");
      parsed = {};
    }

    state.overrides = {};
    const knownIds = new Set(state.catalog.map(function (a) { return a.id; }));
    state.obsolete = [];

    Object.keys(parsed).forEach(function (id) {
      const entry = parsed[id] || {};
      const label = entry.label;
      state.overrides[id] = {
        hidden: entry.hidden === true,
        label_es: typeof label === "string" ? label : (label?.es ?? ""),
        label_en: typeof label === "string" ? "" : (label?.en ?? "")
      };
      if (!knownIds.has(id)) state.obsolete.push(id);
    });

    const feed = params.posts_feed_disabled?.defaultValue?.value;
    els.postsFeedDisabled.checked = feed === "true" || feed === true;

    const rawAnnouncements = params.announcements?.defaultValue?.value ?? "[]";
    state.previousAnnouncementsJson = rawAnnouncements;
    state.announcements = parseAnnouncements(rawAnnouncements);

    const versionLabel = state.version?.versionNumber
      ? "versión " + state.version.versionNumber
      : "sin versión previa";
    const updatedBy = state.version?.updateUser?.email;
    els.statusText.textContent = versionLabel +
      (updatedBy ? " · última publicación de " + updatedBy : "") +
      " · " + Object.keys(state.overrides).length + " override(s) activos";

    els.rollbackButton.disabled = !state.version?.versionNumber;
  }

  // -------------------------------------------------------------------------
  // Avisos
  // -------------------------------------------------------------------------

  /**
   * Lee el JSON publicado y lo pasa a la forma que edita el panel: los textos por idioma se
   * aplanan a campos (title_es, title_en...) porque un formulario con inputs planos es lo que se
   * puede editar, y se vuelven a plegar al publicar.
   *
   * Lo desconocido se PRESERVA en `extra`: si una versión futura del APK añade un campo y alguien
   * lo publica a mano, abrir este panel no debe borrárselo.
   */
  function parseAnnouncements(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      message("El JSON de avisos guardado en Firebase no es válido; se muestra vacío.", "warn");
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(function (entry) {
        return entry && typeof entry === "object" && !Array.isArray(entry);
      })
      .map(function (entry) {
        const action = entry.action && typeof entry.action === "object" ? entry.action : {};
        const known = new Set([
          "id", "format", "theme", "title", "body", "dismissible",
          "minVersionCode", "maxVersionCode", "action"
        ]);
        const extra = {};
        Object.keys(entry).forEach(function (key) {
          if (!known.has(key)) extra[key] = entry[key];
        });

        return {
          id: typeof entry.id === "string" ? entry.id : "",
          format: entry.format === "modal" ? "modal" : "banner",
          theme: preview.themes[entry.theme] ? entry.theme : "info",
          title_es: entry.title?.es ?? "",
          title_en: entry.title?.en ?? "",
          body_es: entry.body?.es ?? "",
          body_en: entry.body?.en ?? "",
          dismissible: entry.dismissible !== false,
          minVersionCode:
            typeof entry.minVersionCode === "number" ? String(entry.minVersionCode) : "",
          maxVersionCode:
            typeof entry.maxVersionCode === "number" ? String(entry.maxVersionCode) : "",
          actionKind: typeof action.kind === "string" ? action.kind : "",
          actionLabel_es: action.label?.es ?? "",
          actionLabel_en: action.label?.en ?? "",
          actionUrl: typeof action.url === "string" ? action.url : "",
          extra: extra
        };
      });
  }

  /** Plega un aviso del formulario al JSON que entiende la app. Omite todo lo vacío. */
  function buildAnnouncement(entry) {
    const out = Object.assign({}, entry.extra);
    out.id = (entry.id || "").trim();
    out.format = entry.format;
    out.theme = entry.theme;

    const title = localized(entry.title_es, entry.title_en);
    const body = localized(entry.body_es, entry.body_en);
    if (title) out.title = title;
    if (body) out.body = body;

    // Solo se escribe cuando es false: el default de la app ya es true, y así el JSON publicado
    // se mantiene mínimo y legible.
    if (!entry.dismissible) out.dismissible = false;

    const min = parseInt(entry.minVersionCode, 10);
    const max = parseInt(entry.maxVersionCode, 10);
    if (Number.isInteger(min)) out.minVersionCode = min;
    if (Number.isInteger(max)) out.maxVersionCode = max;

    if (entry.actionKind) {
      const action = { kind: entry.actionKind };
      const label = localized(entry.actionLabel_es, entry.actionLabel_en);
      if (label) action.label = label;
      if (entry.actionKind === "url") action.url = (entry.actionUrl || "").trim();
      out.action = action;
    }
    return out;
  }

  function localized(es, en) {
    const spanish = (es || "").trim();
    const english = (en || "").trim();
    if (!spanish && !english) return null;
    const out = {};
    if (spanish) out.es = spanish;
    if (english) out.en = english;
    return out;
  }

  function buildAnnouncements() {
    return state.announcements.map(buildAnnouncement);
  }

  /**
   * Problemas que impedirían publicar, o que harían que el aviso no se viese.
   *
   * Se comprueba en el panel además de en la edge function porque aquí se puede señalar el campo
   * concreto mientras se escribe; el servidor sigue siendo el que decide.
   */
  function announcementProblems(entry, allIds) {
    const problems = [];
    const id = (entry.id || "").trim();
    if (!id) {
      problems.push("Necesita un id (es lo que recuerda que el usuario ya lo cerró).");
    } else if (allIds.filter(function (other) { return other === id; }).length > 1) {
      problems.push("El id está repetido: cerrar uno haría desaparecer el otro.");
    }

    const hasText = [entry.title_es, entry.title_en, entry.body_es, entry.body_en]
      .some(function (text) { return (text || "").trim().length > 0; });
    if (!hasText) problems.push("Necesita al menos un título o un cuerpo.");

    const min = entry.minVersionCode === "" ? null : parseInt(entry.minVersionCode, 10);
    const max = entry.maxVersionCode === "" ? null : parseInt(entry.maxVersionCode, 10);
    if (entry.minVersionCode !== "" && !Number.isInteger(min)) {
      problems.push("La versión mínima debe ser un número.");
    }
    if (entry.maxVersionCode !== "" && !Number.isInteger(max)) {
      problems.push("La versión máxima debe ser un número.");
    }
    if (Number.isInteger(min) && Number.isInteger(max) && min > max) {
      problems.push("El rango de versiones está invertido: no se lo vería nadie.");
    }

    if (entry.actionKind === "url") {
      const url = (entry.actionUrl || "").trim();
      if (!/^https?:\/\//.test(url)) {
        problems.push("El enlace debe empezar por http:// o https://");
      }
    }

    if (!entry.dismissible && !entry.actionKind) {
      problems.push(
        "Sin botón y sin poder cerrarlo, el usuario se queda atrapado. Añade una acción."
      );
    }
    return problems;
  }

  /** A quién le llega el aviso, en lenguaje llano. */
  function audienceNote(entry) {
    const min = entry.minVersionCode === "" ? null : parseInt(entry.minVersionCode, 10);
    const max = entry.maxVersionCode === "" ? null : parseInt(entry.maxVersionCode, 10);
    const current = state.appVersionCode;

    let scope;
    if (Number.isInteger(min) && Number.isInteger(max)) {
      scope = "las versiones " + min + " a " + max;
    } else if (Number.isInteger(max)) {
      scope = "la versión " + max + " y anteriores";
    } else if (Number.isInteger(min)) {
      scope = "la versión " + min + " y posteriores";
    } else {
      scope = "todas las versiones";
    }

    if (current == null) return "Se muestra a " + scope + ".";

    const reachesCurrent =
      (!Number.isInteger(min) || current >= min) && (!Number.isInteger(max) || current <= max);
    const suffix = reachesCurrent
      ? " Incluye la versión actual (" + current + ")."
      : " NO incluye la versión actual (" + current + ").";
    return "Se muestra a " + scope + "." + suffix;
  }

  function themeOptionsHtml(selected) {
    return Object.keys(preview.themes)
      .map(function (key) {
        return (
          '<option value="' + key + '"' + (selected === key ? " selected" : "") + ">" +
          escapeHtml(preview.themes[key].label) + "</option>"
        );
      })
      .join("");
  }

  function announcementRowHtml(entry, index, allIds) {
    const problems = announcementProblems(entry, allIds);
    const lastIndex = state.announcements.length - 1;

    return "" +
      '<div class="panel-ann" data-index="' + index + '">' +
        '<div class="panel-ann-head">' +
          '<input class="panel-ann-id" type="text" data-role="id" placeholder="id-del-aviso" value="' +
            escapeHtml(entry.id) + '">' +
          '<div class="panel-ann-head-actions">' +
            '<button class="secondary-button" type="button" data-role="up"' +
              (index === 0 ? " disabled" : "") + ">&uarr;</button>" +
            '<button class="secondary-button" type="button" data-role="down"' +
              (index === lastIndex ? " disabled" : "") + ">&darr;</button>" +
            '<button class="secondary-button" type="button" data-role="remove">Quitar</button>' +
          "</div>" +
        "</div>" +

        '<div class="panel-ann-grid">' +
          '<div class="panel-ann-fields">' +
            '<div class="panel-ann-row">' +
              '<label class="panel-ann-field"><span>Formato</span>' +
                '<select data-role="format">' +
                  '<option value="banner"' + (entry.format === "banner" ? " selected" : "") +
                    ">Cartel (no bloquea)</option>" +
                  '<option value="modal"' + (entry.format === "modal" ? " selected" : "") +
                    ">Ventana centrada</option>" +
                "</select>" +
              "</label>" +
              '<label class="panel-ann-field"><span>Tema</span>' +
                '<select data-role="theme">' + themeOptionsHtml(entry.theme) + "</select>" +
              "</label>" +
            "</div>" +

            '<div class="panel-ann-row">' +
              '<label class="panel-ann-field"><span>Título (ES)</span>' +
                '<input type="text" data-role="title_es" value="' +
                  escapeHtml(entry.title_es) + '"></label>' +
              '<label class="panel-ann-field"><span>Título (EN)</span>' +
                '<input type="text" data-role="title_en" value="' +
                  escapeHtml(entry.title_en) + '"></label>' +
            "</div>" +

            '<div class="panel-ann-row">' +
              '<label class="panel-ann-field"><span>Texto (ES)</span>' +
                '<textarea data-role="body_es" rows="3">' +
                  escapeHtml(entry.body_es) + "</textarea></label>" +
              '<label class="panel-ann-field"><span>Texto (EN)</span>' +
                '<textarea data-role="body_en" rows="3">' +
                  escapeHtml(entry.body_en) + "</textarea></label>" +
            "</div>" +

            '<div class="panel-ann-row">' +
              '<label class="panel-ann-field"><span>Versión mínima</span>' +
                '<input type="number" data-role="minVersionCode" placeholder="(sin límite)" value="' +
                  escapeHtml(entry.minVersionCode) + '"></label>' +
              '<label class="panel-ann-field"><span>Versión máxima</span>' +
                '<input type="number" data-role="maxVersionCode" placeholder="(sin límite)" value="' +
                  escapeHtml(entry.maxVersionCode) + '"></label>' +
            "</div>" +
            '<p class="detail-note">' + escapeHtml(audienceNote(entry)) + "</p>" +

            '<label class="panel-ann-field"><span>Botón</span>' +
              '<select data-role="actionKind">' +
                '<option value=""' + (entry.actionKind === "" ? " selected" : "") +
                  ">Sin botón</option>" +
                '<option value="dismiss"' + (entry.actionKind === "dismiss" ? " selected" : "") +
                  ">Solo cerrar</option>" +
                '<option value="store"' + (entry.actionKind === "store" ? " selected" : "") +
                  ">Abrir Play Store</option>" +
                '<option value="url"' + (entry.actionKind === "url" ? " selected" : "") +
                  ">Abrir un enlace</option>" +
              "</select>" +
            "</label>" +

            (entry.actionKind
              ? '<div class="panel-ann-row">' +
                  '<label class="panel-ann-field"><span>Texto del botón (ES)</span>' +
                    '<input type="text" data-role="actionLabel_es" placeholder="(el de la app)" value="' +
                      escapeHtml(entry.actionLabel_es) + '"></label>' +
                  '<label class="panel-ann-field"><span>Texto del botón (EN)</span>' +
                    '<input type="text" data-role="actionLabel_en" placeholder="(el de la app)" value="' +
                      escapeHtml(entry.actionLabel_en) + '"></label>' +
                "</div>"
              : "") +

            (entry.actionKind === "url"
              ? '<label class="panel-ann-field"><span>Enlace</span>' +
                  '<input type="text" data-role="actionUrl" placeholder="https://mesgot.com/..." value="' +
                    escapeHtml(entry.actionUrl) + '"></label>'
              : "") +

            '<label class="panel-flag"><input type="checkbox" data-role="dismissible"' +
              (entry.dismissible ? " checked" : "") + ">" +
              "<span><strong>Se puede cerrar</strong>" +
              '<em class="detail-note">Sin esto no hay X ni se cierra tocando fuera.</em>' +
              "</span></label>" +

            (problems.length
              ? '<ul class="panel-ann-problems">' +
                  problems.map(function (problem) {
                    return "<li>" + escapeHtml(problem) + "</li>";
                  }).join("") +
                "</ul>"
              : "") +
          "</div>" +

          '<div class="panel-ann-preview">' +
            '<div class="panel-ann-preview-bar">' +
              '<button class="secondary-button" type="button" data-role="lang">' +
                (state.previewLanguage === "es" ? "ES" : "EN") + "</button>" +
              '<button class="secondary-button" type="button" data-role="mode">' +
                (state.previewDark ? "Oscuro" : "Claro") + "</button>" +
            "</div>" +
            preview.render(buildAnnouncement(entry), {
              language: state.previewLanguage,
              dark: state.previewDark
            }) +
          "</div>" +
        "</div>" +
      "</div>";
  }

  function renderAnnouncements() {
    els.announcementEmpty.hidden = state.announcements.length > 0;
    const allIds = state.announcements.map(function (entry) {
      return (entry.id || "").trim();
    });

    els.announcementList.innerHTML = state.announcements
      .map(function (entry, index) {
        return announcementRowHtml(entry, index, allIds);
      })
      .join("");

    els.announcementJson.textContent = JSON.stringify(buildAnnouncements(), null, 2);
  }

  /**
   * Solo la vista previa, sin tocar el resto de la fila.
   *
   * Existe porque volver a pintar la fila entera en cada tecla haría perder el foco y la posición
   * del cursor mientras se escribe.
   */
  function refreshAnnouncementPreview(row, entry) {
    const container = row.querySelector(".panel-ann-preview");
    if (!container) return;
    const phone = container.querySelector(".ann-phone");
    const html = preview.render(buildAnnouncement(entry), {
      language: state.previewLanguage,
      dark: state.previewDark
    });
    if (phone) {
      phone.outerHTML = html;
    } else {
      container.insertAdjacentHTML("beforeend", html);
    }
    els.announcementJson.textContent = JSON.stringify(buildAnnouncements(), null, 2);
  }

  /** Problemas de TODOS los avisos, para bloquear la publicación antes de llamar al servidor. */
  function allAnnouncementProblems() {
    const allIds = state.announcements.map(function (entry) {
      return (entry.id || "").trim();
    });
    const problems = [];
    state.announcements.forEach(function (entry, index) {
      announcementProblems(entry, allIds).forEach(function (problem) {
        problems.push("Aviso " + (index + 1) + ": " + problem);
      });
    });
    return problems;
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  function entryFor(id) {
    if (!state.overrides[id]) {
      state.overrides[id] = { hidden: false, label_es: "", label_en: "" };
    }
    return state.overrides[id];
  }

  function render() {
    // Agrupar respetando el orden del catálogo, que viene del Dart.
    const groups = [];
    const byName = new Map();
    state.catalog.forEach(function (action) {
      if (!byName.has(action.group)) {
        const bucket = { name: action.group, actions: [] };
        byName.set(action.group, bucket);
        groups.push(bucket);
      }
      byName.get(action.group).actions.push(action);
    });

    els.groups.innerHTML = groups.map(function (group) {
      const rows = group.actions.map(function (action) {
        const entry = state.overrides[action.id] || {};
        const hidden = entry.hidden === true;
        return "" +
          "<div class=\"panel-action" + (hidden ? " is-hidden" : "") + "\" data-id=\"" +
          escapeHtml(action.id) + "\">" +
            "<label class=\"panel-action-main\">" +
              "<input type=\"checkbox\" data-role=\"hidden\"" + (hidden ? " checked" : "") + ">" +
              "<span>" +
                "<strong>" + escapeHtml(action.label) + "</strong>" +
                "<em class=\"detail-note\">" + escapeHtml(action.id) + "</em>" +
              "</span>" +
            "</label>" +
            "<div class=\"panel-action-labels\">" +
              "<input type=\"text\" data-role=\"label_es\" placeholder=\"Texto ES (vacío = el de la app)\" value=\"" +
                escapeHtml(entry.label_es || "") + "\">" +
              "<input type=\"text\" data-role=\"label_en\" placeholder=\"Texto EN (vacío = el de la app)\" value=\"" +
                escapeHtml(entry.label_en || "") + "\">" +
            "</div>" +
          "</div>";
      }).join("");

      return "<section class=\"detail-card\"><h2>" + escapeHtml(group.name) +
        "</h2><div class=\"panel-actions\">" + rows + "</div></section>";
    }).join("");

    renderObsolete();
    renderAnnouncements();
    renderPreview();
  }

  function renderObsolete() {
    if (!state.obsolete.length) {
      els.obsoleteCard.hidden = true;
      return;
    }
    els.obsoleteCard.hidden = false;
    els.obsoleteList.innerHTML = state.obsolete.map(function (id) {
      return "<li><code>" + escapeHtml(id) + "</code></li>";
    }).join("");
  }

  /** Construye el JSON con SOLO las excepciones: una acción sin cambios no se escribe. */
  function buildOverrides() {
    const result = {};
    Object.keys(state.overrides).forEach(function (id) {
      const entry = state.overrides[id];
      const out = {};
      if (entry.hidden) out.hidden = true;

      const es = (entry.label_es || "").trim();
      const en = (entry.label_en || "").trim();
      if (es && en) {
        out.label = { es: es, en: en };
      } else if (es) {
        out.label = { es: es };
      } else if (en) {
        out.label = { en: en };
      }

      if (Object.keys(out).length) result[id] = out;
    });
    return result;
  }

  function renderPreview() {
    els.preview.textContent = JSON.stringify(buildOverrides(), null, 2);
  }

  // -------------------------------------------------------------------------
  // Eventos
  // -------------------------------------------------------------------------

  function wireEvents() {
    els.groups.addEventListener("change", function (event) {
      const row = event.target.closest("[data-id]");
      if (!row) return;
      const entry = entryFor(row.dataset.id);
      const role = event.target.dataset.role;
      if (role === "hidden") {
        entry.hidden = event.target.checked;
        row.classList.toggle("is-hidden", entry.hidden);
      } else if (role === "label_es" || role === "label_en") {
        entry[role] = event.target.value;
      }
      renderPreview();
    });

    els.groups.addEventListener("input", function (event) {
      const row = event.target.closest("[data-id]");
      if (!row) return;
      const role = event.target.dataset.role;
      if (role === "label_es" || role === "label_en") {
        entryFor(row.dataset.id)[role] = event.target.value;
        renderPreview();
      }
    });

    // Un solo listener delegado en la lista, no uno por campo: las filas se repintan y los
    // listeners individuales se quedarian colgando de nodos ya sustituidos.
    els.announcementList.addEventListener("input", function (event) {
      const row = event.target.closest("[data-index]");
      if (!row) return;
      const entry = state.announcements[Number(row.dataset.index)];
      if (!entry) return;
      const role = event.target.dataset.role;
      if (!role || !(role in entry)) return;

      entry[role] = event.target.value;
      // Solo la vista previa: repintar la fila entera mientras se escribe robaria el foco.
      refreshAnnouncementPreview(row, entry);
    });

    els.announcementList.addEventListener("change", function (event) {
      const row = event.target.closest("[data-index]");
      if (!row) return;
      const index = Number(row.dataset.index);
      const entry = state.announcements[index];
      if (!entry) return;
      const role = event.target.dataset.role;
      if (!role) return;

      if (role === "dismissible") {
        entry.dismissible = event.target.checked;
      } else if (role in entry) {
        entry[role] = event.target.value;
      } else {
        return;
      }
      // Cambiar formato, tema o tipo de boton añade o quita campos, asi que aqui si toca
      // repintar. Un select no pierde nada por reconstruirse.
      renderAnnouncements();
    });

    els.announcementList.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-role]");
      if (!button) return;
      const row = button.closest("[data-index]");
      if (!row) return;
      const index = Number(row.dataset.index);
      const role = button.dataset.role;

      if (role === "remove") {
        const entry = state.announcements[index];
        const label = (entry?.id || "").trim() || "este aviso";
        // Quitar un aviso es facil de deshacer (no se ha publicado aun), pero se pierde el texto
        // escrito, asi que se confirma.
        if (!window.confirm("¿Quitar " + label + "? Se perderá lo que hayas escrito.")) return;
        state.announcements.splice(index, 1);
      } else if (role === "up" && index > 0) {
        const [moved] = state.announcements.splice(index, 1);
        state.announcements.splice(index - 1, 0, moved);
      } else if (role === "down" && index < state.announcements.length - 1) {
        const [moved] = state.announcements.splice(index, 1);
        state.announcements.splice(index + 1, 0, moved);
      } else if (role === "lang") {
        state.previewLanguage = state.previewLanguage === "es" ? "en" : "es";
      } else if (role === "mode") {
        state.previewDark = !state.previewDark;
      } else {
        return;
      }
      renderAnnouncements();
    });

    els.addAnnouncementButton.addEventListener("click", function () {
      state.announcements.push({
        id: "",
        format: "banner",
        theme: "info",
        title_es: "",
        title_en: "",
        body_es: "",
        body_en: "",
        dismissible: true,
        minVersionCode: "",
        maxVersionCode: "",
        actionKind: "",
        actionLabel_es: "",
        actionLabel_en: "",
        actionUrl: "",
        extra: {}
      });
      renderAnnouncements();
      message("Aviso nuevo. Ponle un id y publica cuando esté listo.", "warn");
    });

    els.cleanObsoleteButton.addEventListener("click", function () {
      state.obsolete.forEach(function (id) {
        delete state.overrides[id];
      });
      state.obsolete = [];
      renderObsolete();
      renderPreview();
      message("Ids obsoletos quitados. Pulsa Publicar para aplicarlo.", "warn");
    });

    els.reloadButton.addEventListener("click", function () {
      reload();
    });

    els.publishButton.addEventListener("click", publish);
    els.rollbackButton.addEventListener("click", rollback);
  }

  async function publish() {
    // Se corta aqui antes de llamar al servidor: el error es el mismo, pero asi se ve junto al
    // campo que lo causa en vez de como un 400 seco.
    const problems = allAnnouncementProblems();
    if (problems.length) {
      message("Revisa los avisos: " + problems[0], "error");
      return;
    }

    els.publishButton.disabled = true;
    message("Publicando…");
    try {
      const result = await callFunction("POST", {
        etag: state.etag,
        values: {
          ui_overrides: JSON.stringify(buildOverrides()),
          announcements: JSON.stringify(buildAnnouncements()),
          posts_feed_disabled: els.postsFeedDisabled.checked ? "true" : "false"
        }
      });
      state.etag = result.etag || state.etag;
      message("Publicado. Los dispositivos lo recogerán en su próximo refresco (hasta 12 h).", "ok");
      await loadTemplate();
      render();
    } catch (error) {
      if (error.status === 409) {
        // Otra sesión publicó mientras editabas: se recarga en vez de sobrescribir.
        message("Alguien publicó mientras editabas. Recargando el estado actual…", "warn");
        await reload();
        return;
      }
      message("No se pudo publicar: " + error.message, "error");
    } finally {
      els.publishButton.disabled = false;
    }
  }

  async function rollback() {
    if (state.previousJson === null) return;
    const confirmed = window.confirm(
      "Se va a republicar lo que estaba guardado antes de tus cambios sin publicar, tanto los " +
        "botones como los avisos. ¿Seguir?"
    );
    if (!confirmed) return;

    els.rollbackButton.disabled = true;
    message("Restaurando…");
    try {
      const values = { ui_overrides: state.previousJson };
      // Los avisos entran solo si se leyeron: mandar "[]" cuando la lectura fallo los borraria
      // todos en nombre de un rollback.
      if (state.previousAnnouncementsJson !== null) {
        values.announcements = state.previousAnnouncementsJson;
      }
      await callFunction("POST", { etag: state.etag, values: values });
      message("Restaurado.", "ok");
      await reload();
    } catch (error) {
      message("No se pudo restaurar: " + error.message, "error");
    } finally {
      els.rollbackButton.disabled = false;
    }
  }

  async function reload() {
    try {
      await loadTemplate();
      render();
    } catch (error) {
      message("No se pudo cargar la configuración: " + error.message, "error");
    }
  }

  // -------------------------------------------------------------------------
  // Arranque
  // -------------------------------------------------------------------------

  async function main() {
    if (!sb) {
      gateMessage("Error", "No se pudo cargar el cliente de Supabase.");
      return;
    }

    state.session = await sb.getSession();
    if (!state.session) {
      gateMessage(
        "Inicia sesión",
        "Necesitas iniciar sesión con una cuenta de administrador.",
        { label: "Iniciar sesión", href: sb.loginUrl("index.html") }
      );
      return;
    }

    els.authChip.textContent = await sb.displayName(state.session);

    // Gate cosmético: da un mensaje claro en vez de un 403 seco. El control real lo hace la
    // edge function, que vuelve a comprobar is_app_admin() con el token.
    const { data: isAdmin, error } = await sb.client.rpc("is_app_admin");
    if (error || isAdmin !== true) {
      gateMessage("Acceso restringido", "Tu cuenta no tiene permisos de administrador.");
      return;
    }

    try {
      await loadCatalog();
      await loadTemplate();
    } catch (err) {
      gateMessage("No se pudo cargar", err.message);
      return;
    }

    els.gate.hidden = true;
    els.content.hidden = false;
    els.reloadButton.hidden = false;
    wireEvents();
    render();
  }

  main();
})();
