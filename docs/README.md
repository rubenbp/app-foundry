# Documentación de App Foundry

El comportamiento implementado se describe en el [manual de negocio](manual/README.md) y la [arquitectura](architecture.md). Para instalar la Factory, usa el [asistente de puesta en marcha](guides/setup-wizard.md); para recorrer un issue real de principio a fin, sigue la [prueba con GitHub y Vercel](manual/07-prueba-local-github-vercel.md).

## Proveedores y modelos

La Factory admite OpenAI con OAuth, Gemini y Anthropic con API key, y Ollama local experimental. La selección global se fija al arrancar; cualquier modelo habilitado por OpenCode con herramientas es seleccionable. No hay lista manual de modelos permitidos ni cambio automático. Una Ejecución iniciada y pendiente con otra selección bloquea el arranque; la cola nunca iniciada puede adoptar la nueva. Sigue la [guía breve de configuración](guides/llm-providers.md), que incluye credenciales, selección, Ollama y diagnóstico.

## Autonomía local del MVP

El agente puede mantener las pruebas existentes, actualizar dependencias, lockfiles, scripts y configuración del producto y ejecutar los comandos de desarrollo necesarios dentro del clon. Los cambios en archivos relacionados con la verificación se muestran como información para revisar, sin bloquear el contrato técnico ni la publicación. La configuración externa y las credenciales de la Factory siguen separadas. El MVP presupone operadores y repositorios de confianza y no ofrece aislamiento del sistema operativo.

La verificación es independiente del agente, la revisión se hace en la preview y la aceptación es el merge humano. La recuperación usa las órdenes del issue; no hay bucles automáticos de corrección. Tras un reinicio solo continúan las esperas confirmadas de respuesta humana, preview y revisión; el resto del trabajo iniciado queda en intervención. Consulta [el contrato de verificación](manual/03-verificacion-y-aceptacion.md) y [la arquitectura](architecture.md#autonomía-local-del-managed-project).

## Skills del agente

El directorio `skills/` del repositorio de la Factory contiene el catálogo común que mantiene el equipo. El agente descubre las skills por su nombre y descripción y carga las que necesita mediante OpenCode. Cada Ejecución fija su copia antes del primer Intento y la conserva entre Intentos y reinicios. Solo se autorizan las skills de esa copia; las globales y las del Managed project no se habilitan. El catálogo incluye la skill de ejemplo `chiste`. Consulta la [guía para añadir skills](guides/factory-skills.md) y su [integración en la arquitectura](architecture.md#skills-de-la-factory).

## Revisión desde GitHub

El issue muestra su [estado mediante etiquetas](manual/02-issue-y-trabajo.md#estados-visibles-en-github), separando la cola del trabajo en curso. Al disponer de preview verificada y evidencia técnica, recibe `factory:pending-review` y un aviso con enlaces a preview y PR. La persona revisa el resultado y lo acepta haciendo merge de la PR; no se necesita un comentario de aceptación ni copiar un SHA. Consulta el [flujo de revisión](manual/03-verificacion-y-aceptacion.md).

## Continuación del agente por el issue

La Factory publica las dudas del agente en un comentario del issue. Puede reunir varias preguntas en una solicitud. Cualquier persona responde con un comentario nuevo, sin comandos ni comprobación de permisos para esa aclaración; la primera respuesta humana vuelve al mismo thread. El agente puede repetir el ciclo durante la implementación.

La espera no caduca, conserva el puesto y sobrevive al reinicio de la Factory. Cuando el agente termina el código, continúan la verificación, la PR y la preview de Vercel. La aceptación mediante merge conserva sus controles de permisos.

- [Flujo de preguntas y respuestas](manual/02-issue-y-trabajo.md#aclaraciones-por-comentarios).
- [Distinción entre aclaración y aceptación de una PR](manual/03-verificacion-y-aceptacion.md#árbol-de-decisión-de-los-comentarios).
- [Espera, parada, reinicio y errores](manual/05-variantes-e-intervencion.md).
- Pruebas de [intervenciones](../tests/interventions.test.ts) y de su [integración con GitHub](../tests/githubInterventions.test.ts).

## Recuperación por comentarios

Los fallos que dejan la Ejecución en intervención generan un aviso en el issue con su causa y acciones disponibles. Para fallos de verificación, el aviso identifica el commit, el comando y el código de salida e indica dónde consultar la salida completa en el Dashboard. Basta un comentario humano nuevo, sin comprobar permisos: `Reintentar` repite la fase fallida; `Corregir: instrucciones` abre otro Intento conservando thread, rama y PR; `Cancelar` confirma la parada y cierra como no implementado. La corrección exige nueva verificación y aceptación. Después del merge solo se permite reintentar el resumen y el cierre pendientes.

El MVP mantiene este flujo sencillo; no añade recuperación de comunicaciones ni colas de avisos. Consulta el [contrato operativo](manual/05-variantes-e-intervencion.md#recuperar-desde-el-issue) y las [pruebas de recuperación](../tests/issueRecovery.test.ts).

## Organización

| Carpeta o documento                                     | Contenido                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Manual](manual/README.md)                              | Flujo implementado y operación del MVP.                                         |
| [Arquitectura](architecture.md)                         | Responsabilidades, contratos y adaptadores del código actual.                   |
| [Asistente de puesta en marcha](guides/setup-wizard.md) | Instalación, conexión con GitHub y Vercel, archivos generados y uso diario.     |
| [Proveedores y modelos](guides/llm-providers.md)        | Cuentas, autenticación, selección del modelo, esfuerzo y diagnóstico.           |
| [Skills de la Factory](guides/factory-skills.md)        | Catálogo común, formato, permisos y copia por Ejecución.                        |
| `research/`                                             | Investigaciones y propuestas en el contexto de su fecha y commit de referencia. |
| `agents/`                                               | Instrucciones para trabajar en el repositorio.                                  |

Las investigaciones conservan sus resultados históricos. Para conocer las capacidades actuales, utiliza el manual y la arquitectura.
