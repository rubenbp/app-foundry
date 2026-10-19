# App Foundry

Factory local que admite un Issue autorizado de GitHub, prepara un clon y una rama propios, comprueba la base, encarga un Intento a OpenCode y verifica independientemente el árbol del Commit candidato. Publica su PR, correlaciona la preview, presenta evidencias y habilita la revisión y aceptación mediante merge humano. El dashboard muestra cada fase y sus enlaces. Tras observar el merge humano autorizado, publica el resumen de integración, cierra el issue y completa la Ejecución.

La organización del código y sus límites se describen en [Arquitectura de la Factory](docs/architecture.md).

El [manual de negocio de la Factory](docs/manual/README.md) explica el ciclo completo de un issue con diagramas Mermaid, decisiones humanas, variantes e interacciones con GitHub y Vercel.

## Preparación

Requiere macOS, Node **24.21.0** y npm **11.19.0**. Admite OpenAI con OAuth, Gemini y Anthropic con API key, y Ollama local experimental. Configura el acceso y elige el modelo siguiendo la [guía de proveedores y modelos](docs/guides/llm-providers.md). No pongas credenciales en archivos del proyecto ni en la tarea. `@opencode/cli` y el SDK HTTP `@opencode/client` están fijados en **2.0.32** mediante `package-lock.json`. La Factory ejecuta el binario local y comprueba su versión y PID mediante `/api/info`. Para proveedores remotos, `opencodeCli` identifica la CLI que exporta en memoria la credencial activa existente; no cambia la cuenta global. Ollama no necesita esa ruta ni credenciales.

```sh
npm ci
node node_modules/@opencode/cli/postinstall.mjs
npm run typecheck
npm run build
cp config/factory.example.json factory.local.json
```

Edita `dataDir` y, para proveedores remotos, `opencodeCli` con rutas absolutas. `managedProjectFile` se resuelve respecto al archivo de configuración y apunta a configuración de confianza fuera del clon candidato. La configuración de Rebobina está en `config/managed-projects/rebobina.json`; se puede seleccionar otro repositorio, rama base, instrucciones, comandos y proyecto de publicación. `dataDir` debe ser una carpeta dedicada, persistente durante la evaluación y separada del código de Factory. Cada Ejecución conserva su clon en `dataDir/workspaces/ID`; la configuración, SQLite, artefactos y credenciales temporales permanecen fuera de ese clon. No se requieren clones previos. La cuenta de `gh` necesita lectura de issues, eventos y permisos efectivos, además de acceso al repositorio para clonarlo.

La pareja `provider`/`model` es global y queda fijada al arrancar. No hay lista manual de modelos permitidos: OpenCode debe reconocer el modelo, tenerlo habilitado y anunciar soporte de herramientas. Se usan sus valores predeterminados de variante. No hay cambio automático de modelo ni proveedor. Si queda una Ejecución iniciada y pendiente con otra selección, el arranque falla antes de recuperar trabajo o abrir los servidores. La cola nunca iniciada adopta la selección nueva al comenzar. Un coste SDK cero no acredita gratuidad. Ninguna prueba automatizada llama a modelos.

## Skills del agente

El catálogo común vive en `skills/` dentro de este repositorio y empieza vacío. Añade cada skill como `skills/<id>/SKILL.md`, con nombre, descripción y archivos auxiliares opcionales. El agente descubre las skills disponibles y carga las instrucciones cuando las necesita, mediante el soporte nativo de OpenCode. Cada Ejecución conserva una copia desde el primer arranque de su agente, incluidos Intentos posteriores y reinicios. Solo se autorizan las skills de la Factory; no se habilitan las globales ni las del Managed project. Consulta la [guía de skills](docs/guides/factory-skills.md) para añadirlas y conocer sus permisos.

## Uso

Para publicación, instala Vercel CLI **62.7.0** y autentica deliberadamente `gh` y `vercel login` con acceso al Managed project. Puedes indicar `vercelCli` con una ruta absoluta en la configuración de Factory; en su ausencia se usa `vercel` del PATH. La cuenta de GitHub necesita contenidos y PRs con escritura, comentarios, permisos efectivos y estados de commit. Solo la configuración explícita de protección requiere administración.

