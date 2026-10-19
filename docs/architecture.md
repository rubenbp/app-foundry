# Arquitectura de la Factory

La Factory usa arquitectura hexagonal. Las reglas y los contratos de las Ejecuciones viven dentro; los adaptadores traducen los efectos externos. La composición selecciona las implementaciones y administra su ciclo de vida.

## Dirección de dependencias

| Ubicación             | Responsabilidad                                                                      | Dependencias internas permitidas                |
| --------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `src/domain/`         | Issue autorizado, Ejecución, cola, verificación, publicación e integración           | Dominio                                         |
| `src/application/`    | Coordinación de casos de uso, puertos, saneamiento y consulta del estado             | Dominio y aplicación                            |
| `src/infrastructure/` | OpenCode, GitHub, Git, Vercel, procesos, SQLite, archivos y transporte HTTP          | Dominio, aplicación e infraestructura           |
| `src/composition/`    | Construcción de la Factory y del workflow, conexión de adaptadores y arranque/parada | Todas las capas del backend                     |
| `src/cli.ts`          | Entrada ejecutable: argumentos y delegación                                          | Composición y adaptadores de entrada            |
| `panel/`              | Presentación React y consultas HTTP de lectura                                       | Presentación y contratos compartidos de lectura |

Dominio y aplicación no abren archivos, conexiones, bases de datos ni procesos. Pueden usar funciones de la biblioteca estándar sin efectos externos, como validación de rutas y hashes. Infraestructura no importa composición. Los imports de tipos respetan las mismas direcciones.

## Contratos y composición

- `application/agent.ts` define las observaciones y operaciones del agente. OpenCode implementa ese contrato; sus mensajes nativos se traducen en `infrastructure/opencode/observer.ts`.
- `application/runRepository.ts` define persistencia de Ejecuciones, observaciones y evidencias. `infrastructure/persistence/store.ts` conserva SQLite y artefactos atómicos. Un fallo de escritura sigue bloqueando nuevos efectos.
- `application/verification.ts` define la verificación independiente del Commit candidato. El adaptador ejecuta comandos y comunica progreso, evidencias y cancelación.
- `application/ports.ts` define admisión y proyección de etiquetas en GitHub, preparación del workspace y propiedad exclusiva del workflow.
- `application/issueConversation.ts` define lectura y publicación de comentarios del issue y cierre como no implementado. `application/issueInterventions.ts` publica las dudas y entrega el primer comentario humano nuevo a la conversación del agente, sin comprobar permisos del autor.
- `application/publication/ports.ts` define observación y efectos de publicación, resumen de integración y cierre del issue. No ofrece una operación de merge: la integración sigue siendo humana.
- `composition/factory.ts` crea el repositorio persistente e inyecta el puerto en la Factory. `composition/workflow.ts` conecta propiedad, persistencia y verificación. Las pruebas de integración usan estas mismas funciones con adaptadores externos controlados.

La configuración operativa tiene un contrato propio en `application/configuration.ts`. Los registros de dominio y el consumo están en `domain/run.ts`; no se agrupan puertos y configuración en un módulo genérico de tipos.

## Autonomía local del Managed project

El MVP presupone operadores y repositorios de confianza. El agente puede mantener código y pruebas, actualizar dependencias y lockfiles y modificar scripts y configuración del producto. OpenCode permite comandos de desarrollo sin una lista literal de comandos shell. El entorno reducido, la protección local de Git y las instrucciones del agente mantienen la separación operativa: no recibe credenciales de publicación, no cambia la identidad del clon y no publica ni integra por su cuenta. Son controles frente a errores accidentales del mismo usuario de macOS, no aislamiento del sistema operativo.

`domain/verificationControls.ts` identifica cambios en archivos relacionados con la verificación para el informe humano. Estas observaciones se conservan en `Verification.controls` y su artefacto; no son rechazos. `infrastructure/verification.ts` ejecuta después el contrato de la configuración externa de confianza. `application/publication/evidence.ts` incluye las observaciones en el informe y permite continuar si el commit y las comprobaciones tienen evidencia válida. No declara que las pruebas modificadas mantengan su calidad semántica.

La recuperación sigue siendo manual: `Reintentar` repite la fase y `Corregir: instrucciones` abre otro Intento. No se añaden iteraciones automáticas ni recuperación automática general tras reiniciar. El Dashboard continúa siendo de lectura y la aceptación y el merge continúan siendo humanos.

## Responsabilidades de publicación

`application/candidatePublication.ts` coordina el avance del Commit candidato y la espera de revisión. Delega responsabilidades con motivos de cambio distintos:

- `publication/runtime.ts` registra intención y confirmación, reconcilia efectos remotos, observa merges concurrentes e impide efectos nuevos durante una parada.
- `publication/evidence.ts` exige evidencia técnica completa del SHA vigente.
- `publication/reviewReport.ts` construye y fragmenta el informe de revisión.
- `publication/reviewPolicy.ts` comprueba integridad del informe, identidad del Commit candidato, preview e instrucciones pendientes.
- `publication/integration.ts` registra la aceptación mediante merge humano, publica el resumen de integración y confirma el cierre del issue.

Los adaptadores mantienen separados el protocolo GitHub, la ejecución de comandos y el acceso autenticado a Vercel. Las credenciales y respuestas nativas permanecen en infraestructura.

## Consulta y presentación

