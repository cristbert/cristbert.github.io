/*
 * Vista previa de un aviso, dibujada como lo vera el usuario en el telefono.
 *
 * Es una reimplementacion en HTML de `announcement_host.dart`. Eso significa que puede
 * DESVIARSE del render real: es una maqueta fiel, no la app. Los valores que se copian del Dart
 * (colores por tema, iconos, tamanos, radios) estan marcados para que se actualicen a la par.
 *
 * Se mantiene aparte de panel.js porque es lo unico puramente visual del panel, y asi el fichero
 * de logica no se llena de plantillas.
 */
(function () {
  "use strict";

  /** Espejo de _Palette.of() en announcement_host.dart. */
  const THEMES = {
    info: { accent: "#2B82D9", icon: "info", label: "Informacion" },
    success: { accent: "#1B7A55", icon: "check", label: "Todo bien" },
    warning: { accent: "#F59E0B", icon: "warning", label: "Atencion" },
    danger: { accent: "#F85149", icon: "error", label: "Problema" },
    netsus: { accent: "#7FE6C2", icon: "sparkle", label: "Netsus" }
  };

  /** Espejo de los textos por defecto de _ActionButton. */
  const DEFAULT_ACTION_LABELS = {
    store: { es: "Actualizar", en: "Update" },
    url: { es: "Ver mas", en: "Learn more" },
    dismiss: { es: "Entendido", en: "Got it" }
  };

  /* SVG en vez de una fuente de iconos: el panel no carga ninguna, y estos cuatro trazos
     reproducen la silueta de los Material Icons que usa el Dart. */
  const ICONS = {
    info:
      "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4z" +
      "M11 11h2v6h-2z",
    check:
      "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 14.4-4-4 1.4-1.4L11 13.6l5.6-5.6L18 9.4z",
    warning: "M12 2 1 21h22L12 2zm1 14h-2v-2h2zm0-4h-2V8h2z",
    error:
      "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2zm0-4h-2V7h2z",
    sparkle: "M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z"
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Misma caida que _pick() en announcements.dart: idioma pedido, es, en, el primero que haya. */
  function pick(byLanguage, language) {
    if (!byLanguage) return "";
    const exact = byLanguage[language];
    if (exact) return exact;
    if (byLanguage.es) return byLanguage.es;
    if (byLanguage.en) return byLanguage.en;
    const first = Object.keys(byLanguage).find(function (key) {
      return byLanguage[key];
    });
    return first ? byLanguage[first] : "";
  }

  function iconSvg(name, color) {
    return (
      '<svg class="ann-icon" viewBox="0 0 24 24" aria-hidden="true" fill="' +
      escapeHtml(color) +
      '"><path d="' +
      ICONS[name] +
      '"></path></svg>'
    );
  }

  /** Texto del boton: el configurado, o el que pondria la app. */
  function actionLabel(action, language) {
    if (!action || !action.kind) return "";
    const configured = pick(action.label, language);
    if (configured) return configured;
    const fallback = DEFAULT_ACTION_LABELS[action.kind];
    return fallback ? fallback[language] || fallback.es : "";
  }

  /** Blanco o tinta segun el acento, igual que _readableOn() en el Dart. */
  function readableOn(hex) {
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16) / 255;
    const g = parseInt(value.slice(2, 4), 16) / 255;
    const b = parseInt(value.slice(4, 6), 16) / 255;
    const channel = function (c) {
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance =
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    return luminance > 0.55 ? "#0F172A" : "#FFFFFF";
  }

  /**
   * Dibuja el aviso dentro de una silueta de telefono.
   *
   * @param {object} announcement forma de `announcements[i]`
   * @param {object} options `{ language: "es"|"en", dark: boolean }`
   * @return {string} HTML
   */
  function render(announcement, options) {
    const language = (options && options.language) || "es";
    const dark = !options || options.dark !== false;
    const theme = THEMES[announcement.theme] || THEMES.info;
    const isModal = announcement.format === "modal";

    const title = pick(announcement.title, language);
    const body = pick(announcement.body, language);
    const action = announcement.action;
    const label = actionLabel(action, language);
    const dismissible = announcement.dismissible !== false;

    const closeButton = dismissible
      ? '<span class="ann-close">&times;</span>'
      : "";

    const button = label
      ? '<span class="ann-button" style="background:' +
        escapeHtml(theme.accent) +
        ";color:" +
        escapeHtml(readableOn(theme.accent)) +
        '">' +
        escapeHtml(label) +
        "</span>"
      : "";

    let card;
    if (isModal) {
      card =
        '<div class="ann-modal" style="border-color:' +
        escapeHtml(theme.accent) +
        '73">' +
        closeButton +
        iconSvg(theme.icon, theme.accent) +
        (title ? '<p class="ann-modal-title">' + escapeHtml(title) + "</p>" : "") +
        '<span class="ann-rule" style="background:' +
        escapeHtml(theme.accent) +
        '"></span>' +
        (body ? '<p class="ann-modal-body">' + escapeHtml(body) + "</p>" : "") +
        (button ? '<div class="ann-modal-action">' + button + "</div>" : "") +
        "</div>";
    } else {
      card =
        '<div class="ann-banner" style="border-color:' +
        escapeHtml(theme.accent) +
        '8c">' +
        iconSvg(theme.icon, theme.accent) +
        '<div class="ann-banner-text">' +
        (title ? '<p class="ann-banner-title">' + escapeHtml(title) + "</p>" : "") +
        (body ? '<p class="ann-banner-body">' + escapeHtml(body) + "</p>" : "") +
        (button ? '<div class="ann-banner-action">' + button + "</div>" : "") +
        "</div>" +
        closeButton +
        "</div>";
    }

    return (
      '<div class="ann-phone' +
      (dark ? " is-dark" : " is-light") +
      (isModal ? " is-modal" : " is-banner") +
      '">' +
      '<div class="ann-phone-chrome"><span></span></div>' +
      '<div class="ann-phone-body">' +
      // Filas falsas de chats, para juzgar el contraste sobre contenido real y no sobre un fondo
      // plano: un cartel puede verse bien aislado y perderse encima de la lista.
      '<div class="ann-fake-list">' +
      '<span></span><span></span><span></span><span></span><span></span>' +
      "</div>" +
      card +
      "</div>" +
      "</div>"
    );
  }

  window.NetsusAnnouncementPreview = {
    render: render,
    themes: THEMES,
    pick: pick,
    actionLabel: actionLabel
  };
})();
