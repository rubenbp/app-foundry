# Preparación reproducible de Rebobina — incremento 01

Fecha: 16 de octubre de 2026, Europe/Madrid. Issue: [#13](https://github.com/rubenbp/app-foundry/issues/13). Preparación asistida, separada de los casos AFK y del coste por caso de evaluación.

**Estado: preparación completada, con contrato local, Preview final, merge humano y producción comprobados.** No se ha modificado ni cerrado la especificación padre #12.

## Identidad

- Factory inicial: `2a188b1ee0eceb7dc0c0e6ac35e601ce27bd5181`.
- Managed project: [rubenbp/appfoundry-site-demo](https://github.com/rubenbp/appfoundry-site-demo), base `8f35d44e1a6992330598cb2878c0e6765330ecd5`.
- Primer Commit candidato verificado: `2c72e7b12b68ab2716dd6330f11d341256d2e218`.
- Candidato final tras corregir indentación: `46c40730d5ed70c755642438f9c4394587cc5d0b`; contrato completo y Preview comprobados de nuevo.
- PR de preparación: [#2](https://github.com/rubenbp/appfoundry-site-demo/pull/2), rama `codex/prepare-rebobina-base`, destino `main`.
- Configuración de confianza: [`rebobina.json`](../../../config/managed-projects/rebobina.json). [Guía de reproducción y publicación](../../guides/rebobina-preparation.md).

## Base y correcciones previas

[`before/manifest.json`](before/manifest.json) identifica comandos, SHA y códigos iniciales. Build y tres unitarias pasan; seis E2E pasan en modo HTTP normal. Faltan scripts de lint y typecheck. `pnpm lint` intenta ejecutar una herramienta Android global y falla; `pnpm typecheck` no encuentra el comando. No cuentan como comprobaciones favorables.

Al activar `astro check` con `allowJs`/`checkJs`, aparecen 21 errores de tipos y dos hints: [`typecheck-first.log`](logs/typecheck-first.log). Se corrigen mediante JSDoc genérico en `filterGames`, tipos de la ayuda de capturas y comprobaciones DOM en las pruebas. Se elimina un parámetro sin uso en la portada. Las aserciones existentes permanecen y no se implementa contenido de evaluación.

## Contrato local observado

[`local-verification.json`](local-verification.json) conserva SHA, árbol limpio antes/después, SHA-256 del lockfile, versiones, intervalos UTC, comandos, códigos y marcador del candidato final. Todas las salidas son saneadas; las rutas personales y secuencias ANSI se sustituyen o eliminan y se normalizan espacios finales. El registro del primer candidato permanece en el commit Factory `5e8c089b896631b9ce53e874776382a94c637216`.

| Comando          | Código | Alcance y salida                                                  |
| ---------------- | ------ | ----------------------------------------------------------------- |
| `pnpm build`     | 0      | 37 páginas y marcador JSON; [log](logs/build.log)                 |
| `pnpm lint`      | 0      | Astro/TS/JS, sin incidencias; [log](logs/lint.log)                |
| `pnpm typecheck` | 0      | 25 archivos, cero errores/avisos/hints; [log](logs/typecheck.log) |
| `pnpm test:unit` | 0      | Tres pruebas, sin omitidas; [log](logs/test-unit.log)             |
| `pnpm test:e2e`  | 0      | Siete pruebas, sin omitidas; [log](logs/test-e2e.log)             |

Entorno observado: macOS arm64, Node `24.21.0`, pnpm `12.4.1`, Astro `7.3.8`, TypeScript `6.0.3`, Playwright `1.64.0`. Navegador: Google Chrome `155.0.8059.80`, ejecutable `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, proyecto Playwright `chromium`, headless. Python `3.14.6` sirve `dist/` en `127.0.0.1:4173`; servidor iniciado y detenido por Playwright, sin reutilización. `PLAYWRIGHT_OFFLINE`, `CAPTURE_DEMO` y `CHROME_PATH` sin definir. No se presentan estas pruebas como prueba de Vercel.

Reproducción adicional en clon temporal limpio: [instalación congelada](logs/fresh-install.log) y [build](logs/fresh-build.log), ambos código 0. Ejecutados con `npm exec --yes --package=pnpm@12.4.1 --`, igual que `vercel.json`; sin copiar `node_modules`. El checkout de reproducción corresponde al primer candidato.

## Pruebas observables de los controles

- Marcador servido: la E2E nueva recibe 404 antes de implementarlo ([rojo](logs/marker-red.log), código 1) y después 200 con el SHA esperado y `dirty: true` en el checkout aún modificado ([verde](logs/marker-green.log), código 0). La verificación del commit limpio sirve `dirty: false`.
- Puerto ocupado por servidor de prueba: Playwright termina con código 1 y avisa que ya está usado. No lo reutiliza ni mata el proceso ajeno. [Salida](logs/occupied-port.log).
- Modo de build Vercel con SHA `invalid`: código 1, error explícito del marcador. Es un experimento local y no un deployment remoto. [Salida](logs/invalid-sha.log).

## Accesos y política actual

[`access-checks.json`](access-checks.json) registra observaciones; [`branch-protection.json`](branch-protection.json) conserva la respuesta de GitHub. Repositorio público, acceso autenticado `ADMIN`; remoto local igual al repositorio del Managed project.

En `main` siguen vigentes PR obligatoria, enforcement para administradores, check `Vercel` de la app `8329`, rama actualizada, conversaciones resueltas, cero aprobaciones obligatorias, push forzado y eliminación desactivados. La cuenta compartida conserva capacidad de merge; no se afirma separación técnica de actores.

Dashboard Vercel comprobado mediante la sesión autorizada existente de Chrome: proyecto `appfoundry-site-demo`, equipo `rubenbpvs-projects`, Node `24.x`, framework Astro, raíz vacía, overrides de comandos desactivados antes de aplicar `vercel.json`. **Enable access to System Environment Variables** ya estaba activado; no se alteró. Vercel Authentication y Standard Protection permanecen habilitados. La regla existente de Trusted Sources permite desarrollo del mismo proyecto hacia Preview; no se modificó ni se crearon secretos de bypass.

Esta sesión comprueba acceso de preparación desde navegador y GitHub. No demuestra credenciales ni acceso HTTP automatizado del futuro proceso de Factory.

## Primera Preview comprobada

- SHA: `2c72e7b12b68ab2716dd6330f11d341256d2e218`.
- Deployment: `dpl_65Dk5nPZKfzbgSMFdmjQ5Gh34JVn`, [dashboard](https://vercel.com/rubenbpvs-projects/appfoundry-site-demo/65Dk5nPZKfzbgSMFdmjQ5Gh34JVn).
- GitHub deployment `7127724923`, entorno `Preview`, estado `success`, `2026-10-16T19:30:02Z`.
- Check `Vercel` y `Vercel Preview Comments`: `SUCCESS`. No había divergencia con `main` (`mergeStateStatus: CLEAN`).
- [Marcador de Preview](https://appfoundry-site-demo-6otbacfr0-rubenbpvs-projects.vercel.app/version.json), abierto mediante sesión autorizada existente de Vercel: `{"sha":"2c72e7b12b68ab2716dd6330f11d341256d2e218","dirty":false}`.
- El [extracto observado del log](logs/preview-build-excerpt.log) confirma Node `24.21.0`, pnpm `12.4.1` y Vercel CLI `64.0.2` en ese deployment. Local y remoto coinciden en Node/pnpm en esta observación. pnpm `10.28.0` pertenece al recorrido anterior de #9. No se infiere el parche de otros deployments a partir de este resultado.
- El log contiene dos avisos npm de `Unknown env config "cache-dir"`, procedentes del entorno del build. No impiden este build; el extracto los conserva. El contrato local no presenta errores de lint/tipos.
- [Captura del primer marcador](preview-first.jpg).

## Candidato final revisado y Preview

- SHA final: `46c40730d5ed70c755642438f9c4394587cc5d0b`. [Revisión técnica](review.md): Standards 0, Spec 0.
- Verificación final: 16/10/2026, 21:33:34–21:34:00 CEST; los cinco comandos terminan con código 0 sobre árbol limpio. Tres unitarias y siete E2E correctas, sin modo offline ni omitidas. [Registro completo](local-verification.json).
- Deployment: `dpl_9fUHUUQk5NgrMnTQWCFvBmTzsBSz`, [dashboard](https://vercel.com/rubenbpvs-projects/appfoundry-site-demo/9fUHUUQk5NgrMnTQWCFvBmTzsBSz).
- GitHub deployment `7127801099`, `Preview`, `success` a `2026-10-16T19:33:58Z`. Check `Vercel` y `Vercel Preview Comments`: `SUCCESS`; rama actualizada (`CLEAN`).
- [Preview inmutable](https://appfoundry-site-demo-6y7laptul-rubenbpvs-projects.vercel.app/) y [marcador](https://appfoundry-site-demo-6y7laptul-rubenbpvs-projects.vercel.app/version.json). Apertura en sesión autorizada existente: `{"sha":"46c40730d5ed70c755642438f9c4394587cc5d0b","dirty":false}`. [Captura del marcador](preview-final.jpg).
- Se abre la portada y se navega mediante el enlace Catálogo: aparecen buscador, consola, época, géneros y 33 juegos. [Captura de portada](preview-page.jpg). Es una comprobación acotada del deployment; las siete E2E se ejecutaron localmente.
- La prueba de Preview usa la sesión de Vercel existente, sin crear credenciales, enlaces públicos de acceso ni modificar protección.

## Integración humana y producción comprobadas

- La PR se entregó para revisión humana con el head `46c40730d5ed70c755642438f9c4394587cc5d0b`, pruebas y Preview. GitHub confirma merge por `rubenbp` el 16/10/2026 a las **21:44:51 CEST** (`2026-10-16T19:44:51Z`). El usuario lo confirmó en esta conversación: «merge finalizado».
- GitHub no contiene una review formal ni un comentario independiente de aceptación. La evidencia conservada es la integración humana y su confirmación; no se inventa una aprobación separada ni se presenta como validación del futuro protocolo de aceptación de la Factory.
- Commit integrado mediante squash: `9133647c7e99964802dd2485d0ef8221f97c9b73`. Su árbol y el del candidato probado son idénticos: `867f162258ff56fa6fd7387237e57d4da35a599b`; `git diff --exit-code <candidato> <integrado>` devuelve 0. Las comprobaciones locales siguen identificadas con el candidato; no se atribuyen ejecuciones nuevas al commit de squash.
- Deployment Production: `dpl_CaXEtZrAf8w6Ka7Ffz2TMeWXtkvo`, [dashboard](https://vercel.com/rubenbpvs-projects/appfoundry-site-demo/CaXEtZrAf8w6Ka7Ffz2TMeWXtkvo). GitHub deployment `7128016397`, estado `success` a las **21:45:19 CEST**, sobre el SHA integrado. Dashboard `Ready`, entorno `Production`, rama `main`, dominio principal asignado. Check `Vercel`: `success`.
- [Dominio público](https://rebobina-appfoundry.vercel.app/) y [marcador](https://rebobina-appfoundry.vercel.app/version.json): comprobación HTTP el 16/10/2026 a las **21:55:01 CEST**, sin cookies ni autenticación y con `Cache-Control: no-cache`/`Pragma: no-cache`. Respuesta 200, `Age: 0`, `X-Vercel-Cache: MISS`, cuerpo `{"sha":"9133647c7e99964802dd2485d0ef8221f97c9b73","dirty":false}`. El navegador confirma el mismo marcador. [Captura](production-marker.jpg).
- El [extracto de build de producción](logs/production-build-excerpt.log) confirma Node `24.21.0` y pnpm `12.4.1`; coinciden con las versiones locales observadas. Se conserva el aviso npm de configuración `cache-dir`; no impidió el build.
- Comprobación acotada en navegador del dominio de producción: [portada](production-page.jpg), navegación a catálogo con 33 juegos, filtros Plataformas + Mega Drive con **un resultado**, contador «1 juego en el archivo», URL coherente y ficha Sonic the Hedgehog 2. [Captura de filtros](production-filter.jpg).
- La página editorial conserva su introducción original: «Rebobina es una guía para elegir tu siguiente partida. Un sitio donde el recuerdo se encuentra con la curiosidad.» No se ha implementado el texto exacto ni el filtro de dificultad de evaluación.

[`production-verification.json`](production-verification.json) conserva identidad, actor, tiempos, HTTP, equivalencia de árboles y alcance de estas observaciones. Son pruebas acotadas de publicación real; las siete E2E y el contrato completo se ejecutaron localmente sobre el candidato limpio. Este recorrido es preparación asistida, no un caso AFK ni una prueba del futuro Workflow.