`application/factoryView.ts` construye la proyección de lectura y define `FactoryView`, compartido con el Dashboard mediante un import de tipos. El servidor HTTP conserva transporte, validación de origen, cabeceras y entrega de archivos. React conserva selección, polling y presentación; `panel/components/output.tsx` administra la carga y cancelación de salidas desplegables.

## Verificación de los límites

`tests/architecture.test.ts` recorre los imports TypeScript, incluidos los imports de tipos. Impide dependencias inversas entre capas, adquisición directa de efectos en dominio/aplicación e imports de adaptadores del backend desde el navegador. Se ejecuta con `npm run test:unit`.

Las pruebas de comportamiento siguen cubriendo persistencia fallida, reinicio sin reenvío, propiedad exclusiva, cancelación de procesos, candidatos alterados, evidencia incompleta, aceptación mediante merge de la versión preparada, merges concurrentes y cierre condicionado al merge autorizado y al resumen publicado. Los registros anteriores que esperaban producción se leen como cierre pendiente; el reinicio conserva la intervención y la evidencia histórica. El MVP no consulta producción después del merge.

## Continuación de la conversación del agente

En el workflow, cada Issue autorizado conserva una sesión de OpenCode asociada a su Ejecución. El agente solicita intervención terminando el turno con un bloque explícito `<factory-intervention>…</factory-intervention>`. El prompt incluye el contrato y un ejemplo para agrupar varias dudas. La herramienta nativa de preguntas queda deshabilitada en este workflow: la respuesta humana entra como texto libre mediante `session.prompt` en la misma sesión. No se clasifica lenguaje natural ni se traducen formularios.

La Factory registra la solicitud, publica un comentario identificado y espera. Consulta los comentarios del issue mediante el puerto de conversación; excluye bots y marcas de la Factory y consume únicamente el primer comentario humano creado después de la pregunta publicada. Usa su identidad y orden de creación, sin consultar colaboradores ni permisos. Conserva la pregunta, la respuesta y la confirmación de entrega. Una publicación sin confirmación se concilia buscando el mismo comentario; una entrega al agente incierta queda en intervención sin reenvío automático.

La política de revisión reconoce por ID las respuestas ya entregadas al agente y las excluye de la interpretación de instrucciones de la PR y de las revocaciones al comprobar el merge. Una aclaración puede contener expresiones como «Corrige» o «Acepto» sin convertirse después en una corrección o aceptación del Commit candidato.

El runtime de OpenCode se conserva en un directorio privado por Ejecución dentro de la raíz de datos. La conexión autenticada permite volver a observar un servidor propio todavía vivo; si terminó, se inicia otro con el mismo almacenamiento y se recupera la sesión existente. La Factory no crea una conversación alternativa ni reenvía el encargo inicial al recuperar una espera. Las ejecuciones anteriores sin este protocolo mantienen su tratamiento de reinicio.

La espera humana no caduca y ocupa el único puesto. El cierre ordenado de la Factory conserva esa espera; `stop` sigue siendo una cancelación explícita. La aceptación del Commit candidato y el merge conservan sus controles de permisos.

## Recuperación explícita del MVP

`domain/recovery.ts` reconoce únicamente las órdenes completas `Reintentar`, `Corregir: instrucciones` y `Cancelar`, y determina las acciones disponibles según el estado y la integración. `application/issueRecovery.ts` publica el aviso de intervención, consume comentarios humanos del issue sin comprobar permisos y delega la operación en el workflow. Los IDs consumidos quedan persistidos y se excluyen de la revisión posterior de la PR. No hay cola de notificaciones ni protocolo adicional para recuperar comunicaciones con GitHub.

El workflow conserva la Ejecución y su reserva. Reintentar preparación reutiliza el clon y repite las comprobaciones de base; reintentar verificación repite el contrato completo. Una corrección, o el reintento de un fallo del agente con sesión disponible, inicia otro Intento recuperando el mismo thread. Se conservan rama y PR; se invalidan evidencia y control favorable vigentes. Tras verificar el nuevo commit, el push usa como concesión el SHA publicado anterior, actualiza la misma rama y requiere otra preview, informe y aceptación.

Cancelar reutiliza la parada operativa y cierra el issue con `state_reason: not_planned` solo después de confirmar la parada. La CLI `stop` conserva su contrato de parada local. Después del merge, la recuperación queda limitada al resumen y al cierre pendientes; no corrige código ni cancela lo integrado.

## Etiquetas y avisos de revisión

`domain/issueLabels.ts` proyecta los estados existentes de Ejecución sobre seis etiquetas operativas. `factory:ready` sigue siendo la entrada de autorización y se retira después de capturar el encargo. `Workflow.syncIssueLabels()` persiste intención antes de modificar GitHub y confirmación después; una actualización incierta se concilia en la consulta siguiente. El adaptador `GitHub.setRunLabel()` crea la definición si falta, añade el estado nuevo y retira únicamente los nombres conocidos anteriores. No reemplaza todas las etiquetas del issue ni crea una cola adicional de trabajo.

`ReviewReport.notify()` publica el aviso breve de revisión en el issue mediante `PublicationRuntime.comment()`, que ahora selecciona issue o conversación de PR. Conserva el mismo protocolo de marcadores, observación previa y conciliación de comentarios. El informe completo permanece en la PR; el aviso no muestra el SHA. Una nueva entrega puede publicar otro aviso sin editar el historial.

Los cambios se destinan a ejecuciones nuevas. No se migra el contrato de aceptación de ejecuciones antiguas en marcha; la prueba local debe reiniciarse desde una ejecución nueva.
