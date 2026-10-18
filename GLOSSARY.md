# App Foundry

Fábrica de software para que el equipo responsable de un producto automatice su desarrollo mediante issues y workflows con agents.

## Language

**Factory**:
Sistema que coordina el desarrollo de un Managed project mediante workflows deterministas y agents de código. Tiene un repositorio propio, separado del producto que desarrolla.
_Avoid_: aplicación gestionada, boilerplate

**Managed project**:
Aplicación web que la Factory desarrolla a partir de sus issues, incluidos cambios de código, contenido, secciones y páginas. Tiene su propio repositorio y deployments.
_Avoid_: Factory, repositorio de la fábrica

**Issue de GitHub**:
Registro de una solicitud de cambio en GitHub. Su contenido puede cambiar y, por sí solo, no autoriza el inicio del trabajo ni acepta su resultado.
_Avoid_: Petición autorizada

**Issue autorizado**:
Issue de GitHub cuyo contenido y autorización se han comprobado y capturado para iniciar una Ejecución. La captura fija el objetivo y los criterios de aceptación; esta autorización permite empezar el trabajo, pero no acepta su resultado.
_Avoid_: Petición autorizada, cambio aceptado, resultado aprobado

**Ejecución**:
Recorrido de la Factory para atender un Issue autorizado, desde el inicio del trabajo hasta su finalización o cancelación. Incluye el trabajo automático y las esperas de intervención humana, integración y publicación.
_Avoid_: sesión del agente, issue

**Intento**:
Unidad de trabajo que la Factory encarga al agente dentro de una Ejecución. Una Ejecución puede contener varios Intentos sin cambiar su Issue autorizado.
_Avoid_: Ejecución, turno del modelo, sesión de OpenCode

**Commit candidato**:
Commit `HEAD` que el agente deja en la rama de trabajo del Issue autorizado. La Factory lo verifica junto con todos los cambios acumulados desde la base; tras superar las comprobaciones, es la versión que puede presentarse para aceptación.
_Avoid_: candidato

**Aceptación del resultado**:
Decisión humana que acepta el cambio de un Commit candidato concreto tras revisar sus evidencias y preview, y autoriza su integración y publicación. Si cambia el Commit candidato antes de integrar, se requiere una nueva aceptación.
_Avoid_: Issue autorizado, pruebas superadas
