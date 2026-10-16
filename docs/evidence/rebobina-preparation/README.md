# Preparación reproducible de Rebobina — incremento 01

Fecha: 16 de octubre de 2026, Europe/Madrid. Issue: [#13](https://github.com/rubenbp/app-foundry/issues/13). Preparación asistida, separada de los casos AFK y del coste por caso de evaluación.

**Estado: contrato local acreditado y primera Preview comprobada; pendientes la revisión/aceptación humanas, el merge humano y comprobar producción. El issue no está completado.** No se ha modificado ni cerrado la especificación padre #12.

## Identidad

- Factory inicial: `2a188b1ee0eceb7dc0c0e6ac35e601ce27bd5181`.
- Managed project: [rubenbp/appfoundry-site-demo](https://github.com/rubenbp/appfoundry-site-demo), base `8f35d44e1a6992330598cb2878c0e6765330ecd5`.
- Primer candidato verificado: `2c72e7b12b68ab2716dd6330f11d341256d2e218`.
- Corrección posterior de indentación: `46c40730d5ed70c755642438f9c4394587cc5d0b`; necesita nueva verificación y Preview antes de aceptación.
- PR de preparación: [#2](https://github.com/rubenbp/appfoundry-site-demo/pull/2), rama `codex/prepare-rebobina-base`, destino `main`.
- Configuración de confianza: [`rebobina.json`](../../../config/managed-projects/rebobina.json). [Guía de reproducción y publicación](../../guides/rebobina-preparation.md).

## Base y correcciones previas

[`before/manifest.json`](before/manifest.json) identifica comandos, SHA y códigos iniciales. Build y tres unitarias pasan; seis E2E pasan en modo HTTP normal. Faltan scripts de lint y typecheck. `pnpm lint` intenta ejecutar una herramienta Android global y falla; `pnpm typecheck` no encuentra el comando. No cuentan como comprobaciones favorables.

Al activar `astro check` con `allowJs`/`checkJs`, aparecen 21 errores de tipos y dos hints: [`typecheck-first.log`](logs/typecheck-first.log). Se corrigen mediante JSDoc genérico en `filterGames`, tipos de la ayuda de capturas y comprobaciones DOM en las pruebas. Se elimina un parámetro sin uso en la portada. Las aserciones existentes permanecen y no se implementa contenido de evaluación.

## Contrato local observado

[`local-verification.json`](local-verification.json) conserva SHA, árbol limpio antes/después, SHA-256 del lockfile, versiones, intervalos UTC, comandos, códigos y marcador del primer candidato. Todas las salidas son saneadas; las rutas personales se sustituyen por `<home>`/`<managed-project>`.

| Comando | Código | Alcance y salida |
| --- | --- | --- |
| `pnpm build` | 0 | 37 páginas y marcador JSON; [log](logs/build.log) |
| `pnpm lint` | 0 | Astro/TS/JS, sin incidencias; [log](logs/lint.log) |
| `pnpm typecheck` | 0 | 25 archivos, cero errores/avisos/hints; [log](logs/typecheck.log) |
| `pnpm test:unit` | 0 | Tres pruebas, sin omitidas; [log](logs/test-unit.log) |
| `pnpm test:e2e` | 0 | Siete pruebas, sin omitidas; [log](logs/test-e2e.log) |

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
- La versión de parche de Node remota todavía no se ha observado; Node `24.x` es solo la configuración. pnpm `10.28.0` pertenece al recorrido anterior de #9, no a esta nueva Preview.

## Pendiente de intervención humana y producción

Tras la revisión técnica, actualizar y comprobar la Preview del head definitivo. La persona debe revisar el diff de herramientas/pruebas, aceptar ese SHA en GitHub y realizar el merge allí. Ninguna ejecución local o check autoriza automáticamente el merge.

Después se registrarán actor/timestamp de aceptación y merge, SHA integrado, deployment Production, versiones remotas observadas y respuesta sin caché de `https://rebobina-appfoundry.vercel.app/version.json`, además de navegación y contenido esperado. Hoy no existe evidencia de producción del nuevo marcador. No se cerrará #13 antes de completarla.
