# Documentación de App Foundry

El comportamiento implementado se describe en el [manual de negocio](manual/README.md) y la [arquitectura](architecture.md). Para ejecutar una prueba con el Managed project configurado, sigue la [guía local de GitHub y Vercel](manual/07-prueba-local-github-vercel.md).

## Autonomía local del MVP

El agente puede mantener las pruebas existentes, actualizar dependencias, lockfiles, scripts y configuración del producto y ejecutar los comandos de desarrollo necesarios dentro del clon. Los cambios en archivos relacionados con la verificación se muestran como información para revisar, sin bloquear el contrato técnico ni la publicación. La configuración externa y las credenciales de la Factory siguen separadas. El MVP presupone operadores y repositorios de confianza y no ofrece aislamiento del sistema operativo.

Se mantienen verificación independiente, revisión de la preview, aceptación mediante merge humano. La recuperación utiliza los comandos existentes; no incorpora bucles automáticos de corrección ni reanudación general tras reinicios. Consulta [el contrato de verificación](manual/03-verificacion-y-aceptacion.md) y [la arquitectura](architecture.md#autonomía-local-del-managed-project).

## Revisión desde GitHub

El issue muestra su [estado mediante etiquetas](manual/02-issue-y-trabajo.md#estados-visibles-en-github), separando la cola del trabajo en curso. Al disponer de preview verificada e informe, recibe `factory:pending-review` y un aviso con enlaces a preview y PR. La persona revisa el resultado y lo acepta haciendo merge de la PR; no se necesita un comentario de aceptación ni copiar un SHA. Consulta el [flujo de revisión](manual/03-verificacion-y-aceptacion.md).

## Continuación del agente por el issue

La Factory publica las dudas del agente en un comentario del issue. Puede reunir varias preguntas en una solicitud. Cualquier persona responde con un comentario nuevo, sin comandos ni comprobación de permisos para esa aclaración; la primera respuesta humana vuelve al mismo thread. El agente puede repetir el ciclo durante la implementación.

La espera no caduca, conserva el puesto y sobrevive al reinicio de la Factory. Cuando el agente termina el código, continúan la verificación, la PR y la preview de Vercel. La aceptación mediante merge conserva sus controles de permisos.

- [Flujo de preguntas y respuestas](manual/02-issue-y-trabajo.md#aclaraciones-por-comentarios).
- [Distinción entre aclaración y aceptación de una PR](manual/03-verificacion-y-aceptacion.md#árbol-de-decisión-de-los-comentarios).
- [Espera, parada, reinicio y errores](manual/05-variantes-e-intervencion.md).
- [Validación y alcance de las pruebas](evidence/issue-interventions/README.md).

## Recuperación por comentarios

Los fallos que dejan la Ejecución en intervención generan un aviso en el issue con su causa y acciones disponibles. Para fallos de verificación, el aviso identifica el commit, el comando y el código de salida e indica dónde consultar la salida completa en el Dashboard. Basta un comentario humano nuevo, sin comprobar permisos: `Reintentar` repite la fase fallida; `Corregir: instrucciones` abre otro Intento conservando thread, rama y PR; `Cancelar` confirma la parada y cierra como no implementado. La corrección exige nueva verificación y aceptación. Después del merge solo se permite reintentar el resumen y el cierre pendientes.

El MVP mantiene este flujo sencillo; no añade recuperación de comunicaciones ni colas de avisos. Consulta el [contrato operativo](manual/05-variantes-e-intervencion.md#recuperar-desde-el-issue) y las [pruebas de recuperación](../tests/issueRecovery.test.ts).

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
