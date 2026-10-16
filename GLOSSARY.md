# App Foundry

Fábrica de software para que el equipo responsable de un producto automatice su desarrollo mediante issues y workflows con agents.

## Language

**Factory**:
Sistema que coordina el desarrollo de un Managed project mediante workflows deterministas y agents de código. Tiene un repositorio propio, separado del producto que desarrolla.
_Avoid_: aplicación gestionada, boilerplate

**Managed project**:
Aplicación web que la Factory desarrolla a partir de sus issues, incluidos cambios de código, contenido, secciones y páginas. Tiene su propio repositorio y deployments.
_Avoid_: Factory, repositorio de la fábrica

**Petición autorizada**:
Solicitud de cambio para un Managed project cuyo objetivo y criterios de aceptación han sido aprobados por una persona. Esta autorización permite iniciar el trabajo, pero no acepta su resultado.
_Avoid_: cambio aceptado, resultado aprobado

**Ejecución**:
Recorrido de la Factory para atender una Petición autorizada, desde el inicio del trabajo hasta su finalización o cancelación. Incluye el trabajo automático y las esperas de intervención humana, integración y publicación.
_Avoid_: sesión del agente, issue

**Intento**:
Unidad de trabajo que la Factory encarga al agente dentro de una Ejecución. Una Ejecución puede contener varios Intentos sin cambiar su Petición autorizada.
_Avoid_: Ejecución, turno del modelo, sesión de OpenCode

**Aceptación del resultado**:
Decisión humana que acepta el cambio de un commit candidato concreto tras revisar sus evidencias y preview, y autoriza su integración y publicación. Si cambia el commit candidato antes de integrar, se requiere una nueva aceptación.
_Avoid_: Petición autorizada, pruebas superadas
