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