La configuración de publicación identifica `projectId`, `teamId`, `previewEnvironment` (por defecto `Preview`) y `versionPath` (por defecto `/version.json`). El marcador JSON debe contener `sha` con el SHA completo del build; `dirty: true` se rechaza. La Factory contrasta la identidad con la API de Vercel y utiliza `vercel curl` autenticado. Conserva un enlace local de CLI al proyecto configurado dentro de `dataDir/vercel-access`, fuera del clon. No reduce Deployment Protection ni entrega credenciales al agente. Un 401/403 o redirección deja el acceso pendiente; un error de consulta no acredita un deployment fallido.

Antes de usar el control de merge, revisa y ejecuta la configuración administrativa explícita:

```sh
node --experimental-strip-types scripts/configureMergeProtection.ts config/managed-projects/rebobina.json
```

Añade `Factory / ready-to-merge` y `Vercel`, exige PR, rama actualizada y conversaciones resueltas e incluye administradores. Conserva checks existentes y sus aplicaciones, restricciones, número de reviews y demás flags. La Factory no ejecuta este ajuste durante polling. Esta configuración no acredita por sí sola el recorrido de un Commit candidato.

```sh
npm start -- serve --config factory.local.json --port 4310
```

Abre [el Dashboard](http://127.0.0.1:4310). Un issue abierto del Managed project con `factory:ready` basta para admitir trabajo. La Factory consulta GitHub al arrancar y programa la siguiente consulta 15 segundos después de terminar, sin solapes, y consume cada issue una sola vez. Publica la rama y PR; la integración Git de Vercel crea los deployments. Retirar la label después de admitir no cancela la Ejecución.

La admisión solo exige un issue abierto del repositorio configurado con `factory:ready`, aún no consumido. La Factory confía en la gestión de etiquetas de GitHub: no consulta eventos, permisos del actor, tipo de cuenta ni historial de ediciones. Tampoco evalúa si el contenido está completo; incluso un cuerpo vacío se admite y el agente decide si necesita información relevante.

La captura conserva título, cuerpo, autor, momento de observación, configuración del Managed project y selección de proveedor/modelo/autenticación. Esta selección se actualiza a la global al comenzar si el trabajo nunca se había iniciado; después queda fijada para la Ejecución. Sirve como encargo inicial y bitácora: las ediciones posteriores del issue no actualizan el encargo ni bloquean la Ejecución. La cola sigue la primera observación; dentro de una misma consulta usa número de issue e identidad de la Ejecución como desempate estable. El historial anterior sigue siendo legible y sus datos de acreditación ya no condicionan la cola. Reiniciar conserva las peticiones en cola. Si el agente esperaba una respuesta humana, conserva esa espera y recupera la misma conversación al responder. Los demás trabajos iniciados quedan en intervención sin reenviar la tarea.

Antes de arrancar OpenCode, la Factory clona el repositorio configurado, crea `codex/execution-ID`, captura SHA e instrucciones de la base y ejecuta la preparación y todas las verificaciones configuradas. Conserva intención, confirmación, comandos, códigos y salidas saneadas. Un fallo de la base se atribuye a preparación, mantiene el puesto y nunca se presenta como regresión del agente. El mismo clon queda disponible para Intentos posteriores; no se reintenta automáticamente una preparación incierta.

Al observar el final del Intento, la siguiente iteración del workflow detiene el grupo propio de OpenCode antes de fijar el head. Exige ausencia de cambios sin commit, una base antecesora y la identidad del clon conservada. Captura el diff acumulado base–head y ejecuta los comandos sobre todo el árbol del Commit candidato; los resultados quedan vinculados a esos dos SHAs. Comprueba que los comandos no cambien head ni dejen ediciones sin incorporar. Un fallo detiene la Ejecución con su salida; los comandos posteriores quedan explícitamente sin ejecutar. No hay corrección ni reintento automático.

El MVP trabaja con operadores y repositorios de confianza. El agente puede añadir, modificar o eliminar pruebas, dependencias, lockfiles, scripts y configuración del producto cuando lo requiera el encargo. La comparación con la base conserva observaciones informativas sobre esos cambios en el Dashboard; no detiene la verificación ni la publicación por modificar esos archivos. `verification.surfaces` permite destacar otras rutas en esa comparación, sin convertirlas en rutas bloqueadas. La Factory ejecuta todos los comandos de la configuración de confianza externa al clon. Si un comando falla, desaparece o no aporta la evidencia E2E exigida, el resultado sigue sin superar el contrato. Una suite verde no garantiza que las pruebas sean suficientes; el diff y los cambios en las pruebas forman parte de la revisión humana.

El contrato de Rebobina conserva `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` y `pnpm test:e2e`. Para E2E, la configuración de confianza declara `command`, `configFile`, `serverCommand`, `origin`, `serves`, `reuseExistingServer: false` y `offline`. La Factory genera fuera del clon una configuración Playwright que conserva las pruebas del proyecto, sirve el build con un servidor propio y fija origen, modo offline, exclusividad prohibida e informe JSON. Un puerto ocupado falla; nunca reutiliza otro servidor. Conserva navegador/canal/ejecutable y número de pruebas. Las rutas de la configuración mantienen el directorio de origen, incluidos setup y teardown. Los adjuntos y medios nativos se omiten; el runtime temporal se elimina tras el comando. Código cero sin informe, sin pruebas ejecutadas o con pruebas omitidas, fallidas o inestables no acredita E2E. Esta ejecución local no acredita Vercel.

Cada criterio capturado muestra evidencia del contrato técnico y sus lagunas. Una suite verde no prueba automáticamente un criterio de negocio: el juicio humano y la evidencia específica permanecen pendientes. Al pasar el contrato, la Ejecución conserva el puesto en `awaiting_preview`; no acredita aceptación. El dashboard ofrece comandos, códigos, salidas saneadas, configuración, referencias y causas de detención. Cada comando conserva su PID/grupo para inspección. Cancelar durante verificación solicita una parada ordenada (SIGINT para Playwright, SIGTERM para otros comandos), espera su cierre y comprueba que su servidor E2E ya no escucha. Si necesita SIGKILL o la limpieza queda incierta, mantiene intervención y el puesto reservado. Un reinicio durante un comando tampoco permite liberar el puesto sin aclarar sus efectos. Un reinicio conserva evidencia y marca intervención sin repetir comandos. El diff y las salidas se conservan completos y saneados hasta el límite de captura del proceso; alcanzar ese límite exige intervención, nunca aprobación con evidencia truncada.

Después de verificar, la Factory registra intención antes de push, PR, comentarios y commit statuses, y confirmación después. Consulta hechos remotos antes de repetir una operación incierta; un reinicio en publicación solo observa y concilia los hechos ya ocurridos, retira el control favorable y mantiene intervención; no reanuda push ni publicación de PR sin recuperación autorizada. La PR referencia la petición sin fórmulas de cierre automático. La preview debe coincidir en head, repositorio, proyecto Vercel, entorno y marcador servido. `inactive` es espera, no build fallida.

La Factory refleja el estado del issue mediante etiquetas: `factory:queued`, `factory:in-progress`, `factory:needs-human`, `factory:pending-review`, `factory:completed` y `factory:stopped`. Sustituye `factory:ready` al admitir el encargo y conserva las etiquetas ajenas. La [tabla de estados](docs/manual/02-issue-y-trabajo.md#estados-visibles-en-github) describe la correspondencia y los errores de sincronización.

Al quedar lista la preview, publica en el issue un aviso breve con preview, PR e instrucciones para aceptar mediante merge o pedir cambios. No muestra el SHA ni duplica el aviso por consultas repetidas. Cada nueva entrega revisable puede publicar otro aviso reutilizando la conciliación existente.

La PR usa el título y la descripción funcional del agente, en castellano y con tres secciones: **Resumen**, **Evidencia** y **Riesgo de fusión**. Explica la necesidad, el comportamiento y alcance, el diseño cuando aporte, los contratos y pasos de despliegue, las pruebas realizadas, cómo reproducirlas y la reversibilidad y dependencias. No incluye radio de impacto. No hay validación editorial adicional; el agente declara lo pendiente y pide intervención cuando la necesita. Cada nueva entrega sustituye el texto completo. El [manual de revisión](docs/manual/03-verificacion-y-aceptacion.md#qué-debe-revisar-una-persona) describe el contenido esperado.

La Factory no publica el informe técnico como comentario de la PR. El Dashboard local conserva la evidencia técnica vigente: petición, base/head, diff, configuración, comandos, códigos y salidas saneadas, criterios y limitaciones. La descripción selecciona evidencia útil para personas no técnicas; no vuelca todos los logs. Las salidas corresponden a la última verificación y no constituyen un histórico completo por versión. Los criterios quedan pendientes de juicio humano; una suite verde no los acepta por sí sola.

La Factory habilita `Factory / ready-to-merge: success` cuando las verificaciones y la preview están acreditadas y la evidencia técnica está disponible. La persona revisa la preview y acepta los cambios haciendo merge de la PR. No hay comentario de aceptación ni fórmula con SHA. La Ejecución permanece en `awaiting_review` hasta el merge. Un nuevo head exige reverificación, preview y revisión nuevas. Una edición del título o la descripción no cambia el estado ni retira el control favorable; no se comprueba igualdad del texto. Pedir cambios o cancelar mantiene su efecto sobre el control.

Las órdenes completas `Corregir: instrucciones` y `Cancelar` en el issue conservan su comportamiento. Una corrección mantiene thread, rama y PR y exige nueva verificación y revisión. El polling no garantiza retirada instantánea del control; si falla la red, el Dashboard muestra la incertidumbre. La integración exige el registro local de revisión y el control técnico favorable anteriores al merge, el Commit candidato correcto y una persona con permiso de escritura. Un merge fuera del contrato queda como incidencia.

El humano escribe el objetivo y los criterios de aceptación en lenguaje natural. Los encabezados y listas son opcionales; también se acepta texto seguido. Puede añadir contexto o límites si ayudan, sin aportar JSON, selectores ni un plan técnico de comprobaciones. Por ejemplo:

```text
Quiero mostrar «Otra partida.» en el pie. Debe aparecer en la página de inicio y el enlace del pie de la página Sobre debe seguir permitiendo volver al inicio.
```

El agente interpreta el texto completo, resuelve las decisiones técnicas a partir del repositorio y prepara las pruebas pertinentes antes del merge. Si falta una decisión de producto, pide una aclaración concreta en lenguaje natural antes de implementar. El agente agrupa sus dudas en una petición explícita. La Factory la publica como comentario en el issue y deja la Ejecución en `waiting`, sin caducidad y con el puesto ocupado. El primer comentario humano nuevo posterior a esa pregunta vuelve como texto libre a la misma conversación del agente, sin comandos ni comprobaciones de permisos del autor. Se excluyen bots y comentarios de la Factory. Los comentarios publicados mientras el agente trabaja quedan sin procesar. Puede repetir este ciclo tantas veces como necesite antes de terminar el código; después continúan las verificaciones, la PR y la preview de Vercel. Esta respuesta no sustituye la aceptación del Commit candidato ni amplía los permisos técnicos del agente.

El creador del issue se responsabiliza de conseguir la revisión del preview. Cualquier persona con permiso efectivo de escritura puede aceptar la versión concreta haciendo merge de su PR. Cambiar el Commit candidato exige otra verificación, preview y aceptación.

Después del merge autorizado, la Factory conserva el Commit candidato aceptado y el commit integrado, publica un resumen de integración en el issue y confirma su cierre. Solo entonces marca `completed` y libera el puesto. `closing_issue` identifica este cierre en curso. Un issue cerrado manualmente tras el merge sigue necesitando el resumen y la integración autorizada. Si se pierde una confirmación remota, la siguiente consulta concilia el efecto antes de repetirlo. Un reinicio conserva la intervención y exige recuperación autorizada.

El MVP termina con la integración y el cierre del issue. No espera ni consulta deployments de producción, no navega por el dominio público y no genera un plan estructurado de comprobaciones de producción. La integración Git de Vercel puede desplegar la rama base por su cuenta; ese despliegue queda fuera del ciclo de la Factory.

El primer recorrido editorial es una prueba de desarrollo, no la evaluación formal del MVP. Requiere aceptación humana del Commit candidato y merge humano en GitHub; el caso de contenido y el filtro reservados a la evaluación no se preparan manualmente durante esta prueba.

Para detener una Ejecución concreta:

```sh
npm start -- stop --config factory.local.json --id ID_DE_EJECUCION
```

La tarea manual de lectura se conserva como herramienta de preparación: usa una configuración **sin** `managedProjectFile` y con `projectDir` absoluto a un clon desechable. Ese modo conserva la política de lectura del incremento anterior. En el workflow de issues, el control local rechaza `run`; ninguna tarea manual sustituye a la autorización de GitHub.

`run` devuelve la identidad y estado persistidos. `stop` exige esa identidad, solicita interrumpir la sesión, envía SIGTERM al grupo propio y, si sigue presente, SIGKILL. Comprueba su ausencia mediante señal 0. Registra por separado la incertidumbre sobre trabajo del proveedor y efectos ya realizados. Ctrl-C cierra la Factory. Si esperaba una respuesta humana, detiene el servidor del agente y conserva la espera y el thread para el próximo arranque; en los demás estados intenta la misma parada operativa.

Solo se admite una Ejecución activa. Dos procesos no pueden ocupar la misma raíz ni el mismo Managed project. Los comandos operativos usan un socket Unix con modo 0600. El servidor HTTP se enlaza a `127.0.0.1`, valida Host/origen y solo admite GET. El dashboard no concede permisos, responde preguntas ni acepta resultados. Las decisiones humanas permanecen en GitHub. Las aclaraciones del agente se responden mediante comentarios nuevos en el issue. Los errores de infraestructura, verificación y despliegue conservan su tratamiento operativo.

## Observación y datos

- El adaptador usa exclusivamente la API v2, abre eventos antes de enviar la tarea y conserva los formularios/preguntas y permisos pendientes. Conserva transiciones breves y reconcilia inmediatamente y cada 2 segundos, con timeout de 5 segundos y sin solapes. Una interrupción de eventos queda marcada sin asumir replay del stream global. Cada consulta recorre páginas de 200 mensajes, incluidos los mensajes existentes que hayan crecido; un timeout o cursor repetido marca cobertura parcial.
- El dashboard consulta inmediatamente y programa la siguiente consulta 2 segundos después de terminar la anterior. Separa respuesta local, observación correcta de OpenCode y actividad del agente. Avisa a los 30 segundos sin conexión y a los 2 minutos sin actividad automática; los avisos no reenvían tareas. Una espera humana suprime el aviso de inactividad automática.
- SQLite guarda instantáneas transaccionales con historial, Intento, sesión, PID, configuración efectiva seleccionada, mensajes identificados y consumo. Los textos extensos se guardan como artefactos atómicos y se consultan bajo demanda. El saneamiento elimina secretos conocidos del entorno y patrones de credenciales antes de escribir. No se archivan respuestas SDK crudas, logs nativos ni metadatos arbitrarios. Se marcan omisiones, truncamientos y lagunas; React presenta las salidas como texto.
- El consumo reemplaza la medida de cada mensaje por identidad; no suma además agregados de sesión. Los tokens ausentes y ceros sin base permanecen no disponibles. La estimación positiva del SDK se expresa en USD, con fuente, modalidad y cobertura; no es factura. Equivalente API y gasto acreditado permanecen no disponibles. La Factory no mantiene otra calculadora de tarifas.
- OpenCode usa entorno reducido, configuración propia y directorios nativos separados del clon. En el workflow, la política permite edición, búsqueda y comandos de desarrollo, incluida la instalación de dependencias, sin una lista literal de comandos shell. El agente debe trabajar en el clon y respetar el encargo; la configuración externa, las credenciales y los efectos de publicación pertenecen a la Factory. La Factory valida ruta, repositorio, remoto, rama y hooks antes de entregar el clon. Un guard de Git valida de nuevo la identidad en cada comando permitido; solo permite status, diff, add, commit, log, show y la consulta exacta `rev-parse HEAD` que necesita el marcador del build. Los permisos de comandos usan la acción `shell` de OpenCode v2. Desactiva hooks también mediante el entorno heredado por commits del agente, elimina helpers de credenciales y configura un remoto de push deshabilitado. Los efectos remotos quedan reservados a Factory. El modo de preparación manual conserva lectura y solicitudes de edición, sin shell. Se comprueba la configuración efectiva antes de crear sesión. El almacenamiento nativo de OpenCode pertenece al proveedor de ejecución y puede contener su historial original. En el workflow se conserva en `DATA_DIR/conversations/EXECUTION_ID` para recuperar el mismo thread; incluye los datos privados del runtime y no es evidencia saneada de Factory. El modo manual mantiene almacenamiento temporal y lo elimina tras comprobar la parada. Los comandos de preparación y pruebas también usan HOME dedicado y entorno reducido; solo el transporte Git de Factory para clon, push y fetch puede usar las credenciales de GitHub de confianza. Los scripts del repositorio pueden ejecutar código arbitrario: el guard y los permisos reducen efectos accidentales, no impiden que un proceso malicioso del mismo usuario los eluda. Estos permisos bajo el mismo usuario de macOS no constituyen aislamiento del sistema operativo.

Un fallo de persistencia bloquea nuevos efectos de Factory y se muestra en el dashboard. Detén manualmente el grupo de procesos registrado si no puede escribirse la parada. Al reiniciar, la Factory conserva el historial y **no reenvía** el encargo inicial. Una espera de respuesta humana conserva su thread: al llegar la respuesta, vuelve a conectarse al servidor propio mediante su conexión autenticada o lo arranca con el mismo almacenamiento si ya terminó. Las demás ejecuciones iniciadas quedan en intervención. No libera una Ejecución incierta automáticamente. Una reserva del repositorio asociada al data root y a la Ejecución se conserva aunque cierre la Factory o no se confirme la parada; otro data root queda bloqueado. Solo una parada confirmada libera esa reserva. Además del lock de proceso, la reserva se guarda en `/private/tmp/app-foundry-repository-HASH.reservation.json`. No la elimines ni cambies de data root para sortear una intervención: primero aclara la ausencia de procesos y efectos de la Ejecución registrada.

Para un proceso de una Factory anterior, revisa primero `ps -p PID -o pid,ppid,command` y el grupo con `ps -axo pid,pgid,command`. Tras confirmar que corresponde al servidor propio registrado, detén ese grupo desde la terminal y comprueba su ausencia. No elimines locks de procesos vivos ni uses un PID histórico sin comprobar su identidad. La recuperación del MVP se solicita en el issue con `Reintentar`, `Corregir: instrucciones` o `Cancelar`, según las acciones del aviso de intervención. Después del merge solo se reintentan el resumen y el cierre pendientes. Los límites automáticos y la recuperación operativa completa siguen fuera del MVP.

## Verificación

```sh
npm run typecheck
npm test
```

Las pruebas usan SQLite y artefactos temporales reales, SDK con un servidor HTTP doble y Chrome con el dashboard compilado/API local. Requieren poder abrir loopback y Google Chrome instalado; `playwright.config.ts` fija el canal `chrome`. Incluyen varias rondas de preguntas y respuestas por issue hasta PR y preview con fronteras remotas controladas, recuperación de una espera tras reinicio y conservación real del thread y su historial en OpenCode sin llamar al modelo. Incluyen también admisión/autorización con GitHub controlado, petición completa de más de 64 KiB, configuración alternativa, clon y rama Git reales, base fallida, rama alterada, cola, persistencia fallida, deduplicación, permisos/preguntas, parada, reinicio, exclusión de instancia, saneamiento, texto sin HTML, teclado, móvil, timeout y avisos con reloj controlado. La verificación cubre candidatos con varios commits y un defecto anterior al último, cambios sin commit, comandos ausentes, controles alterados, falta de evidencia E2E y cancelación de un comando real. Las pruebas de navegador ejecutan también E2E reales contra un build candidato temporal, comprueban el rechazo de un puerto ocupado y observan la evidencia desde el dashboard/API. La configuración alternativa con comandos e identidad diferentes usa dobles en las fronteras remotas; no acredita una segunda integración real.

Experimento real opcional, separado de las pruebas:

```sh
FACTORY_EXPERIMENT_PROJECT=/absolute/path/to/prepared-repository npm run experiment -- --real
```

Acepta una ruta local o URL HTTPS pública y crea un clon desechable, lee `package.json`, observa una solicitud de edición sin concederla y detiene sus procesos. El guard de 90 segundos por caso solo acota este experimento; no implementa los límites del workflow. Conserva el historial saneado fuera del código y una [ficha breve de evidencia](docs/evidence/opencode-panel/README.md).
