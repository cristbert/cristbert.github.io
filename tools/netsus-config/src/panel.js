/*
 * Panel de configuración remota de Netsus.
 *
 * Lee y publica los parámetros `ui_overrides` y `posts_feed_disabled` de Firebase Remote Config
 * a través de la edge function `admin-remote-config`.
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
    obsolete: []
  };

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
    els.publishButton.disabled = true;
    message("Publicando…");
    try {
      const result = await callFunction("POST", {
        etag: state.etag,
        values: {
          ui_overrides: JSON.stringify(buildOverrides()),
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
      "Se va a republicar el JSON que estaba guardado antes de tus cambios sin publicar. ¿Seguir?"
    );
    if (!confirmed) return;

    els.rollbackButton.disabled = true;
    message("Restaurando…");
    try {
      await callFunction("POST", {
        etag: state.etag,
        values: { ui_overrides: state.previousJson }
      });
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
