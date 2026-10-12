# Control de ejecuciones con OpenCode

Investigación para [Investigar el control de ejecuciones con OpenCode](https://github.com/rubenbp/app-foundry/issues/3), consultada el **12 de octubre de 2026**. Es una base para decidir el contrato de integración, no una implementación ni una validación experimental.

## Conclusión

OpenCode ofrece las piezas necesarias para que la **Factory** controle un agente: servidor HTTP, sesiones, contexto, eventos, permisos, preguntas, cancelación e historial. La Factory tendrá que mantener sus propias decisiones, presupuestos y recuperación. Una sesión inactiva no demuestra que un issue esté resuelto; una respuesta del modelo tampoco sustituye compilación, lint, tests ni aceptación humana. Para el MVP secuencial parece suficiente un proceso coordinador, eventos locales y persistencia sencilla. Esta última afirmación es una recomendación de alcance, no una garantía proporcionada por OpenCode.

## Referencia reproducible y alcance

La release oficial más reciente encontrada fue [v1.19.0](https://github.com/anomalyco/opencode/releases/tag/v1.19.0), publicada el 11 de octubre de 2026. El tag descargado resuelve al commit **733b2c627e5aec39cb33cc22373bdce33053ef2c**; esa referencia fija todas las lecturas de código de este informe. El campo `target_commitish` de la release es distinto y no se ha usado para fijar el código. El [manifiesto del SDK][sdk-package] declara `@opencode-ai/sdk` versión `1.19.0`, con exportaciones raíz y `/v2`. No se verificó su publicación en npm.

Se consultaron documentación oficial, tipos generados y código fuente del tag. No se instaló ni arrancó OpenCode, no se ejecutaron modelos, no se gastaron tokens de proveedores y no se probó recuperación real. Los ejemplos de la documentación general usan una forma de parámetros distinta de `/v2`: hay que fijar juntos versión del binario, versión del paquete y exportación usada. El contrato siguiente toma como referencia el cliente `/v2` de este paquete; no el producto distinto `@opencode/sdk` de la documentación de desarrollo.

## Capacidades y límites observados

### Servidor, directorio y contexto

`opencode serve` expone HTTP y una especificación OpenAPI. La configuración documentada incluye interfaz de escucha, puerto y autenticación básica opcional. `GET /global/health` devuelve salud y versión. Conviene registrar esa versión en cada ejecución y mantener el servidor local para este MVP. [Documentación del servidor](https://opencode.ai/docs/server/).

El helper `createOpencodeServer()` arranca el ejecutable `opencode` mediante un proceso hijo: el SDK no sustituye la instalación del binario. Hereda el entorno, inyecta configuración y espera un mensaje de disponibilidad. Su `timeout`, por defecto 5 segundos, limita **el arranque**, no el trabajo del agente; `close()` solicita detener el proceso. El cliente puede conectarse a un servidor existente. [Código del helper][sdk-server].

`createOpencodeClient({baseUrl, directory})` permite seleccionar el directorio del **Managed project**. El cliente `/v2` traduce ese contexto a cabeceras o parámetros de consulta según la petición; las operaciones generadas también admiten `directory`. Seleccionar un directorio no crea un worktree ni constituye aislamiento del sistema operativo. La Factory debe preparar el checkout y verificar la ruta antes de enviar trabajo. [Cliente][sdk-client], [operaciones][sdk-api].

El prompt admite `sessionID`, `messageID`, `agent`, `model: {providerID, modelID}`, `system`, `parts`, `noReply` y formato estructurado. Las partes permiten texto y archivos. `noReply` sirve para incorporar contexto sin pedir una nueva respuesta. Además, OpenCode carga instrucciones de archivos y configuración: el contexto efectivo no es únicamente el texto que mande la Factory. Para reproducibilidad interesa conservar petición, revisión de Git y configuración relevante, sin copiar credenciales. [Operaciones][sdk-api], [carga de instrucciones][instructions].

### Ejecución, observación y errores

Hay creación y consulta de sesiones, lectura de mensajes y partes, consulta de estados y dos rutas de ejecución: `prompt` espera el resultado; `promptAsync` devuelve una aceptación HTTP sin esperar a que termine el trabajo. En el servidor inspeccionado, la segunda inicia trabajo en un scope y publica `session.error` si falla. Su respuesta no acredita finalización ni una entrada duradera en una cola. [Handlers de sesión][session-http].

El cliente ofrece `event.subscribe()` y eventos de actualización de mensajes/partes, estado, errores, permisos y preguntas. Hay estados `busy`, `retry` e `idle`; el estado de ejecución se mantiene en memoria. Tras observar una terminación, la Factory debe leer mensajes completos, comprobar errores y partes de herramientas, y ejecutar sus verificaciones externas. `idle` es ausencia de actividad, no un resultado de aceptación. [Tipos][sdk-types], [estado][status].

La suscripción SSE examinada registra un listener, emite conexión y heartbeats y entrega eventos de ese directorio. Aunque el cliente generado sabe manejar `Last-Event-ID`, este endpoint no implementa recuperación desde ese cursor: emite el identificador dentro del JSON, con el campo SSE `id` sin definir. No debe tratarse este stream como un log durable con replay. Ante desconexión, reconectar y reconciliar consultas de sesión/mensajes/permisos, en vez de suponer que llegaron todos los eventos. Esta conclusión se limita al endpoint de suscripción inspeccionado, no a todas las APIs de eventos presentes en el repositorio. [Handler SSE][events], [cliente SSE][sse-client].

Se deben distinguir errores HTTP/transporte, errores del mensaje del asistente, eventos `session.error` y resultados fallidos de herramientas. El cliente generado permite `throwOnError`; no conviene copiar ejemplos que dependen de excepciones sin configurar o comprobar la respuesta. Un timeout del cliente deja incierto si el servidor aceptó la operación. [SDK oficial](https://opencode.ai/docs/sdk/), [operaciones][sdk-api].

### Permisos, HITL y cancelación

OpenCode documenta reglas `allow`, `ask` y `deny`, con patrones y precedencia. El MVP necesita una política explícita de herramientas; el modo automático no debe decidir la autorización del issue ni aprobar su integración. Esos dos puntos HITL acordados pertenecen a la Factory. [Permisos oficiales](https://opencode.ai/docs/permissions/).

El SDK dispone de `permission.list/reply` y `question.list/reply/reject`. Permisos y preguntas son canales distintos: autorizar una herramienta no responde una ambigüedad de producto. Las respuestas de permisos contemplan `once`, `always` y `reject`. En el código observado, las solicitudes pendientes y aprobaciones temporales residen en estructuras de memoria; al destruir la instancia, los pendientes se rechazan y se limpian. No se debe prometer que un diálogo pendiente sobreviva al reinicio con el mismo identificador. La Factory necesita registrar por qué solicitó intervención y reconciliar antes de responder. [Permisos][permissions], [preguntas][questions], [operaciones][sdk-api].

`session.abort` solicita cancelar el trabajo de la sesión. El código cancela el runner y trabajos de fondo asociados, y dispone de finalización de mensajes interrumpidos. Cancelar una petición HTTP o dejar de escuchar eventos no equivale a invocar esa operación. Tampoco hay una transacción que revierta automáticamente todos los efectos de herramientas: archivos modificados, commits o peticiones externas pueden haberse completado antes de la cancelación. El retorno de `abort` no debe interpretarse como rollback. [Handler][session-http], [runner][run-state], [prompt][prompt].

### Historial, reinicios y reintentos

Las sesiones, mensajes y partes se consultan mediante las APIs y se respaldan en almacenamiento SQL. La configuración observada utiliza SQLite con WAL y una ruta persistente, salvo configuración explícita en memoria. Debe conservarse ese directorio de datos, además del checkout, para recuperar el historial. Es preferible consultar la API pública a acoplar la Factory directamente al esquema interno. [Sesiones][session], [base de datos][database].

La persistencia del historial no implica reanudación exacta de una ejecución interrumpida. Los runners y estados están en memoria; un estado ausente se interpreta como `idle`. Tras reiniciar hay que contrastar la intención guardada por la Factory con el último mensaje completo, cambios en Git y efectos externos conocidos. Una sesión recuperable permite continuar conversando; no demuestra que sea seguro reenviar el mismo prompt. [Runner][run-state], [estado][status].

OpenCode ya aplica reintentos internos a ciertos errores del proveedor, con backoff y una constante de cinco reintentos en esta referencia. La Factory debe diferenciar esos reintentos de un nuevo intento de resolver el issue. El `messageID` opcional facilita correlación, pero las rutas inspeccionadas no establecen una garantía contractual de ejecución exactamente una vez. Repetir ciegamente una petición incierta puede repetir efectos. Es razonable que el MVP detenga estos casos para revisión, dejando automatizar su reconciliación a un incremento posterior. [Política de reintentos][retry], [prompt][prompt], [handler][session-http].

### Tokens, costes y límites

Los mensajes del asistente y las sesiones exponen información de consumo; el cálculo separa entrada, salida, razonamiento y caché. El coste se deriva de uso recibido y precios del modelo, con tratamientos específicos de proveedor. No equivale necesariamente a la factura: los datos ausentes o no finitos se normalizan a cero y puede faltar el consumo de una petición interrumpida. Deben guardarse también proveedor, modelo y versión de la configuración. [Cálculo de uso][session], [procesamiento][processor].

El plugin de OpenAI/Codex fija precios de entrada, salida y caché a cero para modelos obtenidos por la ruta OAuth inspeccionada. Por tanto, coste cero no demuestra consumo nulo ni ausencia de cuota o coste de suscripción. Para la evaluación conviene distinguir coste informado, estimación y dato no disponible. [Plugin oficial][codex].

No se encontró en las operaciones examinadas un presupuesto transaccional por issue que garantice un máximo absoluto de euros, tokens y tiempo. `agent.steps` aparece en el bucle, que incorpora una instrucción de último paso; no debe presentarse como un límite monetario duro. La Factory debe vigilar tiempo y consumo observado, limitar nuevos intentos y solicitar cancelación. El posible exceso mientras termina una llamada requiere medición. [Bucle][prompt], [cálculo][session].

## OpenCode, proveedores y modelos

OpenCode es el runtime del agente y el SDK es su cliente. El proveedor presta acceso al modelo; el modelo se selecciona mediante sus identificadores. Las rutas oficiales incluyen modelos locales vía Ollama con endpoint compatible con OpenAI, y OpenAI mediante API key o autenticación ChatGPT. Esto no convierte OpenCode en el cliente Codex ni prueba equivalencia con su comportamiento. No se ha validado ningún modelo concreto. Cursor no figura en la página de proveedores examinada; no se investigó la integración comunitaria ni se afirma incompatibilidad técnica. [Proveedores oficiales](https://opencode.ai/docs/providers/), [plugin][codex].

## Contrato mínimo recomendado y experimentos pendientes

Como hipótesis para decidir el MVP: fijar binario/SDK; comprobar salud y directorio; crear sesión y guardar su ID antes de enviar trabajo; registrar intención y prompt; observar eventos y reconciliar lecturas; tramitar intervención; cancelar cuando se agote el presupuesto; recoger resultado verificable. Los resultados de integración deberían distinguir finalización del agente, fallo, necesidad de intervención e interrupción incierta. El éxito del issue seguirá dependiendo de verificaciones deterministas y decisión humana.

Esto puede implementarse inicialmente con un único trabajador y una base local de la Factory. No hay evidencia aquí que obligue a broker distribuido, event sourcing completo o múltiples agentes. La persistencia de la Factory debe registrar transiciones e intentos propios; el stream SSE sirve como notificación, no como única fuente de verdad. Es una propuesta a decidir en los tickets de arquitectura.

Antes de prometer garantías, hacen falta experimentos pequeños:

1. **Ejecución y evidencia:** un cambio de texto en un checkout desechable; comprobar directorio, mensajes, diff, verificación y consumo disponible.
2. **Interrupción:** cancelar durante una herramienta y reiniciar durante una respuesta; documentar qué quedó guardado y qué efectos continuaron.
3. **Desconexión:** perder el SSE, reconectar y reconstruir el resultado consultando APIs sin reenviar el prompt.
4. **Intervención:** provocar permiso y pregunta, reiniciar y comprobar cómo detecta la Factory la intervención pendiente.
5. **Límites y duplicados:** agotar tiempo/reintentos y simular respuesta HTTP perdida; demostrar que no se duplica una publicación externa.

No se ejecutó ninguno. La prioridad sugerida es validar el recorrido completo y después el fallo provocado; los restantes experimentos se podrán agrupar según tiempo disponible. Quedan preguntas de decisión concretas: qué incertidumbres detienen el MVP para HITL, qué exceso de consumo se acepta y qué política mínima de herramientas permite trabajar AFK.

[sdk-package]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/sdk/js/package.json
[sdk-server]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/sdk/js/src/server.ts
[sdk-client]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/sdk/js/src/v2/client.ts
[sdk-api]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/sdk/js/src/v2/gen/sdk.gen.ts
[sdk-types]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/sdk/js/src/v2/gen/types.gen.ts
[sse-client]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/sdk/js/src/v2/gen/core/serverSentEvents.gen.ts
[instructions]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/session/instruction.ts
[session-http]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts
[events]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts
[status]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/session/status.ts
[permissions]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/permission/index.ts
[questions]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/question/index.ts
[run-state]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/session/run-state.ts
[prompt]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/session/prompt.ts
[session]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/session/session.ts
[database]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/core/src/database/database.ts
[retry]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/session/retry.ts
[processor]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/session/processor.ts
[codex]: https://github.com/anomalyco/opencode/blob/733b2c627e5aec39cb33cc22373bdce33053ef2c/packages/opencode/src/plugin/openai/codex.ts
