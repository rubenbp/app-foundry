# 1. Problema y contexto

**En una frase:** los agentes de IA ya escriben código, pero su resultado depende de quién los maneje y el proceso que lleva una petición hasta software aceptado sigue siendo manual.

## La necesidad

Toda petición recorre las mismas fases: entender qué se pide, aclarar lo que falta, preparar el entorno, implementar, verificar, publicar una versión revisable, corregir y aceptar. Hoy una persona coordina ese recorrido:

1. Alguien describe la petición y espera a que un desarrollador la recoja.
2. El desarrollador prepara una rama, entiende el proyecto y el ticket e implementa, cada vez más con un agente de IA.
3. Ejecuta build, lint, tipos y pruebas, y corrige lo que falle.
4. Publica la rama, abre la PR, avisa a sus compañeros a que lo prueben.
5. Los compañeros revisan, levantan el entorno junto con el código de la PR en local, piden ajustes y el ciclo se repite hasta el merge. Un proceso pensado para ser probado por otros compañeros técnicos y no tanto perfiles de UX o negocio de forma sencilla y ágil.

La IA acelera el paso 2, pero no el resto, y los pasos 3 y 4 son repetitivos: se hacen igual en cada petición. Además, el trabajo de un agente no es determinista: depende del prompt, del contexto que encuentre, de las herramientas que tenga y de lo que decida comprobar. **Sin un marco común, cada sesión con el agente es distinta** y nadie puede garantizar qué se probó ni quién lo aceptó. Lo más cercano a ello es tener implementado un buen sistema de pipelines en un CI que te ayude a automatizar algunos de los pasos pero requeriría de duplicar y mantener esa configuración para cada proyecto.

## El contexto en JAKALA

Trabajo en el departamento DXP de JAKALA. Construimos software web para clientes de largo recorrido, que evolucionamos durante años, a medida o sobre CMS como Drupal o Payload. Solemos encargarnos del frontend y, a veces, de parte del backend en PHP o Node.js. En estos proyectos las peticiones llegan de forma continua. Hoy usamos los agentes de IA como apoyo en el IDE: aceleran al desarrollador, pero no cambian el proceso.

## A quién afecta

- **Clientes y negocio**, que dependen de la disponibilidad del equipo para ver sus cambios.
- **Desarrolladores**, que dedican tiempo a preparar, verificar, publicar y supervisar al agente paso a paso.
- **Responsables técnicos**, que necesitan saber qué se cambió, con qué evidencia y quién lo aceptó.

## Cómo se resuelve hoy

| Forma actual                   | Qué resuelve                 | Qué no resuelve                                                            |
| ------------------------------ | ---------------------------- | -------------------------------------------------------------------------- |
| Desarrollador sin IA           | Calidad y criterio           | Coste en horas por petición y cola de espera                               |
| Desarrollador con agente o IDE | Escribe el código más rápido | La persona sigue preparando, verificando, publicando y coordinando         |
| Agente autónomo sin controles  | Puede hacerlo todo           | Resultado no determinista; nadie garantiza qué se probó ni quién lo aceptó |

El hueco está entre las dos últimas filas: **un arnés que acote al agente y un flujo determinista que evalúe su trabajo y automatice el resto, y que reserve a una persona los momentos de decisión: el _human in the loop_**.
