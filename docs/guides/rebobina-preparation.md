# Preparar y verificar Rebobina

Contrato de preparación del [incremento #13](https://github.com/rubenbp/app-foundry/issues/13), previo a cualquier Ejecución AFK. Complementa la [guía GitHub–Vercel](vercel-setup.md). El Managed project es `rubenbp/appfoundry-site-demo`; la Factory mantiene su repositorio independiente.

## Configuración del Managed project

[`config/managed-projects/rebobina.json`](../../config/managed-projects/rebobina.json) conserva identidad, rama, instrucciones, herramientas, comandos y publicación sin credenciales ni rutas personales. Es el contrato declarativo de esta preparación; todavía no existe un runtime de Factory que lo cargue o valide. Su integración corresponde a los incrementos siguientes. No presupone un esquema definitivo del Workflow.

Mantener esta configuración de confianza fuera del clon del candidato. El futuro Workflow debe consumirla sin reglas de negocio específicas de Rebobina. Cambiar de Managed project exige proporcionar su contrato, comprobar accesos y verificar su base; el MVP admite uno configurado y una Ejecución activa.

## Reproducción local

En un checkout identificado del Managed project:

```sh
git rev-parse HEAD
git status --short
fnm use --install-if-missing
node --version
npm exec --yes --package=pnpm@12.4.1 -- pnpm --version
npm exec --yes --package=pnpm@12.4.1 -- pnpm install --frozen-lockfile
python3 --version
```

Node local fijado: `24.21.0` en `.node-version`. pnpm: `12.4.1` en `packageManager`. Si no se usa `fnm`, seleccionar esa versión de Node con el gestor disponible. Si pnpm no está en PATH, ejecutar los comandos siguientes con el prefijo `npm exec --yes --package=pnpm@12.4.1 --`.

Las dependencias directas tienen versiones exactas y las transitivas quedan en el lockfile. Astro `7.3.8` utiliza TypeScript `6.0.3`, `@astrojs/check` `0.9.10`, ESLint `10.13.0`, `eslint-plugin-astro` `3.2.1` y `typescript-eslint` `8.71.2`. pnpm 12 incluye el gestor y el grafo del producto en documentos del mismo lockfile: no sustituirlo por uno regenerado con pnpm 10. La excepción de antigüedad de ESLint es puntual y versionada; no elimina la política para el resto de dependencias.

Un checkout con cambios sin incorporar sirve para diagnóstico, pero no acredita una base limpia. Registrar SHA, estado del árbol, sistema, versiones efectivas y hash del lockfile antes de ejecutar:

```sh
pnpm build
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:e2e
```

Ejecutar los cinco comandos, incluso si uno falla, y conservar código de salida y salida saneada de cada uno. Una comprobación ausente, no ejecutada o con resultado desconocido no es favorable. Repetir sobre el árbol del Commit candidato de la PR y registrar también la base; no limitarlo al último commit.

## Alcance y servidor E2E

- Build: 33 fichas Markdown, páginas y marcador estático de versión.
- Lint: JS, TS y Astro del repositorio con las reglas recomendadas; excluye dependencias y resultados generados.
- Typecheck: `astro check`, configuración estricta, `allowJs` y `checkJs`; incluye lógica `.mjs`, scripts, componentes, pruebas y configuración.
- Unitarias: las tres pruebas de `filterGames`; todavía no existe filtro de dificultad.
- E2E: los seis recorridos previos del catálogo y una comprobación nueva de identidad del build servido.

`pnpm test:e2e` genera de nuevo `dist/` y Playwright inicia un proceso Python propio en `127.0.0.1:4173`. `reuseExistingServer: false` también en local. Puerto ocupado significa fallo, sin reutilización ni terminación de procesos ajenos. Playwright detiene el proceso propio al finalizar. Ejecutar secuencialmente este contrato.

Selección de navegador: `CHROME_PATH`, Chrome de macOS si existe y, en otro caso, Chromium de Playwright. Instalar este último con `pnpm exec playwright install chromium` cuando sea necesario. Guardar ruta/versión efectiva, Playwright, modo headless y variables especiales. `PLAYWRIGHT_OFFLINE=1` intercepta archivos para diagnóstico; no equivale al contrato HTTP normal ni acredita Vercel. Dejarlo sin definir para la evidencia de preparación. `CAPTURE_DEMO=1` agrega capturas locales; declarar su uso.

## Build e identidad remota

Vercel mantiene Node `24.x`, sin promesa de un parche fijo. El log de cada build imprime `node --version` y `pnpm --version`: solo ese dato observado acredita las versiones remotas de ese deployment. Un selector `24.x` no demuestra un parche ni su igualdad con el local.

El `vercel.json` del Managed project usa `npm exec --yes --package=pnpm@12.4.1 --` tanto para la instalación congelada como para el build. Vercel no debe inferir pnpm a partir del formato 9 del lockfile. La [documentación de Vercel](https://vercel.com/docs/package-managers) distingue esa inferencia de una selección explícita.

En **Environment Variables**, verificar **Enable access to System Environment Variables**. Es la configuración que expone [`VERCEL_GIT_COMMIT_SHA`](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_git_commit_sha). No crear un SHA fijo manualmente como variable: debe corresponder al commit de cada build Git.

Cada build Astro genera `/version.json`, mediante un [endpoint estático](https://docs.astro.build/en/guides/endpoints/). Su respuesta contiene `sha` completo y `dirty`. En local consulta Git; en Vercel requiere un SHA válido de la integración Git y falla sin él. No contiene tokens, variables completas ni datos personales. Para acreditar un commit exigir SHA esperado y `dirty: false`. Un árbol local modificado queda explícitamente marcado.

## Preview, revisión y producción

1. Publicar los cambios de preparación mediante PR contra `main`. No hacer push directo, merge automático ni modificar la especificación padre #12.
2. Comprobar check `Vercel`, rama actualizada y resolución de conversaciones. Mantener PR obligatoria para administradores, cero aprobaciones obligatorias en este proyecto de una sola cuenta, sin push forzado ni eliminación de `main`.
3. Correlacionar el deployment Preview correcto con repositorio, proyecto y SHA del head. Abrir su URL inmutable con la sesión autorizada existente de Vercel y comprobar `/version.json` sin caché. No reducir Deployment Protection ni guardar cookies o tokens como evidencia.
4. Revisar diff completo, cambios de verificaciones, resultados, navegación y preview. Registrar la aceptación humana en GitHub vinculada al SHA vigente. Si cambia el head, repetir verificación y aceptación.
5. Una persona realiza el merge en GitHub. Guardar su actor, timestamp y SHA resultante, incluido squash. Preparar y probar código no constituye esa aceptación.
6. Esperar un deployment Production correcto de ese SHA. Consultar el dominio público y su `/version.json` sin caché; exigir el SHA integrado y `dirty: false`, además del comportamiento previsto. Guardar HTTP, cuerpo, URL, fecha y deployment. No clasificar solo mediante `production_environment`, observado como falso en esta integración.

La sesión de Chrome puede acreditar acceso humano autorizado a Preview; no acredita por sí sola credenciales del futuro proceso de Factory. Para HTTP automatizado protegido, usar la autenticación existente con `vercel curl` cuando la CLI esté disponible. El conector MCP puede tener permisos distintos de los del navegador; registrar fallos de acceso sin inventar resultados.

Mientras falten revisión, merge o comprobación de producción, la preparación no está terminada. Una prueba local, un check verde, un HTTP 200 aislado y un merge son hechos distintos.

## Evidencia y separación de evaluación

Conservar en [`docs/evidence/rebobina-preparation/`](../evidence/rebobina-preparation/README.md) el SHA inicial, candidato y merge, comandos, códigos, logs saneados, toolchain, alcance, navegador, modos especiales, protección, preview y decisión humana. Revisar salidas antes de versionarlas; excluir credenciales, estados de autenticación y volcados completos del entorno.

Este incremento corresponde a preparación/construcción. No implementar el texto exacto de introducción ni el filtro de dificultad reservados a #12. No contabilizar este trabajo como Intento AFK ni como resultado de los casos de evaluación. No añadir todavía límites, dashboard, OpenCode, concurrencia, worktrees o backend.
