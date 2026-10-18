# 7. Poner en marcha la Factory y probar un issue real

[Índice](README.md) · [Descripción del issue lista para copiar](ejemplo-issue-prueba-local.md)

Esta guía arranca la Factory en el Mac y trabaja contra el GitHub y Vercel reales de Rebobina. El agente consume la cuenta OAuth activa de OpenCode. El merge que hagas al final actualizará producción.

## 1. Estado comprobado en este equipo

Comprobación realizada el 18 de octubre de 2026:

| Elemento                            | Resultado observado                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Node / npm                          | `24.21.0` / `11.19.0`.                                                                         |
| GitHub CLI                          | Cuenta `rubenbp` autenticada, con escritura y administración sobre el Managed project.         |
| Managed project                     | `rubenbp/appfoundry-site-demo`, rama `main`.                                                   |
| OpenCode global                     | `2.0.26`, con `auth export` y una cuenta OpenAI OAuth activa.                                  |
| OpenCode propio de Factory          | Binario local `2.0.32`, instalado.                                                             |
| Vercel CLI                          | `62.7.0`, disponible en una ruta de caché npm; no como `vercel` en el PATH observado.          |
| Acceso Vercel                       | Cuenta `rubenbpv`, proyecto `rubenbpvs-projects/appfoundry-site-demo`.                         |
| Conexión Git de Vercel              | Repositorio correcto, producción desde `main` y variables de sistema habilitadas.              |
| Protección de `main`                | Exige `Vercel` y `Factory / ready-to-merge`, con rama actualizada y administradores incluidos. |
| Issues abiertos con `factory:ready` | Ninguno en la consulta realizada.                                                              |
| `factory.local.json` existente      | Modo manual de lectura, sin `managedProjectFile`. No usarlo para esta prueba.                  |

Los accesos remotos pueden cambiar. Estas observaciones no acreditan todavía una Ejecución nueva ni un Commit candidato desplegado.

## 2. Preparar la terminal

Abre una terminal normal de macOS y entra en la Factory:

```sh
cd /Users/rubenbp/dev/jakala-tfm/app-foundry
node --version
npm --version
python3 --version
```

Debe estar instalado Google Chrome en `/Applications/Google Chrome.app`: la comprobación pública de producción lo usa. El puerto `4173` debe quedar libre para el servidor E2E de la Factory; no dejes otro preview usándolo.

```sh
lsof -nP -iTCP:4173 -sTCP:LISTEN
lsof -nP -iTCP:4310 -sTCP:LISTEN
```

Sin salida significa que no se ha encontrado un proceso escuchando. Si hay uno, identifica y detén tu servidor antes de continuar.

Prepara dependencias y dashboard:

```sh
npm ci
node node_modules/@opencode/cli/postinstall.mjs
node_modules/@opencode/cli/bin/opencode.exe --version
npm run typecheck
npm run build
```

El binario debe mostrar `2.0.32`. Se ejecuta directamente; no se pasa a `node`. El global puede tener otra versión porque solo se usa para leer en memoria la cuenta OAuth activa existente.

Comprueba pnpm desde el Managed project, que declara `pnpm@12.14.0`:

```sh
cd /Users/rubenbp/dev/jakala-tfm/appfoundry-site-demo
pnpm --version
cd /Users/rubenbp/dev/jakala-tfm/app-foundry
```

Debe resolver `12.14.0`. La primera selección puede descargar esa versión. Si no tienes pnpm, instálalo con `npm install --global pnpm@12.14.0` y revisa `command -v pnpm`. Consultarlo dentro de la Factory puede dar `ERR_PNPM_OTHER_PM_EXPECTED`, porque ese repositorio declara npm; no implica que el producto use npm.

La Factory clonará `main` de GitHub por su cuenta. No consume los cambios sin publicar de tu checkout vecino, ni necesitas arrancar Astro aparte. Las guías antiguas del producto mencionan pnpm `12.4.1`; para este arranque se ha contrastado `package.json` actual de `main`, que declara `12.14.0`.

## 3. Comprobar las sesiones

```sh
gh auth status
opencode auth list
/Users/rubenbp/.npm/_npx/43d8461e34b9b106/node_modules/.bin/vercel whoami
```

Las sesiones estaban disponibles en la comprobación. Si GitHub deja de estar autenticado, ejecuta `gh auth login --hostname github.com`. Si OpenCode no tiene la cuenta deseada, usa `opencode auth login openai` y selecciona OAuth; para elegir entre cuentas existentes usa `opencode auth switch --help`. No pegues credenciales ni ejecutes `auth export` para mostrarlas en pantalla.

