# Coding standards

Estas normas guían el diseño, la implementación y la revisión del código de producción, las pruebas y los scripts de este repositorio. Describen el estándar objetivo; el código existente puede incumplirlo.

Aplica las normas al cambio solicitado y a los ajustes necesarios para mantener sus contratos e invariantes. Registra la deuda relevante que quede fuera de ese alcance. La existencia de un patrón heredado no justifica repetirlo.

La configuración del repositorio define formato y comprobaciones mecánicas. Para el vocabulario y las decisiones de arquitectura, sigue [las instrucciones de dominio](docs/agents/domain.md). Si una solución entra en conflicto con un ADR, identifica la decisión y resuelve el conflicto explícitamente antes de implementar una alternativa incompatible.

## Forma de trabajar

1. **Delimita el comportamiento.** Antes de editar, identifica el resultado observable, los conceptos de dominio afectados, sus invariantes y los límites de confianza y efectos externos. Este paso termina cuando puedes describir qué debe ocurrir en el caso válido y qué debe rechazarse o fallar.
2. **Diseña el cambio mínimo coherente.** Asigna cada regla al módulo que la protege y define sus contratos y dependencias. Implementa cuando cada responsabilidad tenga un dueño claro y puedas explicar cómo se preservan las invariantes ante errores y concurrencia aplicables.
3. **Verifica el resultado.** Revisa el diff con todas las reglas aplicables de este documento y ejecuta las comprobaciones pertinentes disponibles en el repositorio. Termina cuando cada contrato e invariante modificados estén comprobados mediante pruebas o evidencia directa, hayas corregido los incumplimientos introducidos y comuniques cualquier garantía que no hayas podido verificar.

## Lenguaje ubicuo y nombres

- Usa [GLOSSARY.md](GLOSSARY.md) como fuente del significado de los conceptos de dominio. Mantén un término por concepto y conserva sus distinciones en código, contratos, pruebas y documentación. Si los identificadores necesitan una traducción, usa una correspondencia estable y explícita.
- Antes de introducir un término, comprueba si el vocabulario ya expresa ese concepto. Resuelve las ambigüedades reales siguiendo las instrucciones de dominio; evita crear sinónimos locales para el mismo significado.
- Elige palabras completas, pronunciables, concretas y reconocibles para quien conoce el negocio. Reserva las siglas para vocabulario establecido y protocolos conocidos.
- Nombra entidades y valores por lo que representan, y operaciones por la acción y el efecto que producen. Un nombre debe permitir anticipar el contrato sin leer la implementación.
- Expresa intención de dominio en sus nombres: `attempts`, `candidateCommit`, `acceptResult`. Sitúa la información técnica en los adaptadores que la necesitan: `SqliteAttemptRepository` puede identificar una implementación; el dominio consume un contrato de intentos independiente de SQLite.
- Usa el contexto para acortar nombres sin perder precisión. Los nombres genéricos como `data`, `manager` o `utils` requieren una responsabilidad más concreta antes de convertirse en una API compartida.
- Haz explícitas las unidades y referencias temporales cuando afecten a la interpretación: `retryDelayMs`, `expiresAt`. Los booleanos deben leerse como afirmaciones o preguntas inequívocas, como `isExpired` o `canRetry`.

## Dominio rico e invariantes

