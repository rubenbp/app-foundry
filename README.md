# App Foundry

Factory local que admite una Petición autorizada desde GitHub, prepara un clon y una rama propios, comprueba la base, encarga un Intento a OpenCode y verifica independientemente el candidato completo. Publica su PR, correlaciona la preview, presenta evidencias y habilita el merge humano tras la aceptación del SHA. El panel muestra cada fase y sus enlaces. Tras observar el merge humano, correlaciona producción con el commit integrado y comprueba el dominio público, su marcador y las aserciones de la petición antes de publicar evidencia y cerrar el issue.

La organización del código y sus límites se describen en [Arquitectura de la Factory](docs/architecture.md).

El [manual de negocio de la Factory](docs/manual/README.md) explica el ciclo completo de un issue con diagramas Mermaid, decisiones humanas, variantes e interacciones con GitHub y Vercel.

## Preparación

Requiere macOS, Node **24.21.0**, npm **11.19.0** y una cuenta OpenAI OAuth activa en OpenCode v2. No pongas credenciales en archivos del proyecto ni en la tarea. `@opencode/cli` y el SDK HTTP `@opencode/client` están fijados en **2.0.32** mediante `package-lock.json`. La Factory ejecuta el binario local y comprueba su versión y PID mediante `/api/info`. La ruta `opencodeCli` de configuración solo sirve para exportar en memoria la cuenta OAuth activa existente; no cambia la cuenta global. El método OAuth y sus metadatos se conservan al importarlos en el servidor propio.

```sh
npm ci
node node_modules/@opencode/cli/postinstall.mjs
npm run typecheck
npm run build
cp config/factory.example.json factory.local.json
```

Edita `dataDir` y `opencodeCli` con rutas absolutas. `managedProjectFile` se resuelve respecto al archivo de configuración y apunta a configuración de confianza fuera del clon candidato. La configuración de Rebobina está en `config/managed-projects/rebobina.json`; se puede seleccionar otro repositorio, rama base, instrucciones, comandos y proyecto de publicación. `dataDir` debe ser una carpeta dedicada, persistente durante la evaluación y separada del código de Factory. Cada Ejecución conserva su clon en `dataDir/workspaces/ID`; la configuración, SQLite, artefactos y credenciales temporales permanecen fuera de ese clon. No se requieren clones previos. La cuenta de `gh` necesita lectura de issues, eventos y permisos efectivos, además de acceso al repositorio para clonarlo.

