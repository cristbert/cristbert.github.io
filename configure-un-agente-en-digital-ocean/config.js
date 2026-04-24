window.CHAT_CONFIG = {
  siteName: "Tu sitio web",
  assistantName: "Asistente DigitalOcean",
  assistantDescription:
    "Un asistente conectado directamente a tu agente para pruebas personales.",
  welcomeMessage:
    "Hola, soy tu asistente. Estoy listo para ayudarte desde tu web. ¿Qué necesitas hoy?",

  // Ojo: esta access key sera visible para cualquiera que abra el codigo de la pagina.
  digitalOcean: {
    endpoint: "https://s64yezyaqvk2oaio7ouckgfj.agents.do-ai.run",
    accessKey: "6RtiII9842v-Pzn9CCB5YTkaw44YGeII"
  },

  stream: true,
  historyLimit: 12,
  storageKey: "digitalocean-agent-chat-demo",
  suggestions: [
    "Quiero automatizar respuestas frecuentes para clientes.",
    "Explícame nuestros servicios en pocas palabras",
    "Ayúdame a redactar una propuesta comercial",
    "Resume esta consulta y dame una respuesta clara"
  ]
};
