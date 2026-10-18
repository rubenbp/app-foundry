# Cierre del incremento #16

Auditoría de los siete criterios de [#16](https://github.com/rubenbp/app-foundry/issues/16), realizada sobre la implementación `918744dff66d77236d7cf70013457e4b5020d27a` (precedida por `e1e9289`). No se modificó ni cerró el padre #12.

## Comprobaciones de la Factory

Se ejecutaron de nuevo `npm run typecheck`, `npm run lint`, `npm run format:check` y `npm test`: todos terminaron con código 0. La suite completa pasó **48 pruebas de servicio y 7 de navegador**, sin fallos ni pruebas omitidas. [Resumen de la ejecución](factory-checks.json).

Las pruebas mantienen SQLite y artefactos reales. Controlan las fronteras GitHub/OpenCode/procesos cuando corresponde; las pruebas del dashboard y del servidor candidato usan Chrome real. No llaman a un modelo ni acreditan ejecución AFK, preview o producción.

## Ejecución real del contrato de Rebobina

[El manifiesto](rebobina-verification.json) conserva configuración capturada, versiones efectivas, tiempos, comandos, códigos, PID/grupos, limpieza, referencias y criterios. Se utilizó `GitWorkspace.prepare` para clonar GitHub e instalar con lockfile congelado, y `CandidateVerifier.verify` para comprobar el candidato. No se sustituyó el ejecutor de procesos.

- Base remota: `7b429e02d3e5e89685c6ce015f58fe477a028c06`.
- Primer commit local de diagnóstico: `5827de154de6e672903236940aec04966cb53fdf`.
- Head candidato: `9ffc8eb8c458e20ac8acfd67d988a8bd6ee54350`.
- Árbol final limpio y limpieza de todos los comandos confirmada.
- Node `24.21.0`, pnpm `12.14.0`, Python `3.14.6`, Chrome `155.0.8059.80`; Playwright `1.64.1` registrado en el informe E2E.

Los dos commits añaden únicamente documentos de diagnóstico dentro del clon desechable. Ambos aparecen en el [diff acumulado](verification-diff.log). No se publicaron ramas, commits o cambios de Rebobina; no se ejecutaron los casos de contenido o dificultad reservados a la evaluación. No hubo agente editando durante esta prueba; la parada previa del agente se acredita mediante las pruebas del Workflow.

| Comando          | Base         | Candidato    | Evidencia del candidato                                   |
| ---------------- | ------------ | ------------ | --------------------------------------------------------- |
| `pnpm build`     | 0            | 0            | [Salida](verification-check-1.log)                        |
| `pnpm lint`      | 0            | 0            | [Salida](verification-check-2.log)                        |
| `pnpm typecheck` | 0            | 0            | [Salida](verification-check-3.log)                        |
| `pnpm test:unit` | 0; 3 pruebas | 0; 3 pruebas | [Salida](verification-check-4.log)                        |
| `pnpm test:e2e`  | 0; 7 pruebas | 0; 7 pruebas | [Salida e informe JSON saneado](verification-check-5.log) |

Las salidas de la base están en `base-base-1.log` a `base-base-5.log`; la instalación está en [base-preparation.log](base-preparation.log). El candidato ejecutó E2E contra su build `dist`, con servidor Python propio en `http://127.0.0.1:4173`, sin reutilización de servidor y con `offline: false`. Se conservaron selección de navegador, alcance y configuración. Los medios/adjuntos nativos se omiten expresamente y el runtime temporal se elimina.

Durante la auditoría se observó que la metadata de la configuración todavía indicaba pnpm `12.4.1`, mientras `packageManager` del Managed project ya fija `12.14.0`. La ejecución conserva ambos valores, sin reescribir la observación histórica. El cierre corrige únicamente `toolchain.pnpm` y su requisito textual a `12.14.0`; los cinco comandos y la configuración E2E permanecen iguales. No se añade un control nuevo de versiones.

## Matriz de aceptación

| Criterio de #16                                                                                                                           | Acreditación concreta                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detener la edición antes de fijar head; rechazar cambios sin incorporar; vincular base/head.                                              | [Pruebas del Workflow](../../../tests/verification.test.ts): `the Workflow stops editing before fixing a complete multi-commit candidate...`, `uncommitted tracked, staged and untracked changes...`, `an uncertain agent stop...`. El commit del callback de parada queda incluido en el head fijado; tracked, staged y untracked detienen la verificación. El manifiesto real vincula cada comprobación a base/head. |
| Verificar el árbol completo y el diff acumulado de varios commits.                                                                        | `verification catches a defect from an earlier commit...` introduce un defecto en un commit y termina con otro que no toca ese archivo: obtiene exit 7 e intervención. El [diff real](verification-diff.log) contiene los dos commits de diagnóstico; los cinco comandos se ejecutan en el checkout del head completo.                                                                                                 |
| Ejecutar los cinco comandos de Rebobina y E2E con servidor propio; nunca aprobar comandos ausentes/omitidos.                              | Tabla anterior y manifiesto real: cinco códigos 0 en base/candidato y 7 E2E HTTP. Pruebas `a command unavailable on the candidate...` y `exit zero without an executed E2E report...` conservan exit 127, comandos posteriores `not_run`, ausencia de informe y pruebas omitidas sin aprobar. La [integración de navegador](../../../tests/browser/candidateE2e.spec.ts) rechaza puerto ocupado y prueba parada real.  |
| Conservar comandos, códigos, salidas saneadas, configuración, navegador, alcance y evidencia por criterio; señalar lagunas/juicio humano. | Manifiesto, salidas e informe E2E reales. Pruebas `a large accumulated diff and command output...`, `truncated command evidence...` y la primera prueba de Workflow comprueban persistencia tras reinicio, redacción de secretos, referencias por criterio, `human_pending` y evidencia específica ausente. Una suite verde no acredita por sí sola un criterio de negocio.                                            |
| Comparar controles contra la base y exigir intervención por eliminación/omisión/exclusividad/debilitamiento/configuración.                | Pruebas `removed commands and deleted, skipped, exclusive or weakened tests...` y `a newly exclusive test and an edited command source...`; todas detienen antes de ejecutar comprobaciones. [Comparación real de controles](verification-controls.log). La política es conservadora y declara que no detecta todo debilitamiento semántico.                                                                           |
| Mostrar fase, comprobaciones/salidas, diff/referencias, criterios y detenciones en el dashboard.                                          | [Prueba integrada del dashboard/API](../../../tests/browser/verification.spec.ts): fase `verification`, estado en ejecución/fallo, base/head, enlace al diff, criterios sin evidencia, salidas como texto saneado, teclado y móvil. [Captura del dashboard](panel.png), con fixture controlada de fallo anterior al último commit.                                                                                     |
| Probar defecto anterior al último commit, comandos ausentes y controles alterados; mantener fallo detenido con evidencia.                 | Las regresiones anteriores forman parte de las 48 pruebas de servicio. Conservan exit 7/127, salida y diff; mantienen el puesto en intervención y no reintentan ni corrigen automáticamente. Se incluyen además cancelación, reinicio durante un comando y reinicio durante limpieza E2E pendiente.                                                                                                                    |

**Resultado: siete criterios acreditados; no quedan bloqueos de este incremento.** La aceptación de un resultado de producto, preview, merge, producción, límites del workflow completo y los casos de evaluación pertenecen a sus incrementos correspondientes y no quedan acreditados por este cierre.

## Reproducción

Con dependencias de la Factory, `gh` autenticado para lectura del repositorio, Node, pnpm, Python y Chrome disponibles:

```sh
node --experimental-strip-types docs/evidence/candidate-verification/reproduce.ts
```

El script crea un clon desechable, descarga dependencias si hace falta y ejecuta los comandos reales; vuelve a generar esta evidencia con los SHAs y versiones vigentes. No inicia OpenCode ni escribe en GitHub. Las rutas de usuario/raíz de diagnóstico se sustituyen por marcadores y los secretos conocidos/patrones se redactan antes de persistir. Los commits locales del diagnóstico original permanecen identificados por SHA y diff, sin estar publicados en el repositorio del producto.
