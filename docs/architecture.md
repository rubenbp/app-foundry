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
- `application/ports.ts` define admisión desde GitHub, preparación del workspace y propiedad exclusiva del workflow.
- `application/publication/ports.ts` define observación y efectos de publicación, resumen de integración y cierre del issue. No ofrece una operación de merge: la integración sigue siendo humana.
- `composition/factory.ts` crea el repositorio persistente e inyecta el puerto en la Factory. `composition/workflow.ts` conecta propiedad, persistencia y verificación. Las pruebas de integración usan estas mismas funciones con adaptadores externos controlados.

La configuración operativa tiene un contrato propio en `application/configuration.ts`. Los registros de dominio y el consumo están en `domain/run.ts`; no se agrupan puertos y configuración en un módulo genérico de tipos.

## Responsabilidades de publicación

`application/candidatePublication.ts` coordina el avance del Commit candidato y la espera de revisión. Delega responsabilidades con motivos de cambio distintos:

- `publication/runtime.ts` registra intención y confirmación, reconcilia efectos remotos, observa merges concurrentes e impide efectos nuevos durante una parada.
- `publication/evidence.ts` exige evidencia técnica completa del SHA vigente.
- `publication/reviewReport.ts` construye y fragmenta el informe de revisión.
- `publication/reviewPolicy.ts` comprueba integridad del informe, identidad del Commit candidato, aceptación y permisos efectivos.
- `publication/integration.ts` reconstruye la aceptación vigente al integrar, publica el resumen de integración y confirma el cierre del issue.

Los adaptadores mantienen separados el protocolo GitHub, la ejecución de comandos y el acceso autenticado a Vercel. Las credenciales y respuestas nativas permanecen en infraestructura.

## Consulta y presentación

`application/factoryView.ts` construye la proyección de lectura y define `FactoryView`, compartido con el Dashboard mediante un import de tipos. El servidor HTTP conserva transporte, validación de origen, cabeceras y entrega de archivos. React conserva selección, polling y presentación; `panel/components/output.tsx` administra la carga y cancelación de salidas desplegables.

## Verificación de los límites

`tests/architecture.test.ts` recorre los imports TypeScript, incluidos los imports de tipos. Impide dependencias inversas entre capas, adquisición directa de efectos en dominio/aplicación e imports de adaptadores del backend desde el navegador. Se ejecuta con `npm run test:unit`.

Las pruebas de comportamiento siguen cubriendo persistencia fallida, reinicio sin reenvío, propiedad exclusiva, cancelación de procesos, candidatos alterados, evidencia incompleta, aceptación por SHA y preview, merges concurrentes y cierre condicionado al merge autorizado y al resumen publicado. Los registros anteriores que esperaban producción se leen como cierre pendiente; el reinicio conserva la intervención y la evidencia histórica. El MVP no consulta producción después del merge.
