# Prueba GitHub–Vercel de Rebobina

Fecha: 14 de octubre de 2026. Estado: recorrido rama → preview → aceptación humana → merge → producción comprobado.

Esta prueba prepara infraestructura. No es uno de los casos de evaluación de la Factory y no acredita que OpenCode ni el workflow AFK estén implementados.

## Proyecto y base

- Managed project: [Rebobina](https://github.com/rubenbp/appfoundry-site-demo), repositorio público, rama de producción `main`.
- Base local y remota: `a3ccdc73237895195690c68891d819bdfbbc828a`.
- Autor de la base y del commit de prueba: la identidad Git configurada de Ruben Bernardez. La integración ha aceptado ambos commits.
- Equipo Vercel: `rubenbpvs-projects`, plan Hobby, ID `team_lO097zw1T7irxaAeicmM02ne`.
- Proyecto Vercel: `appfoundry-site-demo`, ID `prj_xELrnqlWcsy0MNKqyZN2Dekd0PKE`.
- Dominio principal: [rebobina-appfoundry.vercel.app](https://rebobina-appfoundry.vercel.app).
- Producción base: [deployment](https://vercel.com/rubenbpvs-projects/appfoundry-site-demo/4SoP5svX7Kk81i2k1yLkwW1UdiUy), estado GitHub `success`, 14/10/2026 20:20:02 CEST. ID GitHub `7073626033`.

## Configuración observada

Comprobada en el dashboard autenticado de Vercel:

| Parámetro | Valor |
| --- | --- |
| Framework | Astro |
| Root Directory | Vacío: raíz del repositorio |
| Install Command | Detección automática; el build ejecutado usa pnpm 10.28.0 |
| Build Command | Automático; el log confirma `pnpm run build` → `astro build` |
| Output Directory | `dist` (Astro estático); Vercel empaqueta en `/vercel/output` |
| Node.js Version | `24.x` en Settings → Build and Deployment |
| Rama de producción | `main` |
| Auto-assign Custom Production Domains | Activado |
| Preview | Todas las ramas Git no asignadas a otro entorno |
| Pull Request Comments | Activado |
| Commit Status | Activado |
| deployment_status Events | Activado |
| repository_dispatch Events | Activado |
| Deployment Protection | Vercel Authentication, Standard Protection |
| Deployment Checks de Vercel | Ninguno configurado |
| Build machine | Basic: 2 CPU, 8 GB |
| Concurrencia de builds | Uno cada vez |

Preview requiere una sesión autorizada de Vercel; se ha abierto con la sesión existente de `rubenbpv`. El dominio principal de producción es público. La política de protección no se ha modificado.

Versiones locales observadas: Node `24.21.0`, pnpm `12.4.1`. Dependencias instaladas: Astro `7.3.8`, Playwright `1.64.0`. El log remoto confirma Vercel CLI `62.7.0`, pnpm `10.28.0`, y lockfile versión 9. Node remoto está configurado como `24.x`; no se ha observado su versión de parche.

El build remoto advierte que `engines.node: >=22.12.0` puede seleccionar una nueva versión mayor en el futuro. `packageManager` no está fijado. Esto debe concretarse al preparar la reproducción del contrato de verificación; esta PR de prueba solo cambia una línea de contenido.

## Integración y decisión humana

Política acordada con el usuario y aplicada a `main`:

- Pull request obligatoria, también para administradores.
- Check `Vercel` obligatorio, con rama actualizada respecto de `main`. GitHub lo asocia a la aplicación Vercel, ID `8329`.
- Push forzado y eliminación de `main` desactivados; conversaciones resueltas antes del merge.
- Cero reviews de aprobación obligatorias, para permitir el recorrido con una sola cuenta: una cuenta no puede aprobar su propia PR.
- La persona acepta la preview y el SHA vigente en la conversación antes del merge; se documenta esa aceptación con su SHA y fuente en GitHub.

La protección evita el push directo como camino ordinario, pero la cuenta compartida por agente y persona conserva capacidad de merge y de administración. No hay separación técnica de identidades: la evidencia de intervención humana y el punto de espera deben preservarse en el futuro workflow. Esta política es provisional para la prueba de infraestructura.

## Preview comprobada

- PR: [chore: verify GitHub–Vercel deployment cycle](https://github.com/rubenbp/appfoundry-site-demo/pull/1).
- Rama: `codex/verify-github-vercel`.
- SHA: `613941e540ae4f92d6153028cadfed704d5fc849`.
- Cambio: el pie pasa de «Proyecto de demostración · 2026» a «Demo de App Foundry · 2026».
- Deployment Vercel: `dpl_7Nh8ryXFywFjaW3TTiSupqK2r9br`, [dashboard](https://vercel.com/rubenbpvs-projects/appfoundry-site-demo/7Nh8ryXFywFjaW3TTiSupqK2r9br).
- [URL del deployment](https://appfoundry-site-demo-wb7cfbzpn-rubenbpvs-projects.vercel.app): comprobado el texto nuevo.
- [Alias de rama](https://appfoundry-site-demo-git-codex-verify-ea7f9b-rubenbpvs-projects.vercel.app): comprobado el texto nuevo; este alias puede cambiar con futuros pushes.
- Estado dashboard: `Ready`; duración de build mostrada: 13 s; finalización: 14/10/2026 21:22:39 CEST.
- ID GitHub: `7075021104`, estado `success` publicado a las 21:22:40 CEST.
- Status `Vercel`: `SUCCESS`; check `Vercel Preview Comments`: `SUCCESS`.
- Producción comprobada antes del merge: conserva «Proyecto de demostración · 2026».
- Validación local: `pnpm build`, 37 páginas; `pnpm test:unit`, tres pruebas superadas; `git diff --check` correcto.
- No se han ejecutado lint/typecheck: todavía no existen esos scripts en la base. Las E2E no se han ejecutado para este cambio de texto. El contrato completo de la Factory sigue pendiente de implementación.

## Evidencias visuales

- [Preview, pie](preview-footer.jpg).
- [Preview, deployment y SHA](preview-deployment.jpg).
- [Producción antes del merge](production-before.jpg).
- [Producción después del merge](production-after.jpg).
- [Deployment final y SHA de producción](production-deployment.jpg).

## Acceso del agente

El conector Vercel ha listado el proyecto pero devuelve `403 forbidden` al consultar sus ajustes bajo `rubenbpvs-projects`; no lista equipos accesibles. No hay CLI Vercel instalado en el entorno. La sesión de Chrome sí permite revisar dashboard y preview. La integración Git funciona independientemente de ese permiso MCP. No se han creado credenciales ni se ha debilitado Deployment Protection.

## Aceptación, merge y producción comprobados

- Aceptación humana: «Sí, acepto y autorizo merge y publicación», recibida en la conversación de Codex el 14/10/2026 y registrada antes del merge a las 21:26 CEST. [Registro en el ticket](https://github.com/rubenbp/app-foundry/issues/9#issuecomment-6176541337).
- Se comprobó que la PR seguía abierta, dirigida a `main`, con los checks correctos y el SHA aceptado. El merge usó `--match-head-commit 613941e540ae4f92d6153028cadfed704d5fc849`.
- Merge squash: `8f35d44e1a6992330598cb2878c0e6765330ecd5`, 14/10/2026 21:26:58 CEST, actor GitHub `rubenbp`.
- Deployment automático de producción: `dpl_2bJyMh2Uj5RzX43u7aSbUg626um3`, [dashboard](https://vercel.com/rubenbpvs-projects/appfoundry-site-demo/2bJyMh2Uj5RzX43u7aSbUg626um3).
- Dashboard: `Ready`, entorno `Production`, rama `main`, SHA `8f35d44`. Build mostrado: 15 s; finalización 21:27:18 CEST.
- Deployment GitHub `7075124947`: `success`, 21:27:19 CEST; [URL del deployment](https://appfoundry-site-demo-hbtq5dvpk-rubenbpvs-projects.vercel.app).
- [Dominio de producción](https://rebobina-appfoundry.vercel.app): navegador recargado muestra «Demo de App Foundry · 2026». Una petición HTTP sin cookies ni autenticación devuelve `200` y contiene ese texto.
- El estado de merge y el de deployment se comprobaron por separado. La publicación se produjo después de la autorización humana y del merge; no se invocó un deployment manual.

## Límites y siguientes decisiones

La infraestructura mínima queda comprobada. La elección del mecanismo de observación, la evidencia de aceptación y los permisos del futuro proceso de la Factory pertenecen al ticket del workflow. El conector MCP de esta conversación sigue sin acceso al equipo; la sesión de navegador y las señales GitHub han permitido completar la prueba. El paquete de evidencias no contiene credenciales.

La prueba confirma un recorrido de infraestructura con una única cuenta. No demuestra separación de privilegios entre agente y persona, ni el contrato completo de verificación, ni recuperación de la Factory. La selección y fijación reproducible de pnpm y de Node en `package.json` se abordará al implementar ese contrato.
