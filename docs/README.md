# Documentación de App Foundry

El comportamiento implementado se describe en el [manual de negocio](manual/README.md) y la [arquitectura](architecture.md). Para ejecutar una prueba con el Managed project configurado, sigue la [guía local de GitHub y Vercel](manual/07-prueba-local-github-vercel.md).

## Continuación del agente por el issue

La Factory publica las dudas del agente en un comentario del issue. Puede reunir varias preguntas en una solicitud. Cualquier persona responde con un comentario nuevo, sin comandos ni comprobación de permisos para esa aclaración; la primera respuesta humana vuelve al mismo thread. El agente puede repetir el ciclo durante la implementación.

La espera no caduca, conserva el puesto y sobrevive al reinicio de la Factory. Cuando el agente termina el código, continúan la verificación, la PR y la preview de Vercel. La aceptación del resultado y el merge conservan sus controles propios.

- [Flujo de preguntas y respuestas](manual/02-issue-y-trabajo.md#aclaraciones-por-comentarios).
- [Distinción entre aclaración y aceptación de una PR](manual/03-verificacion-y-aceptacion.md#árbol-de-decisión-de-los-comentarios).
- [Espera, parada, reinicio y errores](manual/05-variantes-e-intervencion.md).
- [Validación y alcance de las pruebas](evidence/issue-interventions/README.md).

## Organización

| Carpeta o documento                                       | Contenido                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Manual](manual/README.md)                                | Flujo implementado y operación del MVP.                                         |
| [Arquitectura](architecture.md)                           | Responsabilidades, contratos y adaptadores del código actual.                   |
| [Guía de GitHub y Vercel](guides/vercel-setup.md)         | Preparación de infraestructura y conexión con el runtime actual.                |
| [Preparación de Rebobina](guides/rebobina-preparation.md) | Contrato de base, verificaciones y contexto del incremento de preparación.      |
| `evidence/`                                               | Comprobaciones fechadas y alcance de cada experimento.                          |
| `research/`                                               | Investigaciones y propuestas en el contexto de su fecha y commit de referencia. |
| `agents/`                                                 | Instrucciones para trabajar en el repositorio.                                  |

Las evidencias y las investigaciones conservan sus resultados históricos. Para conocer las capacidades actuales, utiliza el manual y la arquitectura; un experimento anterior no acredita por sí solo una evolución posterior.
