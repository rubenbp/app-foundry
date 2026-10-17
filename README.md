# App Foundry

Factory local que admite una Petición autorizada desde GitHub, prepara un clon y una rama propios, comprueba la base y encarga un Intento a OpenCode. El panel muestra la cola, la petición fija, la preparación y la implementación. La aceptación, integración y publicación del workflow completo de #12 pertenecen a los siguientes incrementos.

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

```sh
npm start -- serve --config factory.local.json --port 4310
```

Abre [el panel local](http://127.0.0.1:4310). Una persona con permiso efectivo de escritura aplica `factory:ready` al issue del Managed project. La Factory consulta GitHub al arrancar y cada 15 segundos, sin solapes, y consume cada issue una sola vez. No crea ni modifica issues, PRs ni deployments en este incremento. Retirar la label después de admitir no cancela la Ejecución.

La admisión relaciona el evento de label, su autor y el contenido estable observado. Comprueba permisos efectivos, última edición, cambios de título y una segunda lectura. Si faltan permisos para observarlos, hay ediciones coincidentes o el contenido cambia durante la consulta, no admite esa petición. Vuelve a autorizar con la label después de estabilizar el contenido. La comprobación es conservadora: una actividad posterior que actualice el issue también puede requerir una autorización nueva. No ofrece una transacción distribuida con GitHub. Referencias: [eventos de issues](https://docs.github.com/en/rest/issues/events) y [permisos efectivos](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user).

La petición fija conserva título, cuerpo completo con criterios, autor, evento de autorización, hash del contenido, configuración del Managed project y selección de proveedor/modelo/autenticación. La cola sigue el momento de observación de la autorización; dentro de una misma consulta usa fecha de autorización, número de issue e identidad como desempate estable. Reiniciar conserva las peticiones en cola; una Ejecución que ya había empezado queda en intervención y no se reenvía.

Antes de arrancar OpenCode, la Factory clona el repositorio configurado, crea `codex/execution-ID`, captura SHA e instrucciones de la base y ejecuta la preparación y todas las verificaciones configuradas. Conserva intención, confirmación, comandos, códigos y salidas saneadas. Un fallo de la base se atribuye a preparación, mantiene el puesto y nunca se presenta como regresión del agente. El mismo clon queda disponible para Intentos posteriores; no se reintenta automáticamente una preparación incierta.

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
- OpenCode usa entorno reducido, configuración propia y directorios nativos temporales separados del clon. En el workflow, la política permite edición, búsqueda, verificaciones configuradas y comandos locales de Git. La Factory valida ruta, repositorio, remoto, rama y hooks antes de entregar el clon. Un guard de Git valida de nuevo la identidad en cada comando permitido; solo permite status, diff, add, commit, log y show. Desactiva hooks también mediante el entorno heredado por commits del agente, elimina helpers de credenciales y configura un remoto de push deshabilitado. Los efectos remotos quedan reservados a Factory. El modo de preparación manual conserva lectura y solicitudes de edición, sin shell. Se comprueba la configuración efectiva antes de crear sesión. El almacenamiento temporal nativo de OpenCode pertenece al proveedor de ejecución y puede contener su historial original mientras vive; se elimina tras comprobar la parada. No es evidencia de Factory. Los comandos de preparación y pruebas también usan HOME dedicado y entorno reducido; solo el transporte del clon puede usar las credenciales de GitHub de confianza. Los scripts del repositorio pueden ejecutar código arbitrario: el guard y los permisos reducen efectos accidentales, no impiden que un proceso malicioso del mismo usuario los eluda. Estos permisos bajo el mismo usuario de macOS no constituyen aislamiento del sistema operativo.

Un fallo de persistencia bloquea nuevos efectos de Factory y se muestra en el panel. Detén manualmente el grupo de procesos registrado si no puede escribirse la parada. Al reiniciar, la Factory conserva historial, marca intervención y **no reenvía** tareas ni reclama posesión de procesos antiguos. No libera una Ejecución incierta automáticamente. Una reserva del repositorio asociada al data root y a la Ejecución se conserva aunque cierre la Factory o no se confirme la parada; otro data root queda bloqueado. Solo una parada confirmada libera esa reserva. Además del lock de proceso, la reserva se guarda en `/private/tmp/app-foundry-repository-HASH.reservation.json`. No la elimines ni cambies de data root para sortear una intervención: primero aclara la ausencia de procesos y efectos de la Ejecución registrada.

Para un proceso de una Factory anterior, revisa primero `ps -p PID -o pid,ppid,command` y el grupo con `ps -axo pid,pgid,command`. Tras confirmar que corresponde al servidor propio registrado, detén ese grupo desde la terminal y comprueba su ausencia. No elimines locks de procesos vivos ni uses un PID histórico sin comprobar su identidad. La recuperación asistida y los límites automáticos pertenecen a incrementos posteriores.

## Verificación

```sh
npm run typecheck
npm test
```

Las pruebas usan SQLite y artefactos temporales reales, SDK con un servidor HTTP doble y Chrome con el panel compilado/API local. Requieren poder abrir loopback y Google Chrome instalado; `playwright.config.ts` fija el canal `chrome`. Incluyen admisión/autorización con GitHub controlado, petición completa de más de 64 KiB, configuración alternativa, clon y rama Git reales, base fallida, rama alterada, cola, persistencia fallida, deduplicación, permisos/preguntas, parada, reinicio, exclusión de instancia, saneamiento, texto sin HTML, teclado, móvil, timeout y avisos con reloj controlado. La configuración alternativa con comandos e identidad diferentes usa dobles en las fronteras remotas; no acredita una segunda integración real.

Experimento real opcional, separado de las pruebas:

```sh
FACTORY_EXPERIMENT_PROJECT=/absolute/path/to/prepared-repository npm run experiment -- --real
```

Acepta una ruta local o URL HTTPS pública y crea un clon desechable, lee `package.json`, observa una solicitud de edición sin concederla y detiene sus procesos. El guard de 90 segundos por caso solo acota este experimento; no implementa los límites del workflow. Conserva el historial saneado fuera del código y una [ficha breve de evidencia](docs/evidence/opencode-panel/README.md).
