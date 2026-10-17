# App Foundry

Factory local para ejecutar una tarea acotada con OpenCode y observarla desde un panel de consulta. Este incremento prepara el runtime; todavía no implementa la admisión de issues, aceptación, integración ni publicación del workflow completo de #12.

## Preparación

Requiere macOS, Node **24.21.0**, npm **11.19.0** y `GEMINI_API_KEY` disponible en el entorno. No pongas la credencial en un archivo del proyecto ni en la tarea. El adaptador entrega esa misma credencial a la variable `GOOGLE_GENERATIVE_AI_API_KEY` que requiere el proveedor. OpenCode y `@opencode-ai/sdk` están fijados en **1.19.3** mediante `package-lock.json`; se ejecuta el binario local, no el instalado globalmente.

```sh
npm ci
npm run typecheck
npm run build
cp config/factory.example.json factory.local.json
```

Edita las dos rutas absolutas de `factory.local.json`. `projectDir` apunta al clon preparado del Managed project. `dataDir` debe ser una carpeta dedicada, persistente durante la evaluación y separada tanto del código de Factory como del clon. Para la preparación usa un clon desechable de Rebobina, sin archivos de credenciales. La configuración de producto de Rebobina permanece en `config/managed-projects/rebobina.json`.

El único proveedor preparado es Google mediante API. El modelo del experimento es `gemini-3.8-flash`; `gemini-2.5-flash` devolvió 404 en esta cuenta. Consulta el [modelo oficial](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash). Una llamada real puede generar gasto; ninguna prueba automatizada llama a modelos.

## Uso

```sh
npm start -- serve --config factory.local.json --port 4310
```

Abre [el panel local](http://127.0.0.1:4310). La Factory sirve el build de Vite. No necesita otro servicio permanente. En otra terminal, escribe una tarea de lectura pequeña en `/tmp/factory-task.txt` y ejecuta:

```sh
npm start -- run --config factory.local.json --task-file /tmp/factory-task.txt
npm start -- stop --config factory.local.json --id ID_DE_EJECUCION
```

`run` devuelve la identidad y estado persistidos. `stop` exige esa identidad, solicita abortar la sesión, envía SIGTERM al grupo propio y, si sigue presente, SIGKILL. Comprueba su ausencia mediante señal 0. Registra por separado la incertidumbre sobre trabajo del proveedor y efectos ya realizados. Ctrl-C intenta la misma parada y cierra la Factory.

Solo se admite una Ejecución activa. Dos procesos no pueden ocupar la misma raíz ni el mismo Managed project. Los comandos operativos usan un socket Unix con modo 0600. El servidor HTTP se enlaza a `127.0.0.1`, valida Host/origen y solo admite GET. El panel no concede permisos, responde preguntas ni acepta resultados. Las decisiones humanas permanecen en GitHub. Para este incremento, una solicitud pendiente se inspecciona y se detiene; la continuación guiada llegará con el workflow posterior.

## Observación y datos

- El adaptador abre eventos antes de enviar la tarea. Conserva transiciones breves y reconcilia inmediatamente y cada 2 segundos, con timeout de 5 segundos y sin solapes. Una interrupción de eventos queda marcada porque OpenCode no ofrece replay. Cada consulta reconcilia hasta 200 mensajes; alcanzar ese límite marca cobertura parcial.
- El panel consulta inmediatamente y programa la siguiente consulta 2 segundos después de terminar la anterior. Separa respuesta local, observación correcta de OpenCode y actividad del agente. Avisa a los 30 segundos sin conexión y a los 2 minutos sin actividad automática; los avisos no reenvían tareas. Una espera humana suprime el aviso de inactividad automática.
- SQLite guarda instantáneas transaccionales con historial, Intento, sesión, PID, configuración efectiva seleccionada, mensajes identificados y consumo. Los textos extensos se guardan como artefactos atómicos y se consultan bajo demanda. El saneamiento elimina secretos conocidos del entorno y patrones de credenciales antes de escribir. No se archivan respuestas SDK crudas, logs nativos ni metadatos arbitrarios. Se marcan omisiones, truncamientos y lagunas; React presenta las salidas como texto.
- El consumo reemplaza la medida de cada mensaje por identidad; no suma además agregados de sesión. Los tokens ausentes y ceros sin base permanecen no disponibles. La estimación positiva del SDK se expresa en USD, con fuente, modalidad y cobertura; no es factura. Equivalente API y gasto acreditado permanecen no disponibles. La Factory no mantiene otra calculadora de tarifas.
- OpenCode usa entorno reducido, configuración propia y directorios nativos temporales separados del clon. Sus permisos permiten lectura, solicitan edición/búsqueda y bloquean shell, delegación, acceso externo y herramientas remotas. Se comprueba la configuración efectiva antes de crear sesión. El almacenamiento temporal nativo de OpenCode pertenece al proveedor de ejecución y puede contener su historial original mientras vive; se elimina tras comprobar la parada. No es evidencia de Factory. Estos permisos bajo el mismo usuario de macOS no constituyen aislamiento del sistema operativo.

Un fallo de persistencia bloquea nuevos efectos de Factory y se muestra en el panel. Detén manualmente el grupo de procesos registrado si no puede escribirse la parada. Al reiniciar, la Factory conserva historial, marca intervención y **no reenvía** tareas ni reclama posesión de procesos antiguos. No libera una Ejecución incierta automáticamente.

Para un proceso de una Factory anterior, revisa primero `ps -p PID -o pid,ppid,command` y el grupo con `ps -axo pid,pgid,command`. Tras confirmar que corresponde al servidor propio registrado, detén ese grupo desde la terminal y comprueba su ausencia. No elimines locks de procesos vivos ni uses un PID histórico sin comprobar su identidad. La recuperación asistida y los límites automáticos pertenecen a incrementos posteriores.

## Verificación

```sh
npm run typecheck
npm test
```

Las pruebas usan SQLite y artefactos temporales reales, SDK con un servidor HTTP doble y Chrome con el panel compilado/API local. Requieren poder abrir loopback y Google Chrome instalado; `playwright.config.ts` fija el canal `chrome`. Incluyen persistencia fallida, deduplicación, permisos/preguntas, parada, reinicio, exclusión de instancia, saneamiento, texto sin HTML, teclado, móvil, timeout y avisos con reloj controlado.

Experimento real opcional, separado de las pruebas:

```sh
FACTORY_EXPERIMENT_PROJECT=/absolute/path/to/prepared-repository npm run experiment -- --real
```

Crea un clon local desechable, lee `package.json`, observa una solicitud de edición sin concederla y detiene sus procesos. El guard de 90 segundos por caso solo acota este experimento; no implementa los límites del workflow. Conserva el historial saneado fuera del código y una [ficha breve de evidencia](docs/evidence/opencode-panel/README.md).
