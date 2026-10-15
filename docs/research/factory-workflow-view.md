# Vista de workflows para la visibilidad operativa de la Factory

Investigación del 15 de octubre de 2026 para [Evaluar la vista de GitHub Actions para la visibilidad operativa](https://github.com/rubenbp/app-foundry/issues/11). Se han consultado documentación oficial, acuerdos del proyecto y archivos locales; no se ha construido una interfaz ni ejecutado un workflow experimental.

## Recomendación

Adoptar en el panel local la jerarquía visual de Actions: resumen de la Ejecución, fases con estado y duración, selección de un Intento y detalle desplegable de actividad. Mantener las decisiones humanas en el issue o la PR. Para el primer incremento basta una lista vertical de fases más una cronología; un grafo interactivo no aporta suficiente valor con una sola Ejecución activa y un recorrido esencialmente secuencial. Es una recomendación de diseño derivada del alcance acordado, pendiente de confirmación humana, no una decisión arquitectónica ya tomada. [Workflow acordado](https://github.com/rubenbp/app-foundry/issues/5#issuecomment-6201919022).

Usar las páginas nativas de Actions para representar todo el trabajo local exigiría otra integración: ejecutar trabajo en un runner o mantener workflows que reciban y publiquen observaciones. No se obtiene esa superficie simplemente enlazando eventos locales. El grafo documentado representa jobs y sus dependencias dentro de un workflow real; las APIs de Actions consultadas gestionan workflows, runs y jobs existentes, sin documentar una API para insertar fases y aristas arbitrarias. Esta última conclusión es una inferencia sobre el contrato público revisado, no una afirmación sobre APIs internas de GitHub. [Grafo oficial](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph), [API de workflows](https://docs.github.com/en/rest/actions/workflows), [API de runs](https://docs.github.com/en/rest/actions/workflow-runs), [API de jobs](https://docs.github.com/en/rest/actions/workflow-jobs).

## Punto de partida y límites

El repositorio de la Factory contiene documentación y decisiones; en el HEAD inspeccionado, `32cbf07e7abc3ded0e1c4cabd9aa486f154f687b`, no hay un runtime ni un frontend de Factory que se pueda reutilizar o medir. Se han revisado también los cambios locales de vocabulario, sin modificarlos. La arquitectura, módulos y almacenamiento siguen pendientes en [Elegir la arquitectura mínima y ordenar los incrementos del TFM](https://github.com/rubenbp/app-foundry/issues/7). [Árbol del commit inspeccionado](https://github.com/rubenbp/app-foundry/tree/32cbf07e7abc3ded0e1c4cabd9aa486f154f687b).

Los requisitos ya acordados son una única Ejecución activa, incluidos sus tiempos de espera; Intentos distintos dentro de ella; consultas externas cada 15 segundos; historial y artefactos en disco durante la evaluación; intervención humana tras interrupción y antes de continuar. Las esperas humanas no consumen los 45 minutos de trabajo automático. No se debe introducir una caducidad implícita para ellas por escoger una interfaz de CI. [Persistencia, recuperación y límites](https://github.com/rubenbp/app-foundry/issues/6#issuecomment-6202301293).

La evaluación compara dos opciones diferentes: utilizar Actions como superficie nativa y reutilizar su patrón visual en un panel local. No propone migrar la Factory a Actions, cambiar el workflow aprobado ni fijar un framework web.

## Qué ofrece Actions y qué habría que añadir

GitHub muestra progreso por jobs, estados y dependencias, con acceso a logs. Permite consultar, buscar y descargar salidas y revisar el resultado de una ejecución. Sus jobs y steps tienen estado, conclusión y tiempos en la API. Es un buen referente para navegación de resumen a detalle. [Grafo](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph), [Logs de workflow](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs), [Campos de jobs y steps](https://docs.github.com/en/rest/actions/workflow-jobs).

Los logs admiten grupos desplegables y anotaciones. Los resúmenes de job admiten Markdown, pero se presentan cuando termina el job y los resúmenes ya subidos no pueden modificarse desde steps posteriores. Cada step dispone de 1 MiB para su resumen y se muestran como máximo 20 resúmenes por job. Por tanto, un resumen no sustituye la actividad en vivo durante un Intento largo; esa actividad tendría que salir por los logs de un job activo. [Comandos, grupos y resúmenes](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands).

| Dato necesario | Encaje en Actions nativo | Trabajo que permanece para la Factory |
| --- | --- | --- |
| Fase e Intentos | Jobs, steps y reejecuciones ofrecen agrupaciones de CI. No equivalen por sí mismos a los Intentos del dominio. | Mantener las identidades de Ejecución e Intento y su relación; representar la vuelta de corrección sin crear otra petición. |
| Agente, herramientas y comandos | Un runner puede emitir el texto en sus logs. | Capturar mensajes y herramientas, asociarlos a su Intento y conservar metadatos, salidas y códigos de salida. |
| Verificaciones y errores | Estados, logs y anotaciones son apropiados para una comprobación ejecutada allí. | Conservar comando, alcance, SHA, resultados y evidencia; distinguir fallo de código, de infraestructura y de observación. |
| Esperas humanas | Actions tiene sus propias esperas y aprobaciones de entornos. | Respetar aceptación y merge en GitHub ya acordados; mostrar causa y siguiente acción sin sustituirlos por aprobaciones de Actions. |
| Desconexión o silencio | El estado de un job no prueba conectividad de la Factory ni actividad reciente de OpenCode. | Registrar por separado contacto con cada fuente, actividad del agente, antigüedad y lagunas. |
| Tiempos y límites | Hay tiempos de jobs y steps. | Calcular presupuesto automático, espera humana y ampliaciones de la Ejecución según las reglas acordadas. |
| Consumo y costes | Los minutos de ejecución de Actions describen recursos de CI, no consumo de modelos. | Mostrar tokens disponibles, estimación OpenCode, modalidad, cobertura y procedencia; desconocido no equivale a cero. |
| Preview y producción | Se pueden añadir URLs y SHAs en logs o resúmenes. | Correlacionar candidato con Preview y commit integrado con Production; acreditar además qué versión sirve el dominio público. |
| Historial y enlaces | Actions conserva runs, logs y artefactos sujetos a retención. | Mantener el historial local completo acordado, referencias a issue/rama/PR/deployments y datos ausentes u omitidos. |

Las capacidades de CI de esta tabla se apoyan en [logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs) y [jobs](https://docs.github.com/en/rest/actions/workflow-jobs). Las diferencias semánticas y obligaciones de Factory proceden del [workflow aprobado](https://github.com/rubenbp/app-foundry/issues/5#issuecomment-6201919022) y del [contrato de persistencia](https://github.com/rubenbp/app-foundry/issues/6#issuecomment-6202301293); no son supuestas limitaciones de presentación de texto en Actions.

### Coste de utilizar la superficie nativa

Un runner propio permite ejecutar workflows en una máquina administrada por el proyecto, pero requiere configurar y mantener el runner y su entorno. Que el runner sea local no convierte automáticamente el proceso actual de Factory en jobs visibles. [Self-hosted runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners).

Si se mantiene la Factory independiente, una alternativa sería un workflow observador que lea un registro publicado y lo refleje. Añade un canal de datos, sincronización y otro ciclo de vida que reconciliar. El informe final podría generarse con un workflow corto, pero no ofrecería por sí solo los logs en vivo de toda la Ejecución. Esta es una alternativa inferida; no se ha prototipado. La otra vía, ejecutar la Factory como jobs, cambia despliegue, credenciales y persistencia, decisiones expresamente abiertas. [Arquitectura pendiente](https://github.com/rubenbp/app-foundry/issues/7), [Runs](https://docs.github.com/en/rest/actions/workflow-runs).

Las esperas largas complican el mapeo: GitHub limita un workflow a 35 días incluidos ejecución y esperas; los jobs de runners alojados duran hasta 6 horas y los propios hasta 5 días. Las aprobaciones de entornos tienen otro límite de 30 días. El trabajo automático previsto cabe holgadamente; mantener un job vivo esperando una respuesta humana es el mal encaje. Separar el recorrido en varios runs evitaría esa espera continua, pero obligaría a reconstruir su continuidad. [Límites actuales](https://docs.github.com/en/actions/reference/limits).

Una integración de checks externos es otra superficie: crear check runs mediante la API requiere una GitHub App y no crea un grafo de jobs de Actions. Los commit statuses, ya previstos para autorizar el merge, son más sencillos y admiten una URL de detalle, pero no crean un visor completo de actividad. Un enlace a localhost solo sería útil en la máquina que sirve el panel; no debe anunciarse como URL de acceso remoto. [Checks](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks), [Commit statuses](https://docs.github.com/en/rest/commits/statuses).

GitHub almacena por defecto logs y artefactos durante 90 días y permite configurar su retención; no sustituye el requisito local de conservación. Ninguna de estas opciones elimina la captura y el saneamiento de datos antes de persistirlos o publicarlos. [Retención](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/remove-workflow-artifacts), [Registro local acordado](https://github.com/rubenbp/app-foundry/issues/6#issuecomment-6202301293).

## Patrón mínimo para el panel local

Propuesta de alcance, derivada de los requisitos anteriores y del patrón de resumen/detalle de Actions:

1. **Cabecera de Ejecución.** Issue y título, fase y resultado, Intento actual, inicio y duración, presupuesto automático consumido/restante y enlaces a rama, PR, preview y producción cuando existan.
2. **Lista vertical de fases.** Fase actual, previas y pendientes, con texto de estado y tiempos. Una fase puede repetirse: mostrar la iteración y conservar las visitas anteriores en la cronología. Un error o una espera no se presenta como finalización favorable.
3. **Aviso contextual.** Motivo de espera o intervención y siguiente acción, con enlace al issue/PR y ejemplo de respuesta. El panel guía; la decisión humana sigue en GitHub.
4. **Cronología por Intento.** Mensajes del agente, herramientas, comandos, verificaciones, errores y eventos de deployment con timestamp y duración. Resumen breve por entrada; salidas extensas completas bajo demanda, saneadas. Renderizar como texto las salidas de herramientas.
5. **Estado de observación.** Último contacto local, GitHub y Vercel por separado; última actividad del agente; avisos de desconexión y lagunas. Reabrir la página recupera lo persistido, sin fingir continuidad durante una laguna. La cadencia del panel no aumenta la frecuencia externa de 15 segundos.
6. **Historial sencillo.** Lista de Ejecuciones anteriores y el mismo detalle de solo lectura. Consumo y coste como campos con procedencia y cobertura; sin gráficos contables ni calculadora propia.

No hacen falta arrastrar nodos, zoom, disposición automática de aristas, un editor de workflows, una terminal interactiva ni controles propios de aceptación. Un DAG resultaría relevante si aparecieran ramas de trabajo paralelas y dependencias cuya comprensión mejore con el grafo; el incremento actual no las requiere. Las correcciones se entienden mejor como visitas sucesivas a fases dentro de una cronología. Esta comparación es juicio de diseño, no un resultado medido con usuarios.

Debe poder verificarse la propuesta con un recorrido normal, fallo determinista y pérdida de conexión: identificar fase, actividad reciente y antigüedad, motivo de espera/fallo y siguiente acción; mantener historial y señalar la laguna tras reinicio; distinguir merge de producción acreditada. Recuperar la vista no autoriza reanudar la ejecución. [Reglas de continuidad y experimentos](https://github.com/rubenbp/app-foundry/issues/6#issuecomment-6202301293).

## Esfuerzo orientativo y condición de corte

Estas cifras son inferencias para planificar, no benchmarks ni compromisos. Supuestos: una persona familiarizada con el stack finalmente elegido, un operador local, sin autenticación remota, y un contrato de estado/historial ya implementado y saneado. Una jornada representa unas 6 horas de trabajo efectivo. No incluyen construir la Factory, persistencia, captura de OpenCode, integración de GitHub/Vercel ni resolver sus fallos.

Dentro de las 6–12 horas del panel, la lista de fases y cronología con detalle representan aproximadamente 3–6 horas; exponer el estado ya disponible mediante lectura local, 2–3 horas; y comprobar espera, desconexión e historial, 1–3 horas. La observabilidad que todavía deba construir el runtime queda fuera: no debe esconderse en el presupuesto de apariencia. A un ritmo de 2–3 horas por tarde, 6–12 horas son aproximadamente 2–6 tardes; las jornadas efectivas no equivalen a días de calendario.

| Opción | Esfuerzo adicional orientativo | Supuesto y límite |
| --- | --- | --- |
| Panel local lineal con detalle e historial | 1–2 jornadas, unas 6–12 horas. | Endpoint de lectura sencillo, vista de resumen/detalle y verificación de estados. Puede crecer si el registro existente no expone los datos necesarios. |
| Grafo interactivo además del panel | Añade 1–2 jornadas, unas 6–12 horas. | Layout, selección, tamaño de pantalla, navegación accesible y representación de visitas repetidas; no añade observación. |
| Actions como espejo/observador del runtime local | Añade 2–5 jornadas, unas 12–30 horas, sobre la captura y persistencia comunes. | Canal para publicar/leer observaciones, workflows, correlación y reconciliación. Confianza baja sin prueba de conectividad y modelo de jobs; no elimina las carencias semánticas señaladas. |
| Migrar el runtime a Actions | Sin estimación defendible con la arquitectura abierta. | No es una elección de apariencia; requiere redefinir ejecución, estado y credenciales. No se recomienda abrir esta vía para obtener el visor del MVP. |

La diferencia de complejidad procede de los mecanismos documentados y del trabajo de adaptación descrito, no de una medición de implementación. Empezar con resumen, lista de fases y cronología desplegable permite cortar refinamientos visuales sin perder los datos operativos exigidos. Con el plazo del TFM cercano, dedicar dos jornadas completas solo al visor sería un riesgo; el objetivo debe ser el extremo inferior. Si el alcance crece, reducir el historial a una lista de enlaces al mismo detalle y descartar filtros avanzados, gráficos y pulido; conservar identidad, estados, datos recientes, causa/siguiente acción y acceso a evidencias. La elección entre SSE y polling local se investiga por separado y no condiciona este patrón visual.

## Método y límites de la investigación

Se ha seguido research y, para delimitar el contrato de interacción sin implementar, UI Skills Root con el único contexto `kemiljk/interaction-contracts`. Ese contexto aconseja separar estado confirmado, feedback pendiente, propiedad/persistencia y recuperación; no aporta hechos sobre GitHub ni fija arquitectura.

La documentación de GitHub es actual a la consulta. No se ha comprobado un plan o configuración de retención concretos del repositorio ni un runner real. Las páginas nativas se han evaluado mediante su documentación oficial; no se afirma haber validado ergonomía con el usuario. Los rangos de esfuerzo tienen incertidumbre media en el panel y alta en el espejo de Actions. El artefacto ofrece una recomendación para resolver la decisión humana de visibilidad; no ejecuta el destino del mapa.
