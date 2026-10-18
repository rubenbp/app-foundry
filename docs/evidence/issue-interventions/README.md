# Validación de intervenciones por comentarios del issue

Esta evidencia documenta las aclaraciones del agente. La recuperación operativa posterior mediante `Reintentar`, `Corregir: instrucciones` y `Cancelar` se describe y valida en [recuperación por issue](../issue-recovery/README.md).

Validación del 18 de octubre de 2026 sobre el desarrollo de continuación del agente en la misma conversación. Implementación: `cafe172`; documentación inicial: `a4faeaa`.

## Comportamiento comprobado

| Caso                                                                                                                                                  | Evidencia                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Publicar varias dudas juntas y entregar el primer comentario humano nuevo, sin comandos ni comprobación de permisos del autor.                        | [Pruebas del flujo](../../../tests/interventions.test.ts) y [adaptador de conversación GitHub](../../../tests/githubInterventions.test.ts). |
| Repetir las intervenciones en el mismo thread, conservando el encargo y el trabajo acumulado hasta verificar el código, abrir PR y acreditar preview. | [Prueba de varias rondas](../../../tests/interventions.test.ts). Usa Git local y fronteras remotas controladas.                             |
| Conservar la espera tras cierre ordenado o reinicio sin parada previa, sin crear otra sesión ni reenviar el encargo inicial.                          | [Recuperación del workflow](../../../tests/interventions.test.ts).                                                                          |
| Mantener la identidad de la sesión y el historial al reiniciar el servidor, y recuperar una conexión propia todavía viva.                             | [OpenCode real](../../../tests/opencodeRuntime.test.ts), con credenciales ficticias y sin llamadas al modelo.                               |
| Ignorar un resultado anterior mientras llega la respuesta o el siguiente turno sigue en curso.                                                        | [Observación mediante SDK y servidor HTTP controlado](../../../tests/opencode.test.ts).                                                     |
| Cancelar una espera recuperada y evitar publicar o reanudar después de una parada durante la lectura de comentarios.                                  | [Pruebas de cancelación](../../../tests/interventions.test.ts).                                                                             |
| Conciliar una pregunta publicada cuya confirmación se perdió y no reenviar automáticamente una respuesta de entrega incierta.                         | [Pruebas de efectos inciertos](../../../tests/interventions.test.ts).                                                                       |
| Evitar que una respuesta ya entregada que empieza por «Corrige» o «Acepto» se reinterprete como una instrucción de revisión de la PR.                 | [Prueba de varias rondas hasta integración](../../../tests/interventions.test.ts).                                                          |

## Comprobaciones ejecutadas

- `npm run test:unit`: 105 pruebas superadas.
- `npm run test:e2e`: build y 9 pruebas de navegador superadas con Chrome.
- `npm run typecheck`, `npm run lint` y `npm run format:check`: correctos.
- Tras el ajuste final de separación entre aclaración y revisión, se repitieron las pruebas de publicación en navegador y las del flujo de intervención; todas pasaron.

## Alcance de la evidencia

OpenCode se ejecutó realmente para comprobar la persistencia y recuperación del thread. El historial conocido se preparó sin llamar al modelo. Las pruebas del workflow y de los adaptadores utilizaron dobles de GitHub y Vercel: no acreditan una ejecución nueva completa contra un issue real, una PR remota y una preview de Vercel. La prueba manual de ese recorrido se describe en la [guía local](../../manual/07-prueba-local-github-vercel.md).

La espera no tiene caducidad y conserva el único puesto. Este incremento cubre información y confirmaciones solicitadas por el agente durante la implementación; los errores de infraestructura, verificación y despliegue mantienen sus contratos operativos.
