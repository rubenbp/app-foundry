# SSE frente a polling para el panel local

Investigación: 15 de octubre de 2026. Responde a [Evaluar SSE frente a polling para el panel local](https://github.com/rubenbp/app-foundry/issues/10), como apoyo a [Definir la visibilidad operativa de la Factory](https://github.com/rubenbp/app-foundry/issues/8). Es una investigación de planificación: no implementa el panel ni cierra la elección de arquitectura.

## Recomendación

Mantener polling local cada 2 segundos para el primer recorrido del MVP. SSE es viable y pequeño en términos absolutos, pero no aporta historial ni recuperación por sí mismo. Su beneficio principal sería reducir la demora visible de mensajes y actividad de herramientas. No se ha acordado mostrar cada token inmediatamente; con una sola Ejecución activa, la actualización en lotes cada 2 segundos satisface razonablemente lo pedido. Esta última valoración es una inferencia que debe confirmar el usuario.

No hace falta un broker ni construir replay para usar SSE. Una alternativa acotada transmite una notificación de cambio o un resumen versionado y vuelve a consultar el estado persistido al conectar. Incluso así añade trabajo de conexiones, reconexión y verificación. Con entrega el 23 de octubre y 2–3 horas disponibles cada tarde, conviene dedicar ese margen al recorrido completo y sus evidencias. [Calendario y alcance acordados](https://github.com/rubenbp/app-foundry/issues/1).

Reconsiderar SSE si la primera observación muestra que los lotes de 2 segundos perjudican seguir el trabajo, o si la arquitectura elegida ya proporciona streaming probado y el diferencial cae claramente por debajo de una tarde. No bloquear el primer recorrido con esa mejora.

## Estado real y responsabilidades separadas

La inspección del checkout de la Factory en `32cbf07`, incluidos sus cambios locales existentes, encuentra documentación y evidencias. No hay código de servidor, frontend, manifiesto de dependencias, cliente OpenCode o mecanismo de suscripción implementados. Por tanto, no existe un endpoint REST que baste con activar, ni un servidor cuyo soporte SSE pueda darse por comprobado. La estimación compara dos implementaciones futuras sobre una misma base; no es una medición. La plantilla del Managed project no es el panel de la Factory. Fuente: inspección local con `rg --files --hidden -g '!.git'` y `git status --short`.

Hay tres enlaces independientes:

| Enlace                  | Función                                                                             | Consecuencia                                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode → Factory      | Recoger actividad del agente mediante el stream de eventos y consultar sus recursos | Existe con cualquiera de las dos opciones del panel. La documentación ofrece `/event` como SSE y suscripción en el SDK. [Servidor](https://opencode.ai/docs/server/#events), [SDK](https://opencode.ai/docs/sdk/#events). |
| Factory → navegador     | Mostrar estado, mensajes, herramientas y salidas ya observados                      | Es la elección investigada. No debería exponer directamente OpenCode, porque también hay verificaciones, esperas humanas y deployments que pertenecen a la Factory.                                                       |
| Factory → GitHub/Vercel | Consultar instrucciones y hechos externos                                           | Mantener los 15 segundos ya acordados. SSE en el navegador no acelera hechos que la Factory todavía no ha observado. [Workflow acordado](https://github.com/rubenbp/app-foundry/issues/5#issuecomment-6201919022).        |

La investigación previa de OpenCode constató que el stream inspeccionado no ofrece replay desde `Last-Event-ID`. Esto no impide crear SSE propio, pero tampoco permite reutilizar el stream como historial completo. Al perder la conexión con OpenCode se reconcilian sus recursos y se señalan las lagunas que no puedan recuperarse. [Conclusión y código fijado de la investigación previa](https://github.com/rubenbp/app-foundry/issues/3#issuecomment-6132966041).

## Qué cambia con SSE

SSE usa `text/event-stream`; el navegador dispone de `EventSource`, estados de conexión, reconexión y `Last-Event-ID`. Este último informa al servidor de un identificador recibido: el estándar no implementa el almacenamiento ni la reproducción por la aplicación. La reconexión no tiene un tiempo fijo garantizado. [HTML Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html#server-sent-events).

Es un canal unidireccional, adecuado para un panel de consulta. Las decisiones humanas continúan en GitHub; no hace falta WebSocket. MDN documenta la recepción y el cierre de SSE, y advierte del límite habitual de seis conexiones por navegador y dominio sobre HTTP/1.1. Una sola conexión por página resulta suficiente para este MVP; abrir muchas pestañas sería un caso a limitar o comprobar, sin introducir un shared worker preventivamente. [Guía de SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

Un proceso HTTP local puede mantener una respuesta abierta y escribir sucesivos fragmentos. Por ejemplo, Node 24 ya ofrece `response.write()` y `flushHeaders()`. También expone cuándo las escrituras quedan en memoria y el evento `drain`: si el cliente deja de consumir, no conviene acumular una cola ilimitada. Esto acredita viabilidad sin nuevas dependencias obligatorias; no elige Node como runtime de la Factory ni acredita que un framework futuro haga el flush correctamente. [HTTP de Node 24](https://nodejs.org/docs/latest-v24.x/api/http.html#responsewritechunk-encoding-callback), [flushHeaders](https://nodejs.org/docs/latest-v24.x/api/http.html#responseflushheaders).

## Comparación funcional

| Aspecto                   | Polling local cada 2 segundos                                                                                                                                                | SSE sencillo con reconciliación                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Actividad visible         | Mensajes y cambios llegan agrupados en cada consulta.                                                                                                                        | Cambios llegan al publicarlos la Factory; pueden agruparse para no repintar por token.                                                     |
| Demora añadida            | Aproximadamente 0–2 segundos de espera, más consulta y renderizado, con pestaña activa y servidor rápido. Media aproximada de 1 segundo si los cambios llegan uniformemente. | Elimina la espera del intervalo. Sigue habiendo persistencia, entrega, posible buffering y renderizado; no se promete una latencia exacta. |
| Tráfico en reposo         | Hasta unas 30 consultas/minuto por pestaña, 1.800/hora, si se mantiene la cadencia.                                                                                          | Una conexión abierta y heartbeats; menos solicitudes sin cambios.                                                                          |
| Primera carga             | Consulta inmediata de resumen y actividad reciente; historial bajo demanda.                                                                                                  | Estado inicial en el stream o consulta sincronizada con la suscripción; historial bajo demanda.                                            |
| Corte y reinicio          | Cada consulta nueva recupera el estado; hay que detectar errores, aplicar timeout y evitar solapes.                                                                          | `EventSource` ayuda a reconectar; al volver debe obtenerse un estado vigente y recuperar el detalle desde disco.                           |
| Historial                 | La persistencia previa evita perder transiciones entre dos consultas.                                                                                                        | La persistencia previa evita depender de eventos perdidos mientras no había conexión.                                                      |
| Recurso que exige gestión | Timer y petición en curso.                                                                                                                                                   | Conexión, listeners, heartbeat y cliente lento.                                                                                            |
| Qué no resuelve           | Pérdida de eventos antes de que la Factory los registre; incertidumbre externa.                                                                                              | Los mismos límites; mantener una conexión abierta no acredita actividad del agente.                                                        |

Las cifras de demora y tráfico son cálculos del intervalo propuesto, no benchmarks. El navegador puede retrasar timers; 2 segundos es una cadencia objetivo, no un SLA. Para evitar peticiones solapadas o respuestas fuera de orden se programa la siguiente consulta después de terminar la anterior, o se salta un tick si hay una en curso. [Advertencias de `setInterval`](https://developer.mozilla.org/en-US/docs/Web/API/Window/setInterval#delay_restrictions).

## Base común obligatoria

El trabajo principal existe en ambas opciones: capturar mensajes y herramientas observables, relacionarlos con Ejecución e Intento, persistir estado e historial, ocultar credenciales antes de guardarlas, mostrar tiempos y causas, y recuperar la vista tras recargar. La persistencia está acordada durante toda la evaluación; no se propone otra política de retención. [Contrato de persistencia y recuperación](https://github.com/rubenbp/app-foundry/issues/6#issuecomment-6202301293).

El resumen actual y la cronología son consultas diferentes. Una transición breve puede desaparecer del resumen antes del siguiente poll o antes de reconectar SSE; debe seguir consultable en el historial. Las salidas extensas no se reenvían completas en cada actualización: se recuperan bajo demanda o por tramos. Los mensajes que siguen creciendo necesitan identidad estable para actualizar su contenido sin duplicarlos. Son requisitos comunes del panel, no razones para implantar event sourcing.

Distinguir al menos última respuesta del servidor local, última observación correcta de OpenCode, GitHub y Vercel, y última actividad observable del agente. Un heartbeat o una respuesta REST correcta solo acredita el enlace local. El tiempo desde esa respuesta y el tiempo desde la actividad del agente no son intercambiables. Un aviso de posible bloqueo a los 2 minutos no declara un fallo ni autoriza un reintento; tampoco se activa por una espera humana conocida.

## Variante SSE mínima, sin replay propio

Si se elige SSE, no es necesario reproducir todos los eventos del transporte. Una opción es emitir un resumen versionado al conectar y notificar cambios posteriores. Otra es enviar solo una notificación que invalide la vista y provoque una consulta agrupada del mismo endpoint usado por polling. La persistencia sigue siendo la fuente del detalle. Estas son propuestas de diseño, no APIs existentes.

La suscripción debe establecerse de forma que un cambio entre la consulta inicial y la apertura del stream no quede invisible indefinidamente. Puede resolverse enviando el snapshot inicial desde la propia suscripción, usando una versión comparable y reconciliando después de conectar, sin diseñar un log de replay. Tras reconectar se vuelve a consultar, aunque la última versión conocida coincida, y se distingue un reinicio del servidor si sus versiones se reinician.

Añadir un heartbeat observable por JavaScript, por ejemplo cada 10 segundos, permite avisar tras 30 segundos sin respuesta aun cuando no cambie la fase. Un comentario SSE puede mantener vivo el enlace, pero no dispara un mensaje visible al código cliente; para medir salud en la página interesa un evento identificado. El formato y las diferencias entre campos y comentarios están definidos en el [estándar SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream). Los valores 10 y 30 segundos son una propuesta del producto, no una exigencia del protocolo.

Para un cliente lento se puede cerrar y obligar a reconciliar, en lugar de almacenar todos los eventos en memoria. Al cerrar la pestaña o perder el enlace se retiran listeners y timers. No añadir simultáneamente fallback automático a polling, un broker y replay general: serían otras funciones que verificar, sin necesidad demostrada.

## Estimación de esfuerzo

Estimación orientativa por descomposición, sin prototipo ni mediciones. Supone una persona que conoce HTTP y el runtime escogido, una Ejecución, una página de consulta local, mismo origen, sin proxy ni autenticación adicional del panel. Supone ya disponibles el resumen persistido, la consulta del historial y una forma interna de avisar de cambios. No incluye construir esa base común, la interfaz, integrar OpenCode, GitHub o Vercel, ni documentar el TFM.

| Trabajo incremental de transporte                                                                       | Rango orientativo                                                                   |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| REST con polling, timeout, ausencia de solapes, estado de conexión y comprobación de corte/reinicio     | 2–4 horas                                                                           |
| SSE sencillo, snapshot/reconciliación, heartbeat, limpieza, cliente lento y comprobaciones equivalentes | 4–8 horas                                                                           |
| Sobrecoste de SSE frente al polling sobre la misma base                                                 | Aproximadamente 2–4 horas; no sumar mecánicamente extremos de los rangos anteriores |

No son tarifas universales ni compromisos de entrega. Un framework familiar con streaming fiable puede reducir el diferencial a 1–2 horas. Elegir runtime y servidor, descubrir buffering, separar orígenes o carecer de notificaciones internas puede ampliarlo. Actualmente no hay código que permita verificar esos supuestos. Por eso resulta impropio asegurar que SSE serían «unas pocas líneas» o que necesariamente necesitaría varios días.

En este calendario, 2–4 horas representan aproximadamente una tarde o algo más de la disponibilidad ordinaria. La persistencia y observación seguirán siendo trabajo pendiente con ambas alternativas; ahorrarse SSE no elimina ese esfuerzo.

## Verificación que debe acompañar la elección

El experimento ya aceptado de recorrido normal y fallo provocado debe comprobar que aparece actividad reciente, que sus horas permiten conocer la antigüedad, y que los estados breves permanecen en el historial. Cortar el enlace del navegador y reiniciar la Factory debe recuperar lo persistido, señalar lo no observado y conservar las esperas o incertidumbres correctas, sin repetir trabajo del agente. La recuperación de la vista no equivale a autorizar la reanudación automática de la Ejecución.

Para polling, comprobar ausencia de solapes y que tras un fallo vuelve a consultar. Para SSE, comprobar además reapertura repetida sin listeners duplicados, ausencia de carrera inicial, heartbeat durante inactividad legítima y recuperación con un cliente lento. En ambos casos, un servidor accesible con OpenCode desconectado debe mostrar esa desconexión diferenciada, y un merge observado debe seguir separado de producción confirmada.

No se han ejecutado estas pruebas, un servidor o un modelo. Los hechos del protocolo proceden de fuentes oficiales; el esfuerzo, el diseño mínimo y la recomendación son inferencias acotadas al estado del repositorio y al calendario acordado.
