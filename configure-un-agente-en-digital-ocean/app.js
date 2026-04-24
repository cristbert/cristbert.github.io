(function () {
  const DEFAULT_CONFIG = {
    siteName: "Tu sitio web",
    assistantName: "Asistente DigitalOcean",
    assistantDescription:
      "Un asistente conectado a un agente remoto mediante una integración segura.",
    welcomeMessage:
      "Hola, soy tu asistente. Estoy listo para ayudarte desde esta web.",
    apiUrl: "/api/chat",
    stream: false,
    historyLimit: 12,
    storageKey: "digitalocean-agent-chat",
    suggestions: [
      "Quiero ayuda para atender preguntas frecuentes",
      "Explícame tus servicios principales",
      "Dame una respuesta profesional para un cliente"
    ]
  };

  const config = {
    ...DEFAULT_CONFIG,
    ...(window.CHAT_CONFIG || {})
  };

  const state = {
    isLoading: false,
    messages: [],
    sessionId: getStoredSessionId()
  };

  const elements = {
    assistantName: document.getElementById("assistantName"),
    assistantDescription: document.getElementById("assistantDescription"),
    statusPill: document.getElementById("statusPill"),
    chatTitle: document.getElementById("chatTitle"),
    messageList: document.getElementById("messageList"),
    typingIndicator: document.getElementById("typingIndicator"),
    chatForm: document.getElementById("chatForm"),
    messageInput: document.getElementById("messageInput"),
    sendButton: document.getElementById("sendButton"),
    clearConversationBtn: document.getElementById("clearConversationBtn"),
    quickPrompts: document.getElementById("quickPrompts"),
    configAssistantName: document.getElementById("configAssistantName"),
    configApiUrl: document.getElementById("configApiUrl"),
    configStreaming: document.getElementById("configStreaming"),
    configHistoryLimit: document.getElementById("configHistoryLimit")
  };

  init();

  function init() {
    hydrateStaticContent();
    hydrateConversation();
    renderMessages();
    renderQuickPrompts();
    bindEvents();
    autoResizeTextarea();
    focusComposer();
  }

  function hydrateStaticContent() {
    document.title = `Chat con ${config.assistantName}`;
    elements.assistantName.textContent = config.assistantName;
    elements.assistantDescription.textContent = config.assistantDescription;
    elements.chatTitle.textContent = `${config.assistantName} en ${config.siteName}`;
    elements.statusPill.textContent =
      config.apiUrl === "/api/chat" ? "Actualiza tu endpoint" : "Listo para conectar";

    elements.configAssistantName.textContent = config.assistantName;
    elements.configApiUrl.textContent = config.apiUrl;
    elements.configStreaming.textContent = config.stream ? "Activado" : "Desactivado";
    elements.configHistoryLimit.textContent = `${config.historyLimit} mensajes`;
  }

  function hydrateConversation() {
    const storedMessages = safeReadStorage(config.storageKey);

    if (storedMessages.length > 0) {
      state.messages = storedMessages;
      return;
    }

    state.messages = [
      createMessage("assistant", config.welcomeMessage)
    ];
    persistConversation();
  }

  function bindEvents() {
    elements.chatForm.addEventListener("submit", handleSubmit);
    elements.clearConversationBtn.addEventListener("click", resetConversation);
    elements.messageInput.addEventListener("input", autoResizeTextarea);
    elements.messageInput.addEventListener("keydown", handleComposerKeydown);
  }

  function handleComposerKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.chatForm.requestSubmit();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (state.isLoading) {
      return;
    }

    const content = elements.messageInput.value.trim();
    if (!content) {
      return;
    }

    appendMessage(createMessage("user", content));
    elements.messageInput.value = "";
    autoResizeTextarea();
    setLoading(true);

    try {
      const response = await fetch(config.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          message: content,
          sessionId: state.sessionId,
          messages: buildRequestMessages()
        })
      });

      const data = await parseResponse(response);
      const normalized = normalizeAssistantResponse(data);

      appendMessage(
        createMessage("assistant", normalized.content, {
          citations: normalized.citations
        })
      );
    } catch (error) {
      appendMessage(
        createMessage(
          "assistant",
          buildFriendlyError(error),
          { isError: true }
        )
      );
    } finally {
      setLoading(false);
      focusComposer();
    }
  }

  async function parseResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : { reply: await response.text() };

    if (!response.ok) {
      const error = new Error(payload.error || payload.message || "No se pudo obtener respuesta del agente.");
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  function normalizeAssistantResponse(payload) {
    const content =
      payload.reply ||
      payload.message ||
      payload.content ||
      payload.output_text ||
      payload.answer ||
      extractChoiceContent(payload) ||
      "No se recibió texto en la respuesta del agente.";

    const citations =
      normalizeCitations(payload.citations) ||
      normalizeCitations(payload.sources) ||
      normalizeRetrievalCitations(payload.retrieval) ||
      [];

    return {
      content,
      citations
    };
  }

  function extractChoiceContent(payload) {
    const choice = payload.choices && payload.choices[0];
    if (!choice) {
      return "";
    }

    if (typeof choice.text === "string" && choice.text.trim()) {
      return choice.text;
    }

    const content = choice.message && choice.message.content;
    if (Array.isArray(content)) {
      return content
        .map(function (item) {
          if (typeof item === "string") {
            return item;
          }

          if (item && typeof item.text === "string") {
            return item.text;
          }

          return "";
        })
        .filter(Boolean)
        .join("\n");
    }

    if (typeof content === "string") {
      return content;
    }

    return "";
  }

  function normalizeCitations(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return null;
    }

    return items
      .map(function (item, index) {
        if (!item) {
          return null;
        }

        if (typeof item === "string") {
          return {
            title: `Fuente ${index + 1}`,
            url: item
          };
        }

        return {
          title: item.title || item.name || `Fuente ${index + 1}`,
          url: item.url || item.link || "",
          snippet: item.snippet || item.text || ""
        };
      })
      .filter(Boolean);
  }

  function normalizeRetrievalCitations(retrieval) {
    if (!retrieval || !Array.isArray(retrieval.documents)) {
      return null;
    }

    return retrieval.documents
      .map(function (document, index) {
        if (!document) {
          return null;
        }

        return {
          title: document.title || document.name || `Documento ${index + 1}`,
          url: document.url || "",
          snippet: document.snippet || document.content || ""
        };
      })
      .filter(Boolean);
  }

  function buildRequestMessages() {
    const trimmedHistory = state.messages
      .filter(function (message) {
        return message.role === "user" || message.role === "assistant";
      })
      .slice(-config.historyLimit);

    return trimmedHistory.map(function (message) {
      return {
        role: message.role,
        content: message.content
      };
    });
  }

  function buildFriendlyError(error) {
    if (error.status === 401 || error.status === 403) {
      return "La conexión fue rechazada por el servidor. Revisa la autenticación del proxy que conecta con tu agente.";
    }

    if (error.status >= 500) {
      return "Tu servidor respondió con un error interno. Revisa el proxy o la función que conecta con DigitalOcean.";
    }

    return error.message || "Ocurrió un error al comunicarse con el agente.";
  }

  function createMessage(role, content, extras) {
    return {
      id: crypto.randomUUID(),
      role: role,
      content: content,
      createdAt: new Date().toISOString(),
      citations: (extras && extras.citations) || [],
      isError: Boolean(extras && extras.isError)
    };
  }

  function appendMessage(message) {
    state.messages.push(message);
    persistConversation();
    renderMessages();
  }

  function persistConversation() {
    localStorage.setItem(config.storageKey, JSON.stringify(state.messages));
    localStorage.setItem(`${config.storageKey}:sessionId`, state.sessionId);
  }

  function safeReadStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function getStoredSessionId() {
    return (
      localStorage.getItem(`${(window.CHAT_CONFIG && window.CHAT_CONFIG.storageKey) || DEFAULT_CONFIG.storageKey}:sessionId`) ||
      crypto.randomUUID()
    );
  }

  function resetConversation() {
    state.sessionId = crypto.randomUUID();
    state.messages = [
      createMessage("assistant", config.welcomeMessage)
    ];
    persistConversation();
    renderMessages();
    focusComposer();
  }

  function renderMessages() {
    elements.messageList.innerHTML = "";

    state.messages.forEach(function (message) {
      const article = document.createElement("article");
      article.className = `message message--${message.role}`;

      const meta = document.createElement("div");
      meta.className = "message__meta";
      meta.textContent = `${message.role === "user" ? "Tú" : config.assistantName} · ${formatTime(message.createdAt)}`;

      const bubble = document.createElement("div");
      bubble.className = "message__bubble";
      if (message.isError) {
        bubble.style.borderColor = "rgba(216, 111, 69, 0.35)";
      }
      bubble.textContent = message.content;

      article.append(meta, bubble);

      if (Array.isArray(message.citations) && message.citations.length > 0) {
        const footer = document.createElement("div");
        footer.className = "message__footer";

        message.citations.forEach(function (citation) {
          const anchor = document.createElement("a");
          anchor.className = "citation";
          anchor.target = "_blank";
          anchor.rel = "noreferrer";
          anchor.href = citation.url || "#";
          anchor.textContent = citation.title || "Fuente";
          footer.appendChild(anchor);
        });

        article.appendChild(footer);
      }

      elements.messageList.appendChild(article);
    });

    scrollMessagesToBottom();
  }

  function renderQuickPrompts() {
    elements.quickPrompts.innerHTML = "";

    config.suggestions.forEach(function (prompt) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "prompt-button";
      button.textContent = prompt;
      button.addEventListener("click", function () {
        elements.messageInput.value = prompt;
        autoResizeTextarea();
        focusComposer();
      });
      elements.quickPrompts.appendChild(button);
    });
  }

  function setLoading(isLoading) {
    state.isLoading = isLoading;
    elements.sendButton.disabled = isLoading;
    elements.messageInput.disabled = isLoading;
    elements.typingIndicator.hidden = !isLoading;
    scrollMessagesToBottom();
  }

  function autoResizeTextarea() {
    elements.messageInput.style.height = "auto";
    elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 220)}px`;
  }

  function scrollMessagesToBottom() {
    requestAnimationFrame(function () {
      elements.messageList.scrollTop = elements.messageList.scrollHeight;
    });
  }

  function focusComposer() {
    elements.messageInput.focus();
  }

  function formatTime(isoString) {
    try {
      return new Intl.DateTimeFormat("es-ES", {
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(isoString));
    } catch (_error) {
      return "";
    }
  }
})();