Si Vercel pide autenticación, usa la misma CLI con `login` y completa el acceso en el navegador. Es el [flujo oficial de Vercel CLI](https://vercel.com/docs/cli/login).

La ruta de Vercel citada pertenece a una caché ya comprobada. Si desaparece, instala `npm install --global vercel@62.7.0`, obtén su ruta con `command -v vercel` y actualiza `vercelCli` en la configuración del paso siguiente.

## 4. Usar la configuración de la prueba

Se ha preparado este archivo local:

```text
/private/tmp/app-foundry-prueba-local.json
```

Apunta al Managed project de Rebobina y conserva los datos en:

```text
/Users/rubenbp/.local/share/app-foundry/prueba-local
```

Esa carpeta es independiente del código. No borres sus datos entre reinicios para intentar recuperar una Ejecución. El `factory.local.json` anterior no se ha modificado.

Como `/private/tmp` es temporal, puedes reconstruir el archivo si desaparece. Este es su contenido:

```json
{
  "dataDir": "/Users/rubenbp/.local/share/app-foundry/prueba-local",
  "provider": "openai",
  "model": "gpt-6-luna",
  "auth": "opencode",
  "opencodeCli": "/opt/homebrew/bin/opencode",
  "vercelCli": "/Users/rubenbp/.npm/_npx/43d8461e34b9b106/node_modules/.bin/vercel",
  "managedProjectFile": "/Users/rubenbp/dev/jakala-tfm/app-foundry/config/managed-projects/rebobina.json"
}
```

Los IDs de Vercel y el dominio están en la configuración de confianza del Managed project. No hace falta hacer `vercel link` sobre el repositorio de la Factory ni ejecutar `vercel --prod`.

## 5. Arrancar y ver el dashboard

En la primera terminal:

```sh
npm start -- serve --config /private/tmp/app-foundry-prueba-local.json --port 4310
```

Deja esa terminal abierta durante todo el recorrido. Abre [http://127.0.0.1:4310](http://127.0.0.1:4310).

El dashboard debería mostrar la Factory sin Ejecución activa. El arranque consulta automáticamente los issues abiertos con `factory:ready` del Managed project; comprueba que no hayas autorizado otros trabajos que no quieras ejecutar todavía.

Si la carpeta de datos ya tenía una Ejecución iniciada, puede aparecer en intervención. No arranques otra instancia ni borres reservas para saltarla; inspecciona esa Ejecución.

La protección de `main` ya estaba configurada al preparar esta guía. Solo si falta, la operación administrativa explícita es:

```sh
node --experimental-strip-types scripts/configureMergeProtection.ts config/managed-projects/rebobina.json
```

Ese comando cambia las reglas de GitHub. No es necesario repetirlo para cada prueba.

## 6. Crear el issue sin autorizar todavía

En una segunda terminal:

```sh
cd /Users/rubenbp/dev/jakala-tfm/app-foundry
gh issue create --repo rubenbp/appfoundry-site-demo \
  --title "Prueba local: actualizar el mensaje del pie de Rebobina" \
  --body-file docs/manual/ejemplo-issue-prueba-local.md
```

Apunta el número que devuelve GitHub. Lee el [cuerpo preparado](ejemplo-issue-prueba-local.md) antes de autorizarlo: cambia únicamente el mensaje del pie y conserva la vuelta al inicio. Incluye tres criterios y tres comprobaciones públicas. No toca los casos de introducción editorial ni filtro de dificultad reservados a la evaluación.

La sección de entrega pide que el agente use un autor explícito asociado a `rubenbp`. La Factory establece por defecto `factory@localhost`, y cambiar tu `git config --global user.email` no sustituye ese valor del entorno. Vercel puede bloquear la preview si no atribuye el autor; su [documentación de colaboración](https://vercel.com/docs/deployments/troubleshoot-project-collaboration) explica esa comprobación. La instrucción usa `git commit --author`, permitido por el control Git local, sin cambiar el runtime. Verifica el autor de los commits en la PR; este paso depende de que el agente siga la instrucción.

## 7. Autorizar y observar

Sustituye `NUMERO_DEL_ISSUE` por el número real:

```sh
gh label list --repo rubenbp/appfoundry-site-demo --search factory:ready
```

Si la etiqueta no existe, créala una sola vez:

```sh
gh label create factory:ready --repo rubenbp/appfoundry-site-demo \
  --description "Issue revisado y autorizado para la Factory" --color 0E8A16
```

Aplica la autorización cuando el título y cuerpo ya estén definitivos:

```sh
gh issue edit NUMERO_DEL_ISSUE --repo rubenbp/appfoundry-site-demo \
  --add-label factory:ready
```

El dashboard debería pasar por cola, preparación, trabajo del agente, verificación y espera de preview. La Factory consulta de nuevo unos 15 segundos después de terminar la consulta anterior; la preparación y las pruebas pueden tardar varios minutos.

No edites el issue ni añadas comentarios de prueba inmediatamente después de aplicar la etiqueta. La admisión relaciona la autorización con el contenido estable; otras actualizaciones pueden hacerla ambigua. Si aún no se admitió, estabiliza y vuelve a aplicar la etiqueta. Si ya se admitió, volver a etiquetar no reejecuta el issue.

La Factory creará una rama y una PR. Vercel producirá la preview por la integración Git. Si aparece intervención, abre la causa y las salidas del dashboard antes de seguir; no aceptes para intentar desbloquear una verificación fallida.

## 8. Revisar y aceptar

Abre la PR desde el dashboard y lee el informe vigente. Abre su preview con tu sesión Vercel y comprueba:

1. El nuevo texto del pie en `/`.
2. El mismo texto en `/sobre-rebobina/`.
3. Que el enlace de marca del pie permite volver al inicio.

Publica un comentario nuevo en el issue o la conversación principal de la PR, copiando SHA completo y URL del informe:

```text
Acepto la versión SHA_COMPLETO y su preview URL_EXACTA_DEL_INFORME.
```

Puedes hacerlo desde la web de GitHub. No edites el comentario después, no uses solo «Approve» y no sustituyas el SHA por el número de PR.

Espera `awaiting_merge` y `Factory / ready-to-merge: success`. Si cambia el Commit candidato, hay que revisar y aceptar el nuevo SHA.

## 9. Hacer merge y comprobar el cierre

Haz el merge manualmente en GitHub cuando estén favorables los controles de Factory y Vercel. Mantén encendida la Factory.

El dashboard debe pasar a `checking_production`. Cuando el deployment de producción esté listo, la Factory comprobará la versión y los tres criterios en el dominio público, publicará el informe en el issue y lo cerrará. El resultado final debe ser `completed`.

Puedes observar el sitio y el marcador:

```sh
open https://rebobina-appfoundry.vercel.app
curl --fail --silent --show-error -H 'Cache-Control: no-cache' \
  https://rebobina-appfoundry.vercel.app/version.json
```

El `sha` debe ser el commit integrado, que puede diferir del Commit candidato si usaste squash. Debe mostrar `dirty: false`. El marcador por sí solo no sustituye los criterios ni el informe de producción.

## 10. Detener y repetir con otra petición

Al completar, puedes cerrar la Factory con `Ctrl-C`. Para detener una Ejecución activa desde otra terminal:

```sh
cd /Users/rubenbp/dev/jakala-tfm/app-foundry
npm start -- stop --config /private/tmp/app-foundry-prueba-local.json --id ID_DE_EJECUCION
```

Usa el ID del dashboard. Una parada confirmada no revierte cambios ya integrados ni elimina ramas o PR. Un reinicio a mitad del recorrido deja intervención; no reanuda el trabajo automáticamente.

Para probar otro cambio crea otro issue con un resultado diferente, una vez completado o detenido el anterior. El mismo issue no se consume dos veces dentro de ese historial.

## Si no avanza

| Lo que ves                      | Qué revisar                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| No aparece ningún issue         | Repo correcto, etiqueta, permiso de escritura y contenido estable.                                               |
| Fallo de preparación            | Salida concreta: instalación, pnpm, Node, base defectuosa o puerto `4173` ocupado. La Factory usa `main` remoto. |
| `waiting`                       | Pregunta o permiso del agente. La continuación guiada aún no está disponible.                                    |
| Preview ausente o rechazada     | Estado de Vercel, autor Git reconocido y SHA del deployment.                                                     |
| Preview protegida sin acreditar | Sesión de la CLI indicada por `vercelCli`, proyecto y acceso; conservar Deployment Protection.                   |
| No acepta el comentario         | SHA y URL exactos, comentario nuevo posterior al informe, autor con escritura.                                   |
| Producción en intervención      | Marcador del commit integrado, checks públicos, acceso y salidas. No hay reintento ni rollback automático.       |
| Intervención tras reiniciar     | Inspeccionar procesos y efectos. No borrar datos o reservas para ocultar el trabajo pendiente.                   |