- Representa las reglas del negocio mediante operaciones del dominio que mantengan sus datos válidos. La capa de aplicación coordina el caso de uso; las entidades, los objetos de valor o las funciones de dominio deciden qué está permitido.
- Construye valores válidos desde el origen. Valida identificadores, rangos y combinaciones relevantes al crearlos; usa tipos que distingan conceptos cuando confundirlos pueda romper una regla.
- Modela estados y transiciones permitidas de forma explícita. Usa variantes discriminadas u otra representación que vincule cada estado con sus datos válidos y permita comprobar los casos exhaustivamente.
- Encapsula las mutaciones detrás de operaciones que preserven las invariantes. Expón colecciones y valores con la protección necesaria para que los consumidores no puedan saltarse esas operaciones.
- Elige entidades cuando importen identidad y ciclo de vida; objetos de valor cuando importen significado e igualdad por valor. Combina datos simples y funciones cuando esa representación proteja las mismas reglas con menos complejidad.
- Mantén las decisiones de dominio independientes de transporte, persistencia, frameworks y proveedores. Traduce sus formatos en los límites; los DTO y los registros de almacenamiento representan contratos externos al modelo de dominio.
- Define el límite de consistencia según las invariantes. Cuando varias escrituras deban confirmarse juntas, usa una operación atómica; protege las precondiciones frente a cambios concurrentes mediante mecanismos efectivos de persistencia o coordinación.
- Conserva las distinciones del negocio: un Issue autorizado permite iniciar el trabajo y la Aceptación del resultado se refiere a un Commit candidato concreto. Las comprobaciones técnicas no sustituyen esas decisiones humanas.

## Contratos y principio de menor sorpresa

- Haz que nombre, firma y comportamiento coincidan. Explicita entradas válidas, resultado, ausencia, errores relevantes y efectos observables en el contrato de cada límite público.
- Separa las consultas de las operaciones que cambian estado. Haz visibles las operaciones de red, persistencia y procesos; quien invoque una operación debe poder anticipar sus efectos y su coste relevante.
- Conserva los contratos públicos existentes o migra sus consumidores de forma explícita. Trata como cambios de contrato las diferencias en errores, orden, unidades, nulabilidad, valores predeterminados y efectos.
- Prefiere parámetros y resultados que expresen conceptos. Sustituye secuencias de booleanos opacos por opciones con nombre o variantes que representen las combinaciones permitidas.
- Aplica valores predeterminados solo cuando la ausencia sea válida en el dominio. Distingue ausencia, colección vacía, rechazo y fallo de una dependencia.
- Mantén el flujo local legible con niveles de abstracción coherentes y casos límite claros. Extrae una función cuando revele una intención, encapsule una regla o separe una responsabilidad.
- Usa comentarios para explicar decisiones, restricciones y motivos que el código no puede expresar. Documenta contratos públicos y compromisos relevantes para sus consumidores.

## Cohesión, acoplamiento y SOLID

- Agrupa por responsabilidad y por razones de cambio compartidas. Sitúa juntos los datos, reglas y operaciones que deban evolucionar de forma coordinada; separa capacidades que puedan cambiar independientemente.
- Expón una superficie pública pequeña y suficiente. Cruza límites de módulos por sus contratos, mantén las dependencias sin ciclos y concentra las decisiones internas detrás de esos límites.
- **Responsabilidad única (S):** da a cada módulo una responsabilidad reconocible y un motivo coherente para cambiar. Usa esa responsabilidad para decidir dónde vive una regla.
- **Abierto/cerrado (O):** cuando exista una variación real, encapsula su punto de extensión para añadir comportamientos sin alterar reglas estables. Introduce la abstracción a partir de casos concretos y diferencias observadas.
- **Sustitución de Liskov (L):** cada implementación acepta al menos las entradas válidas de su contrato y garantiza sus postcondiciones, errores y efectos prometidos. Los consumidores deben funcionar con cualquiera de sus implementaciones válidas.
- **Segregación de interfaces (I):** ofrece a cada consumidor solo las operaciones que necesita. Divide los contratos que mezclen capacidades independientes.
- **Inversión de dependencias (D):** las políticas de negocio definen las capacidades que requieren; los adaptadores implementan esos contratos. Conecta dependencias en el límite de composición y hazlas explícitas.
- Prefiere composición y funciones sencillas. Introduce clases, capas, interfaces o patrones cuando protejan una invariante, oculten complejidad o aíslen una variación concreta. SOLID orienta responsabilidades y contratos; no exige una interfaz por clase.
- Extrae código compartido cuando comparta significado y motivo de cambio. Una coincidencia de forma entre reglas de negocio distintas puede mantenerse separada.

## Gestión y prevención de errores

