# Chat web directo para agente de DigitalOcean

Esta version no usa backend. El navegador llama directamente al endpoint del agente.

Archivos:

- `index.html`: estructura de la interfaz.
- `styles.css`: diseno responsive.
- `config.js`: endpoint, access key y textos editables.
- `app.js`: logica del chat y llamada directa a DigitalOcean.

## Como conectarlo

Edita `config.js` y cambia estos valores:

```js
digitalOcean: {
  endpoint: "https://TU-AGENTE.agents.do-ai.run",
  accessKey: "PEGA_AQUI_TU_ACCESS_KEY"
}
```

El `endpoint` es la URL base del agente. No agregues `/api/v1/chat/completions?agent=true`, porque `app.js` lo agrega automaticamente.

## Donde conseguir esos datos

1. Entra a tu agente en DigitalOcean.
2. Copia la URL de `ENDPOINT`.
3. Ve a `Settings`.
4. Crea una key en `Endpoint Access Keys`.
5. Pega la URL y la key en `config.js`.

## Importante

Esta forma sirve para una prueba personal, pero la access key queda visible en el navegador mientras la pagina este publicada. Cuando termines la prueba, elimina la key en DigitalOcean.

Si aparece un error de conexion aunque la key este correcta, es posible que el navegador haya bloqueado la llamada por CORS. En ese caso no hay un arreglo 100% desde HTML/JS estatico; tendrias que usar el snippet publico que DigitalOcean da para el chatbot embebido.
