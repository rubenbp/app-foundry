## Objetivo

Actualizar el mensaje del pie de Rebobina a «Clásicos para volver a jugar.» para probar un cambio editorial pequeño mediante la Factory.

## Contexto

El pie compartido está en `src/components/SiteFooter.astro` y actualmente muestra «Clásicos que merecen otra partida.». La página Sobre está en `/sobre-rebobina/`. Deben conservarse el enlace de la marca al inicio, la nota de demo y el año.

## Alcance

- Cambiar el texto del párrafo del pie compartido.
- Conservar la estructura, el estilo y la navegación existentes.
- Añadir pruebas de comportamiento en archivos nuevos si hacen falta.

## Fuera de alcance

No cambiar la introducción editorial, el catálogo, los filtros, las fichas de juegos ni el diseño. No modificar dependencias, lockfiles, configuración, comandos de verificación o pruebas existentes. No hacer push, abrir PR, integrar ni desplegar: esos efectos corresponden a la Factory y a la persona responsable.

## Criterios de aceptación

- [ ] En `/`, el párrafo del pie muestra exactamente «Clásicos para volver a jugar.».
- [ ] En `/sobre-rebobina/`, el párrafo del pie muestra exactamente «Clásicos para volver a jugar.».
- [ ] En `/sobre-rebobina/`, el enlace de marca del pie sigue visible y al pulsarlo se llega al inicio `/`.

## Comprobaciones de producción

```factory-production
[
  {
    "criterion": 1,
    "path": "/",
    "selector": "footer p",
    "text": "Clásicos para volver a jugar."
  },
  {
    "criterion": 2,
    "path": "/sobre-rebobina/",
    "selector": "footer p",
    "text": "Clásicos para volver a jugar."
  },
  {
    "criterion": 3,
    "path": "/sobre-rebobina/",
    "selector": "footer a.brand",
    "href": "/",
    "follow": true
  }
]
```

## Entrega del Commit candidato

Ejecutar las verificaciones configuradas y dejar todos los cambios en commits locales, sin archivos pendientes. Resumir el cambio, las comprobaciones y cualquier bloqueo real.

Para esta prueba, usar explícitamente en todos los commits locales el autor `App Foundry (rubenbp) <570775+rubenbp@users.noreply.github.com>`, mediante `git commit --author "App Foundry (rubenbp) <570775+rubenbp@users.noreply.github.com>" ...`. Es la identidad de automatización asociada a la cuenta GitHub responsable de esta prueba; permite que Vercel atribuya el autor. No modificar configuración Git, remotos, hooks ni la rama asignada.