- Distingue rechazos esperados del dominio, fallos operativos de dependencias y defectos de programación. Representa los rechazos y las condiciones recuperables en el contrato para que el consumidor pueda decidir cómo responder.
- Valida las entradas externas en su frontera y preserva las invariantes dentro del dominio. Usa tipos, comprobación exhaustiva y validación real para reducir estados inválidos; una aserción de tipos no valida datos en ejecución.
- Captura un error donde puedas recuperarte, traducirlo al contrato de esa frontera o liberar recursos. Conserva su causa y el contexto útil; propaga los fallos que ese nivel no pueda resolver.
- Un fallo debe conservarse como fallo hasta su resolución explícita. No lo conviertas en éxito aparente, resultado vacío o valor predeterminado. Un comportamiento degradado requiere un contrato deliberado y evidencia de su activación.
- Acota las operaciones externas con plazos y cancelación cuando corresponda. Reintenta solo fallos transitorios y operaciones idempotentes o protegidas contra duplicados, con límite de intentos y espera controlada.
- Define quién adquiere y libera cada recurso. Garantiza el cierre de conexiones, procesos, temporizadores y bloqueos también ante errores o cancelación.
- Para efectos que atraviesen varias dependencias, explicita qué se confirma, qué puede repetirse y cómo se recupera una ejecución parcial. Mantén suficiente estado para distinguir lo completado de lo pendiente.
- Asigna el registro del fallo a una frontera responsable. Ofrece mensajes accionables al consumidor y contexto de diagnóstico suficiente en los registros, conservando la protección de los datos sensibles.

## Seguridad y protección de datos

- Trata como no confiables las entradas de usuarios, archivos, red, herramientas y modelos. Comprueba formato, tamaño y valores permitidos antes de usarlas, y tradúcelas a tipos internos válidos.
- Comprueba permisos para la acción y el recurso en la frontera que ejecuta el efecto. Aplica mínimo privilegio y vincula las autorizaciones sensibles al objeto y la versión que autorizan.
- Mantén separados instrucciones, datos y código ejecutable. Usa consultas parametrizadas, argumentos de proceso separados de la shell, codificación de salida según el contexto y rutas resueltas y restringidas al ámbito permitido.
- Rechaza o aísla entradas capaces de escapar de su ámbito: rutas, comandos, URLs y contenido generado necesitan controles acordes con la operación que habilitan.
- Obtén credenciales mediante los mecanismos de configuración previstos y expón solo los datos necesarios. Excluye secretos y datos sensibles de código, fixtures, errores, logs y respuestas públicas.
- Añade dependencias según una necesidad concreta y revisa mantenimiento, permisos y superficie expuesta. Usa las capacidades del lenguaje y las dependencias ya adecuadas cuando resuelvan el problema con menor coste de mantenimiento.

## Pruebas y evolución

- Prueba comportamientos y contratos observables con nombres del dominio. Elige casos que detecten una regla rota, no pruebas que repitan la estructura de la implementación.
- Al cambiar comportamiento, cubre los escenarios relevantes para su riesgo: caso válido, límites, rechazos y fallos. Incluye transiciones, concurrencia, permisos o reintentos cuando el cambio dependa de ellos.
- Para corregir un defecto, añade una regresión que reproduzca la causa cuando sea viable. Comprueba que detecta el comportamiento incorrecto y pasa con la corrección.
- Mantén deterministas las pruebas de reglas: controla reloj, azar y dependencias externas. Usa pruebas de integración cuando la garantía dependa de persistencia, transacciones, procesos o un contrato entre componentes.
- Para cambios de estructura sin cambio de comportamiento, usa las pruebas existentes como protección y añade cobertura donde haya una garantía relevante sin verificar. Ajusta la verificación de cambios mecánicos a su impacto.
- Comprueba compatibilidad de APIs y datos persistidos. Cuando cambien sus contratos, incluye la migración y la convivencia de versiones que necesiten sus consumidores.
- Fundamenta optimizaciones en un coste relevante y verifica su efecto. Evalúa la claridad y el mantenimiento de la solución junto con su rendimiento.