El único proveedor preparado es OpenAI mediante la cuenta OAuth de OpenCode. El modelo elegido por el usuario es [`gpt-6-luna`](https://developers.openai.com/api/docs/models/gpt-6-luna), con variante `low`. No hay cambio automático de modelo ni proveedor. OAuth consume la modalidad y cuota de esa cuenta; un coste SDK cero no acredita gratuidad. Ninguna prueba automatizada llama a modelos.

## Uso

Para publicación, instala Vercel CLI **62.7.0** y autentica deliberadamente `gh` y `vercel login` con acceso al Managed project. Puedes indicar `vercelCli` con una ruta absoluta en la configuración de Factory; en su ausencia se usa `vercel` del PATH. La cuenta de GitHub necesita contenidos y PRs con escritura, comentarios, permisos efectivos y estados de commit. Solo la configuración explícita de protección requiere administración.

La configuración de publicación identifica `projectId`, `teamId`, `previewEnvironment` (por defecto `Preview`) y `versionPath` (por defecto `/version.json`). El marcador JSON debe contener `sha` con el SHA completo del build; `dirty: true` se rechaza. La Factory contrasta la identidad con la API de Vercel y utiliza `vercel curl` autenticado. Conserva un enlace local de CLI al proyecto configurado dentro de `dataDir/vercel-access`, fuera del clon. No reduce Deployment Protection ni entrega credenciales al agente. Un 401/403 o redirección deja el acceso pendiente; un error de consulta no acredita un deployment fallido.

Antes de usar el control de merge, revisa y ejecuta la configuración administrativa explícita:

```sh
node --experimental-strip-types scripts/configureMergeProtection.ts config/managed-projects/rebobina.json
```

Añade `Factory / ready-to-merge` y `Vercel`, exige PR, rama actualizada y conversaciones resueltas e incluye administradores. Conserva checks existentes y sus aplicaciones, restricciones, número de reviews y demás flags. La Factory no ejecuta este ajuste durante polling. Esta configuración no acredita por sí sola el recorrido de un candidato.

```sh
npm start -- serve --config factory.local.json --port 4310
```

Abre [el panel local](http://127.0.0.1:4310). Una persona con permiso efectivo de escritura aplica `factory:ready` al issue del Managed project. La Factory consulta GitHub al arrancar y programa la siguiente consulta 15 segundos después de terminar, sin solapes, y consume cada issue una sola vez. Publica la rama y PR; la integración Git de Vercel crea los deployments. Retirar la label después de admitir no cancela la Ejecución.

La admisión relaciona el evento de label, su autor y el contenido estable observado. Comprueba permisos efectivos, última edición, cambios de título y una segunda lectura. Si faltan permisos para observarlos, hay ediciones coincidentes o el contenido cambia durante la consulta, no admite esa petición. Vuelve a autorizar con la label después de estabilizar el contenido. La comprobación es conservadora: una actividad posterior que actualice el issue también puede requerir una autorización nueva. No ofrece una transacción distribuida con GitHub. Referencias: [eventos de issues](https://docs.github.com/en/rest/issues/events) y [permisos efectivos](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user).

La petición fija conserva título, cuerpo completo con criterios, autor, evento de autorización, hash del contenido, configuración del Managed project y selección de proveedor/modelo/autenticación. La cola sigue el momento de observación de la autorización; dentro de una misma consulta usa fecha de autorización, número de issue e identidad como desempate estable. Reiniciar conserva las peticiones en cola; una Ejecución que ya había empezado queda en intervención y no se reenvía.

Antes de arrancar OpenCode, la Factory clona el repositorio configurado, crea `codex/execution-ID`, captura SHA e instrucciones de la base y ejecuta la preparación y todas las verificaciones configuradas. Conserva intención, confirmación, comandos, códigos y salidas saneadas. Un fallo de la base se atribuye a preparación, mantiene el puesto y nunca se presenta como regresión del agente. El mismo clon queda disponible para Intentos posteriores; no se reintenta automáticamente una preparación incierta.

Al observar el final del Intento, la siguiente iteración del workflow detiene el grupo propio de OpenCode antes de fijar el head. Exige ausencia de cambios sin commit, una base antecesora y la identidad del clon conservada. Captura el diff acumulado base–head y ejecuta los comandos sobre todo el árbol candidato; los resultados quedan vinculados a esos dos SHAs. Comprueba que los comandos no cambien head ni dejen ediciones sin incorporar. Un fallo detiene la Ejecución con su salida; los comandos posteriores quedan explícitamente sin ejecutar. No hay corrección ni reintento automático.

La comparación con la base vigila manifests, lockfiles, configuración, scripts, rutas de pruebas y fuentes de comandos reconocibles. `verification.surfaces` permite añadir archivos o directorios propios al conjunto protegido. Los cambios de configuración, eliminaciones o modificaciones de controles existentes y nuevas omisiones/exclusividades requieren intervención. Las pruebas nuevas sin esas señales siguen permitidas. La comparación es conservadora: puede pedir revisión por cambios inocuos y no garantiza detectar todo debilitamiento semántico.

El contrato de Rebobina conserva `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` y `pnpm test:e2e`. Para E2E, la configuración de confianza declara `command`, `configFile`, `serverCommand`, `origin`, `serves`, `reuseExistingServer: false` y `offline`. La Factory genera fuera del clon una configuración Playwright que conserva las pruebas del proyecto, sirve el build con un servidor propio y fija origen, modo offline, exclusividad prohibida e informe JSON. Un puerto ocupado falla; nunca reutiliza otro servidor. Conserva navegador/canal/ejecutable y número de pruebas. Las rutas de la configuración mantienen el directorio de origen, incluidos setup y teardown. Los adjuntos y medios nativos se omiten; el runtime temporal se elimina tras el comando. Código cero sin informe, sin pruebas ejecutadas o con pruebas omitidas, fallidas o inestables no acredita E2E. Esta ejecución local no acredita Vercel.

Cada criterio capturado muestra evidencia del contrato técnico y sus lagunas. Una suite verde no prueba automáticamente un criterio de negocio: el juicio humano y la evidencia específica permanecen pendientes. Al pasar el contrato, la Ejecución conserva el puesto en `awaiting_preview`; no acredita aceptación. El panel ofrece comandos, códigos, salidas saneadas, configuración, referencias y causas de detención. Cada comando conserva su PID/grupo para inspección. Cancelar durante verificación solicita una parada ordenada (SIGINT para Playwright, SIGTERM para otros comandos), espera su cierre y comprueba que su servidor E2E ya no escucha. Si necesita SIGKILL o la limpieza queda incierta, mantiene intervención y el puesto reservado. Un reinicio durante un comando tampoco permite liberar el puesto sin aclarar sus efectos. Un reinicio conserva evidencia y marca intervención sin repetir comandos. El diff y las salidas se conservan completos y saneados hasta el límite de captura del proceso; alcanzar ese límite exige intervención, nunca aprobación con evidencia truncada.

Después de verificar, la Factory registra intención antes de push, PR, comentarios y commit statuses, y confirmación después. Consulta hechos remotos antes de repetir una operación incierta; un reinicio en publicación solo observa y concilia los hechos ya ocurridos, revoca la aceptación activa y mantiene intervención; no reanuda push, PR ni informes sin recuperación autorizada. La PR referencia la petición sin fórmulas de cierre automático. La preview debe coincidir en head, repositorio, proyecto Vercel, entorno y marcador servido. `inactive` es espera, no build fallida.

El informe de la PR contiene petición, Ejecución, base/head, diff acumulado completo, verificaciones, relación criterio/evidencia, lagunas y preview. Si excede el tamaño de comentario, publica fragmentos enlazados sin truncar evidencia. Los criterios quedan pendientes de juicio humano; una suite verde no los acepta por sí sola. Para aceptar, responde en el issue o conversación principal de la PR con el ejemplo mostrado en el informe: `Acepto la versión SHA_COMPLETO y su preview URL.` Una referencia ambigua solicita un comentario nuevo con SHA y preview; una consulta no acepta. La Factory exige permiso efectivo, comentario sin editar, posterioridad al informe y coincidencia con la versión vigente. Consume cada ID una sola vez y excluye IDs, marcadores propios y bots, permitiendo una cuenta compartida sin afirmar separación técnica de identidades.

La aceptación vigente permite `Factory / ready-to-merge: success`. La persona realiza el merge en GitHub. Cambiar head invalida verificaciones, preview, informe y aceptación; la Factory obtiene esa cabecera en el mismo clon y vuelve a verificar. Cambiar la petición, retirar el permiso del aceptante, editar/eliminar el informe o cualquiera de sus fragmentos, o pedir corrección/cancelación revoca el control al observarlo. Las correcciones y cancelaciones completas requieren el incremento posterior y quedan en intervención. El polling no garantiza revocación instantánea; si falla la red, la revocación remota puede quedar sin confirmar. El panel muestra esa incertidumbre. Un merge observado conserva por separado base, candidato aceptado y commit integrado (incluido squash). Solo pasa a producción cuando conserva informe, aceptación anterior, permisos y control favorable; un merge fuera del contrato queda como incidencia.

La comprobación de producción exige el deployment GitHub del commit integrado, repositorio y entorno configurados (`productionEnvironment`, por defecto `Production`) y su identidad Vercel con `target: production` y el proyecto correcto. No usa `production_environment` como prueba. `pending` e `inactive` mantienen la espera; un error de consulta conserva la falta de observación y exige intervención, sin declarar el deployment fallido.

La petición autorizada debe incluir un único bloque JSON `factory-production`, bajo una sección distinta de los criterios. Cada comprobación relaciona un criterio numerado desde 1 con una ruta pública, selector visible y texto exacto o enlace interno; `follow: true` comprueba además la navegación. Por ejemplo:

````markdown
## Acceptance criteria

- [ ] El pie muestra «Otra partida.».
- [ ] Su enlace permite volver al inicio.

## Production checks

```factory-production
[
  {"criterion": 1, "path": "/", "selector": "footer p", "text": "Otra partida."},
  {"criterion": 2, "path": "/sobre/", "selector": "footer a", "href": "/", "follow": true}
]
```
````

Estas aserciones forman parte del alcance que la persona revisa al aceptar el candidato. La cobertura exige al menos una comprobación por criterio; no se infiere cobertura semántica de una suite verde. El incremento editorial comprueba contenido visible y navegación interna. Una petición con interacciones que estas aserciones no expresen necesita ampliar su verificación antes de acreditar producción. Un plan ausente o inválido exige intervención.

Chrome abre una sesión nueva, pública, online y sin credenciales; solo permite GET/HEAD al origen configurado. Comprueba el marcador del commit integrado antes y después de las aserciones, rechaza builds sucios y guarda resultados y capturas en `dataDir/production/`. Persiste el artefacto saneado y el informe en el issue antes del cierre. Un cierre manual no sustituye las comprobaciones ni cancela la Ejecución. Solo una producción acreditada termina como `completed` y libera el puesto; reiniciar conserva ese resultado. Fallo o incertidumbre después del merge conserva estado y evidencia en intervención, sin reanudar ni repetir efectos automáticamente. La recuperación completa y los límites de fase llegan en incrementos posteriores.

El primer recorrido editorial es una prueba de desarrollo, no la evaluación formal del MVP. Requiere aceptación humana del candidato y merge humano en GitHub; el caso de contenido y el filtro reservados a la evaluación no se preparan manualmente durante esta prueba.

Para detener una Ejecución concreta:

```sh
npm start -- stop --config factory.local.json --id ID_DE_EJECUCION
```

La tarea manual de lectura se conserva como herramienta de preparación: usa una configuración **sin** `managedProjectFile` y con `projectDir` absoluto a un clon desechable. Ese modo conserva la política de lectura del incremento anterior. En el workflow de issues, el control local rechaza `run`; ninguna tarea manual sustituye a la autorización de GitHub.

`run` devuelve la identidad y estado persistidos. `stop` exige esa identidad, solicita interrumpir la sesión, envía SIGTERM al grupo propio y, si sigue presente, SIGKILL. Comprueba su ausencia mediante señal 0. Registra por separado la incertidumbre sobre trabajo del proveedor y efectos ya realizados. Ctrl-C intenta la misma parada y cierra la Factory.

Solo se admite una Ejecución activa. Dos procesos no pueden ocupar la misma raíz ni el mismo Managed project. Los comandos operativos usan un socket Unix con modo 0600. El servidor HTTP se enlaza a `127.0.0.1`, valida Host/origen y solo admite GET. El panel no concede permisos, responde preguntas ni acepta resultados. Las decisiones humanas permanecen en GitHub. Para este incremento, una solicitud pendiente se inspecciona y se detiene; la continuación guiada llegará con el workflow posterior.

## Observación y datos

- El adaptador usa exclusivamente la API v2, abre eventos antes de enviar la tarea y conserva los formularios/preguntas y permisos pendientes. Conserva transiciones breves y reconcilia inmediatamente y cada 2 segundos, con timeout de 5 segundos y sin solapes. Una interrupción de eventos queda marcada sin asumir replay del stream global. Cada consulta recorre páginas de 200 mensajes, incluidos los mensajes existentes que hayan crecido; un timeout o cursor repetido marca cobertura parcial.
- El panel consulta inmediatamente y programa la siguiente consulta 2 segundos después de terminar la anterior. Separa respuesta local, observación correcta de OpenCode y actividad del agente. Avisa a los 30 segundos sin conexión y a los 2 minutos sin actividad automática; los avisos no reenvían tareas. Una espera humana suprime el aviso de inactividad automática.
- SQLite guarda instantáneas transaccionales con historial, Intento, sesión, PID, configuración efectiva seleccionada, mensajes identificados y consumo. Los textos extensos se guardan como artefactos atómicos y se consultan bajo demanda. El saneamiento elimina secretos conocidos del entorno y patrones de credenciales antes de escribir. No se archivan respuestas SDK crudas, logs nativos ni metadatos arbitrarios. Se marcan omisiones, truncamientos y lagunas; React presenta las salidas como texto.
- El consumo reemplaza la medida de cada mensaje por identidad; no suma además agregados de sesión. Los tokens ausentes y ceros sin base permanecen no disponibles. La estimación positiva del SDK se expresa en USD, con fuente, modalidad y cobertura; no es factura. Equivalente API y gasto acreditado permanecen no disponibles. La Factory no mantiene otra calculadora de tarifas.
- OpenCode usa entorno reducido, configuración propia y directorios nativos temporales separados del clon. En el workflow, la política permite edición, búsqueda, verificaciones configuradas y comandos locales de Git. La Factory valida ruta, repositorio, remoto, rama y hooks antes de entregar el clon. Un guard de Git valida de nuevo la identidad en cada comando permitido; solo permite status, diff, add, commit, log, show y la consulta exacta `rev-parse HEAD` que necesita el marcador del build. Los permisos de comandos usan la acción `shell` de OpenCode v2. Desactiva hooks también mediante el entorno heredado por commits del agente, elimina helpers de credenciales y configura un remoto de push deshabilitado. Los efectos remotos quedan reservados a Factory. El modo de preparación manual conserva lectura y solicitudes de edición, sin shell. Se comprueba la configuración efectiva antes de crear sesión. El almacenamiento temporal nativo de OpenCode pertenece al proveedor de ejecución y puede contener su historial original mientras vive; se elimina tras comprobar la parada. No es evidencia de Factory. Los comandos de preparación y pruebas también usan HOME dedicado y entorno reducido; solo el transporte Git de Factory para clon, push y fetch puede usar las credenciales de GitHub de confianza. Los scripts del repositorio pueden ejecutar código arbitrario: el guard y los permisos reducen efectos accidentales, no impiden que un proceso malicioso del mismo usuario los eluda. Estos permisos bajo el mismo usuario de macOS no constituyen aislamiento del sistema operativo.

Un fallo de persistencia bloquea nuevos efectos de Factory y se muestra en el panel. Detén manualmente el grupo de procesos registrado si no puede escribirse la parada. Al reiniciar, la Factory conserva historial, marca intervención y **no reenvía** tareas ni reclama posesión de procesos antiguos. No libera una Ejecución incierta automáticamente. Una reserva del repositorio asociada al data root y a la Ejecución se conserva aunque cierre la Factory o no se confirme la parada; otro data root queda bloqueado. Solo una parada confirmada libera esa reserva. Además del lock de proceso, la reserva se guarda en `/private/tmp/app-foundry-repository-HASH.reservation.json`. No la elimines ni cambies de data root para sortear una intervención: primero aclara la ausencia de procesos y efectos de la Ejecución registrada.

Para un proceso de una Factory anterior, revisa primero `ps -p PID -o pid,ppid,command` y el grupo con `ps -axo pid,pgid,command`. Tras confirmar que corresponde al servidor propio registrado, detén ese grupo desde la terminal y comprueba su ausencia. No elimines locks de procesos vivos ni uses un PID histórico sin comprobar su identidad. La recuperación asistida y los límites automáticos pertenecen a incrementos posteriores.

## Verificación

```sh
npm run typecheck
npm test
```

Las pruebas usan SQLite y artefactos temporales reales, SDK con un servidor HTTP doble y Chrome con el panel compilado/API local. Requieren poder abrir loopback y Google Chrome instalado; `playwright.config.ts` fija el canal `chrome`. Incluyen admisión/autorización con GitHub controlado, petición completa de más de 64 KiB, configuración alternativa, clon y rama Git reales, base fallida, rama alterada, cola, persistencia fallida, deduplicación, permisos/preguntas, parada, reinicio, exclusión de instancia, saneamiento, texto sin HTML, teclado, móvil, timeout y avisos con reloj controlado. La verificación cubre candidatos con varios commits y un defecto anterior al último, cambios sin commit, comandos ausentes, controles alterados, falta de evidencia E2E y cancelación de un comando real. Las pruebas de navegador ejecutan también E2E reales contra un build candidato temporal, comprueban el rechazo de un puerto ocupado y observan la evidencia desde el panel/API. La configuración alternativa con comandos e identidad diferentes usa dobles en las fronteras remotas; no acredita una segunda integración real.

Experimento real opcional, separado de las pruebas:

```sh
FACTORY_EXPERIMENT_PROJECT=/absolute/path/to/prepared-repository npm run experiment -- --real
```

Acepta una ruta local o URL HTTPS pública y crea un clon desechable, lee `package.json`, observa una solicitud de edición sin concederla y detiene sus procesos. El guard de 90 segundos por caso solo acota este experimento; no implementa los límites del workflow. Conserva el historial saneado fuera del código y una [ficha breve de evidencia](docs/evidence/opencode-panel/README.md).
