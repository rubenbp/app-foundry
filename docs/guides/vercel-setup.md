# Configuración inicial de GitHub y Vercel

Guía para el Managed project de App Foundry. Actualizada el 14 de octubre de 2026. El recorrido GitHub → preview → aceptación humana → merge → producción de Rebobina está comprobado. Véase el [registro de evidencias](../evidence/github-vercel/README.md).

## Objetivo

La infraestructura inicial debe permitir publicar la plantilla, desplegar cambios de ramas como previews y actualizar producción después de integrar una pull request aprobada por una persona. La aprobación del merge es también la autorización de publicación en este recorrido.

La conexión se realiza sobre el repositorio del **Managed project**. El repositorio `rubenbp/app-foundry` contiene la **Factory** y su planificación. El Managed project seleccionado es [Rebobina](https://github.com/rubenbp/appfoundry-site-demo), conectado al proyecto Vercel `appfoundry-site-demo` del equipo `rubenbpvs-projects` (Hobby).

## Paso 1. Preparar el repositorio del Managed project

1. Crear o seleccionar su repositorio GitHub, separado de la Factory.
2. Publicar una plantilla funcional en `main`, con el archivo de bloqueo de dependencias y los comandos de instalación, compilación y verificación documentados.
3. Ejecutar esos comandos localmente y comprobar que la página de inicio funciona.
4. Usar ramas dentro de este repositorio para los cambios de issues.

En un equipo Hobby, Vercel comprueba que el autor del commit corresponda al propietario del equipo. La identidad de los commits producidos por la Factory deberá cumplir esa condición; revisarla antes del primer experimento. También hay restricciones para repositorios privados de organizaciones. [Fuente: integración Git y autorizaciones](https://vercel.com/docs/git).

## Paso 2. Importar la aplicación en Vercel

1. Abrir [New Project](https://vercel.com/new) y seleccionar el equipo de Vercel previsto para la demostración.
2. Conectar GitHub si se solicita. Autorizar la aplicación GitHub de Vercel para acceder al repositorio seleccionado.
3. Importar el repositorio del Managed project. Si no aparece, revisar los permisos de la integración.
4. Comprobar nombre del proyecto, framework y directorio raíz antes de pulsar **Deploy**.

[Fuente: importar repositorios Git](https://vercel.com/docs/git#deploying-a-git-repository).

## Paso 3. Comprobar la configuración de compilación

En el proyecto de Vercel, abrir **Settings → Build and Deployment**:

- **Framework Preset**: el de la plantilla elegida.
- **Root Directory**: el directorio que contiene la aplicación; la raíz si ocupa todo el repositorio.
- **Install Command**, **Build Command** y **Output Directory**: comprobar los valores detectados con los comandos y salida reales de la plantilla.
- Comprobar una versión de Node compatible con la aplicación.

Mantener los valores detectados cuando sean correctos. Rebobina usa Astro estático: raíz del repositorio, instalación y build automáticos con pnpm, salida `dist` y Node `24.x` en Vercel. Si se necesitan variables, configurar las de Preview y Production en sus respectivos entornos.

[Fuente: configuración de builds](https://vercel.com/docs/builds/configure-a-build).

## Paso 4. Configurar producción y previews

1. Abrir **Settings → Environments → Production → Branch Tracking**.
2. Establecer `main` como rama de producción y guardar.
3. Mantener activado **Auto-assign Custom Production Domains** para que el despliegue correcto de producción actualice sus dominios automáticamente.
4. En **Settings → Git**, comprobar el repositorio conectado y mantener las notificaciones y estados de despliegue para poder observarlos desde GitHub.

Tras la configuración, los pushes a ramas distintas de `main` producen previews y los cambios en `main` producen despliegues de producción. Esto incluye pushes directos: la restricción al merge autorizado se establece en GitHub, no se deduce de Vercel.

El primer despliegue de un proyecto nuevo es de producción, incluso si se inicia desde otra rama. Importar la plantilla base consciente de este comportamiento.

[Fuentes: entornos y primer despliegue](https://vercel.com/docs/deployments/environments), [rama de producción](https://vercel.com/docs/git#production-branch) y [estados en GitHub](https://vercel.com/docs/git/vercel-for-github).

## Paso 5. Establecer el punto de decisión humana

En GitHub, configurar reglas de `main` que exijan una pull request y las comprobaciones pertinentes antes de integrar, según las funciones disponibles para el plan y repositorio. Seleccionar los checks por sus nombres reales después de una primera ejecución. [Fuente: ramas protegidas](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

La persona responsable revisa la preview y los resultados del commit vigente antes del merge. Para una demostración con un solo usuario, concretar un mecanismo de aceptación y merge humano que funcione con esa identidad. Si el agente y la persona comparten credenciales con capacidad de merge, las reglas de rama por sí solas no prueban que haya intervenido una persona: el workflow debe preservar ese punto de decisión y su evidencia.

El mecanismo exacto de aceptación se resolverá en el ticket del workflow. Cualquier cambio posterior del commit requiere revisar nuevamente lo que se va a publicar.

## Paso 6. Comprobar el acceso a previews

Revisar **Settings → Deployment Protection**. Comprobar que la persona que revisará el cambio puede abrir la preview con el acceso configurado. Standard Protection protege las previews, mientras los dominios de producción quedan accesibles según esa configuración. [Fuente: Deployment Protection](https://vercel.com/docs/deployment-protection).

Si después se ejecutan pruebas automáticas sobre previews protegidas, resolver el acceso autorizado como parte de su integración. Guardar una captura que muestre el acceso utilizado para la demostración.

## Paso 7. Probar el ciclo antes de integrar OpenCode

1. Crear una rama de prueba a partir de `main` y realizar un cambio visible pequeño en la web.
2. Publicar el commit y abrir una pull request hacia `main`.
3. Esperar el despliegue de Preview. Comprobar el cambio y que el commit desplegado coincide con el de la pull request.
4. Guardar URL, identificador del despliegue, SHA y captura. Confirmar que producción sigue mostrando la versión anterior.
5. Revisar los checks y registrar la aceptación humana del cambio vigente.
6. Mergear la pull request. Esta acción inicia la publicación acordada.
7. Esperar el despliegue de Production y comprobar que el commit resultante del merge y el cambio visible corresponden a la versión publicada.
8. Guardar la URL de producción y las evidencias. Un merge completado y un despliegue fallido son resultados diferentes: registrar ambos.

**Criterio de finalización:** existe evidencia del recorrido rama → preview → aceptación humana → merge → producción, sobre el repositorio y proyecto seleccionados. La Factory deberá poder consultar estado, URL y commit del deployment; la elección del mecanismo de consulta sigue pendiente en el workflow y la visibilidad operativa.

## Skills, MCP y ejecución de la Factory

- **Integración Git**: es el mecanismo inicial recomendado para disparar los despliegues. El flujo automático descrito no necesita que un agente invoque herramientas de Vercel. [Fuente](https://vercel.com/docs/git/vercel-for-github).
- **Skill**: aporta instrucciones al agente que ayuda a preparar y diagnosticar el proyecto. `vercel:deployments-cicd` resulta útil; no ejecuta despliegues por sí misma ni es una dependencia del workflow determinista.
- **MCP de Vercel**: aporta herramientas para consultar proyectos, deployments y logs, entre otras operaciones. Es opcional para esta configuración Git. Su endpoint oficial es `https://mcp.vercel.com` y usa OAuth. Las herramientas disponibles en esta conversación no configuran automáticamente el OpenCode de la Factory. [Fuente: MCP oficial](https://vercel.com/docs/agent-resources/vercel-mcp).

Para conectar posteriormente OpenCode, la documentación oficial muestra esta configuración. Integrarla con la configuración existente y realizar la autenticación desde el entorno donde se ejecutará OpenCode:

```json
{
  "mcp": {
    "vercel": {
      "type": "remote",
      "url": "https://mcp.vercel.com"
    }
  }
}
```

```bash
opencode mcp auth vercel
```

[Fuente: Vercel MCP con OpenCode](https://vercel.com/docs/agent-resources/vercel-mcp#opencode).

La Factory necesita un mecanismo de observación de despliegues. Podemos elegir señales de GitHub, API/CLI o herramientas MCP según lo que requiera el workflow. El agente de código no necesita decidir cuándo publicar: en el recorrido inicial, la aprobación humana y el merge preceden al despliegue automático.

## Datos y evidencias que conservar

Registrar repositorio, equipo y proyecto Vercel, rama de producción, parámetros de build, URLs y política de acceso a previews. Para cada prueba conservar SHA de la rama, SHA del merge, estados de los checks y deployments, timestamps, aceptación humana y capturas legibles. Evitar credenciales en las evidencias.

La configuración se considera montada cuando pasa el paso 7. La guía preparada y una configuración propuesta todavía no constituyen evidencia de un despliegue real.
