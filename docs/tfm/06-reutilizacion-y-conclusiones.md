# 6. Reutilización, aprendizajes y conclusiones

**En una frase:** el arnés y el flujo se reutilizan en otros proyectos cambiando solo su configuración, y lo que he aprendido es que la calidad de una fábrica de software depende sobre todo de esas dos piezas.

## 6.1 Qué se reutiliza y qué se adapta

| Nivel                    | Qué incluye                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Se reutiliza sin cambios | El arnés (encargo, permisos, `git` restringido y skills), el flujo (preparación, evaluación, publicación, cierre y recuperación) y el Dashboard                                         |
| Se adapta por proyecto   | El JSON del proyecto gestionado (repositorio, comandos de preparación y verificación, pruebas E2E y preview) y su propio `AGENTS.md`                                                    |
| Requiere desarrollo      | Otro proveedor de despliegue u otro sistema de issues (un adaptador cada uno) y proyectos con backend (entornos, datos y aislamiento). El conjunto de skills adecuado para el proyecto. |

Rebobina simplifica el ejemplo, pero el flujo no depende de ella. En un proyecto más complejo cambian la preparación del entorno, la verificación y el aislamiento; las fases y los puntos de decisión son los mismos.

**Encaje en JAKALA.** La veo como un complemento para cualquier equipo de desarrollo: se encarga de las tareas que claramente puede resolver sola. Cuanto mejores sean el arnés y la evaluación del flujo, más complejas serán las tareas que se le puedan delegar. A largo plazo, con los momentos de _human in the loop_ bien definidos, gran parte del prototipado y la ejecución podría automatizarse.

## 6.2 Beneficios observados

- **Una persona sin conocimientos técnicos puede pedir y aceptar un cambio** sin salir de GitHub.
- **Todo queda trazado:** petición, dudas, correcciones, evidencia y aceptación.
- **El modelo es intercambiable:** usé tres sin cambiar el flujo ni el arnés.
- **Corregir es barato:** un comentario abre otro Intento en la misma conversación.
- **El agente pregunta en lugar de inventar** y, ante una petición vaga, propone opciones basadas en el producto ([demo2 #6](https://github.com/rubenbp/appfoundry-site-demo2/issues/6)).

## 6.3 Aprendizajes y límites

1. **La calidad depende del arnés y del flujo más que del modelo, aunque sigue siendo relevante.** Lo que el agente hizo bien (preguntar ante la ambigüedad, probar su trabajo, redactar la PR para negocio) lo pedía el arnés; lo que se escapó, los defectos visuales, es lo que la evaluación del flujo no comprueba.
2. **El _human in the loop_ se diseña.** Los dos momentos humanos que más aportaron fueron la aclaración, que solo hizo falta ante peticiones vagas, y la revisión de la preview, que detectó los tres defectos visuales. Colocar a la persona donde hay criterio, y no en cada paso, es lo que permite automatizar el resto sin perder el control.
3. **Los límites deben imponerse, no pedirse.** Los permisos que niegan todo por defecto y el `git` restringido me permiten dar libertad al agente dentro del clon sin depender de que obedezca el prompt.
4. **Automatizar lo repetitivo cuesta más que el agente.** Casi todo el código de la Factory es el flujo: coordinación, recuperación e idempotencia frente a GitHub y Vercel, no la llamada al modelo.
5. **Los fallos vienen de los bordes:** la publicación, la observación de GitHub, los reinicios y las cuotas del proveedor fallaron más que el agente.
6. **El contexto se paga en lectura de caché,** entre 2 y 13 veces los tokens de entrada. Por token es barata, pero crece con cada Intento.
7. **No hay aislamiento real.** El agente corre con el mismo usuario del sistema y solo hay una Ejecución a la vez: vale para la demo, no para un uso abierto.
8. **La IA documenta para otra IA.** La documentación que generé con agentes salió exhaustiva y contractual: útil como instrucciones, pesada para una persona. Tuve que reescribirla para esta memoria.

## 6.4 Próximos pasos

- **Ampliar la evaluación del flujo** con comprobaciones visuales, para cubrir el tipo de defecto que hoy solo detecta una persona.
- **Aislar al agente** con contenedores o worktrees, lo que además permitiría varias Ejecuciones en paralelo.
- **Limitar tokens o coste** por Ejecución, con parada automática.
- **Medir el tiempo humano activo**, no solo la espera.
- **Probarla en un proyecto real** de la service line, con backend.
- **Preparar skills que aumenten la calidad del output del agente**, actualmente solo hay una skill de prueba.

## 6.5 Conclusión

La hipótesis se cumple en el banco de pruebas: 12 de 14 peticiones se integraron sin que tocara el código, y mi trabajo se redujo a los momentos de _human in the loop_: pedir, aclarar, revisar y decidir. Lo que más me llevo es que **una fábrica de software es tan buena como su arnés y su flujo**. El arnés hace que el modelo trabaje bien; el flujo decide qué se puede creer y hace, siempre igual, todo el trabajo repetitivo hasta producción. Lo que el flujo no evalúa lo tiene que ver una persona, y por eso el _human in the loop_ forma parte del diseño, no es un parche. Sí usaría la Factory en un proyecto real para tareas bien definidas, con un desarrollador que la opere y revise lo que se integra, y mejorando ambas piezas para delegarle tareas cada vez más complejas.
