# 6. Reutilización, aprendizajes y conclusiones

**En una frase:** el arnés y el flujo están diseñados para reutilizarse en otros proyectos cambiando solo su configuración, aunque solo lo he probado en Rebobina y en una copia instalada con el asistente; lo que he aprendido es que la calidad de una fábrica de software depende sobre todo de esas dos piezas.

## 6.1 Qué se reutiliza y qué se adapta

| Nivel                    | Qué incluye                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Se reutiliza sin cambios | El arnés (encargo, permisos, `git` restringido y skills), el flujo (preparación, evaluación, publicación, cierre y recuperación) y el Dashboard                                         |
| Se adapta por proyecto   | El JSON del proyecto gestionado (repositorio, comandos de preparación y verificación, pruebas E2E y preview) y su propio `AGENTS.md`                                                    |
| Requiere desarrollo      | Otro proveedor de despliegue u otro sistema de issues (un adaptador cada uno) y proyectos con backend (entornos, datos y aislamiento). El conjunto de skills adecuado para el proyecto. |

Rebobina simplifica el ejemplo, pero el flujo no depende de ella. En un proyecto más complejo cambiarían la preparación del entorno, la verificación y el aislamiento; las fases y los puntos de decisión serían los mismos.

**Encaje en JAKALA.** La veo como un complemento para cualquier equipo de desarrollo: se encarga de las tareas que claramente puede resolver sola. Cuanto mejores sean el arnés y la evaluación del flujo, más complejas serán las tareas que se le puedan delegar. A largo plazo, con los momentos de _human in the loop_ bien definidos, gran parte del prototipado y la ejecución podría automatizarse.

## 6.2 Beneficios observados

- **Una persona sin conocimientos técnicos puede pedir y aceptar un cambio** sin salir de GitHub: valida el comportamiento en la preview. En el uso previsto, el código lo revisaría el técnico que opera la Factory.
- **Todo queda trazado:** petición, dudas, correcciones, evidencia y aceptación.
- **El modelo es intercambiable:** completé Ejecuciones con dos modelos de OpenAI y lancé Gemini sin cambiar el flujo ni el arnés.
- **Corregir es barato:** un comentario abre otro Intento en la misma conversación.
- **El agente pregunta en lugar de inventar** y, ante una petición vaga, propone opciones basadas en el producto ([demo2 #6](https://github.com/rubenbp/appfoundry-site-demo2/issues/6)).

## 6.3 Aprendizajes y límites

1. **La calidad depende del arnés y del flujo más que del modelo, aunque sigue siendo relevante.** Lo que el agente hizo bien (preguntar ante la ambigüedad, probar su trabajo, redactar la PR para negocio) lo pedía el arnés; lo que se escapó, los defectos visuales, es lo que la evaluación del flujo no comprueba.
2. **El _human in the loop_ se diseña.** Los dos momentos humanos que más aportaron fueron la aclaración, que solo hizo falta ante peticiones vagas, y la revisión de la preview, que detectó los tres defectos visuales. Colocar a la persona donde hay criterio, y no en cada paso, es lo que permite automatizar el resto sin perder el control.
3. **Los límites deben imponerse, no pedirse.** Los permisos que niegan todo por defecto y el `git` restringido me permiten dar libertad al agente dentro del clon sin depender solo de que obedezca el prompt. Sin aislamiento real, siguen siendo una mitigación, no una garantía.
4. **Automatizar lo repetitivo cuesta más que el agente.** Casi todo el código de la Factory es el flujo: coordinación, recuperación e idempotencia frente a GitHub y Vercel, no la llamada al modelo.
5. **Los fallos vienen de los bordes:** la publicación, la observación de GitHub, los reinicios y las cuotas del proveedor fallaron más que el agente.
6. **El contexto se paga en lectura de caché,** entre 2 y 13 veces los tokens de entrada. Por token es barata, pero crece con cada Intento.
7. **No hay aislamiento real.** El agente corre con el mismo usuario del sistema y solo hay una Ejecución a la vez: vale para la demo, no para un uso abierto.
8. **La IA documenta para otra IA.** La documentación que generé con agentes salió exhaustiva y contractual: útil como instrucciones, pesada para una persona. Tuve que reescribirla para esta memoria.

## 6.4 Riesgos de delegar

Delegar la ejecución no delega la responsabilidad, y estos riesgos crecen cuando el arnés y el flujo no están a la altura del producto.

- **Deuda de comprensión.** El código entra más rápido de lo que el equipo lo entiende. Me pasó al construir la Factory (apartado 3.7): no siempre reconocía las decisiones. Cuanto menos se entiende el código, más se depende de la IA para explicarlo, depurarlo y corregirlo.
- **Revisión superficial.** En JAKALA la Factory la operarían técnicos, así que habría quien lea el diff. El riesgo es cómo lo lee: no lo ha escrito, la verificación sale en verde y la preview funciona, así que la revisión acaba descansando en la confianza en la IA. Cuanto mejor funciona la Factory, más fácil es aprobar sin entender, por eso las partes críticas del producto deberían exigir una revisión técnica explícita.
- **Decisiones técnicas sin control.** Una tarea mecánica también decide dónde va el código, qué patrón sigue o qué dependencia añade. Hoy el agente puede instalar dependencias y el flujo solo lo anota en la verificación, sin bloquearla. Como los permisos, la tecnología y la arquitectura deben imponerse con reglas que el flujo compruebe.
- **Más funcionalidad de la que compensa.** La Factory elimina la fricción que obligaba a priorizar. El coste no está en escribir el código, sino en mantenerlo, probarlo y en que el agente tenga más que leer en cada Intento.
- **Entropía acumulada.** Cada Intento resuelve su issue de forma local y nadie ordena el conjunto. Las pruebas fiables y un código modular, con responsabilidades claras, pasan a ser el control tanto del agente como de quien lo opera.

## 6.5 Próximos pasos

- **Ampliar la evaluación del flujo** con comprobaciones visuales, para cubrir el tipo de defecto que hoy solo detecta una persona.
- **Aislar al agente** con contenedores o worktrees, lo que además permitiría varias Ejecuciones en paralelo.
- **Limitar tokens o coste** por Ejecución, con parada automática.
- **Medir el tiempo humano activo**, no solo la espera.
- **Probarla en un proyecto real** de la service line sin backend y ampliar sus características para proyectos con backend.
- **Preparar skills que aumenten la calidad del output del agente**, actualmente solo hay una skill de prueba.
- **Dividir el trabajo entre varios agentes especializados.** Hoy un único agente, en una sola conversación por Ejecución, analiza la petición, implementa, prueba y redacta la PR, y tiene prohibido delegar. Separar esas responsabilidades permitiría dar a cada agente solo el contexto, las herramientas y los permisos que necesita manteniéndolo lo más enfocado posible a su responsabilidad única.
- **Dar soporte a servidores MCP.** Hoy el agente solo dispone de las herramientas propias de OpenCode: la configuración que genera la Factory no declara servidores MCP y su política niega por defecto cualquier otra herramienta.

## 6.6 Conclusión

En un proyecto pequeño, la Factory llevó casi todas las peticiones hasta el merge sin que yo editara código, con un ahorro estimado de tiempo y coste frente a hacerlas sin IA o con un agente en el IDE. El agente no solo implementó: también escribió las pruebas unitarias y E2E que después ejecuta el flujo. Además, la experiencia confirma que **la fábrica automatiza la ejecución, pero el criterio sigue siendo humano**, primero al definir el arnés y el flujo, y después al decidir qué se construye y qué se acepta. **Cuanto más criterio se convierte en reglas comprobables, más se puede delegar.**

Esta prueba no demuestra que el ahorro se mantenga en los proyectos reales de JAKALA, pero creo que justifica seguir explorando este camino. La clave está en la **mantenibilidad**: que lo construido petición a petición no se convierta con el tiempo en un castillo de naipes que nadie entiende y que solo la IA sabe tocar. Quedan muchos retos antes de dar más autonomía a la fábrica; estos son tres de los principales:

- **Pruebas que den confianza para ir a producción.** Hoy el mismo agente prueba su propio código, y esas pruebas pasaron en verde con tres defectos visuales. Las que validan los requisitos deberían nacer de los criterios de aceptación, no de la implementación, y asegurarse de que validan lo que se desea validar y fallan por el motivo adecuado.
- **Código que exprese la intención:** que una persona pueda leerlo y entenderlo a alto nivel y que respete la arquitectura y las prácticas del proyecto, para que perder el control fino del código no se convierta en un problema.
- **Agentes especializados y bien orquestados.** Un agente centrado en una sola labor, como la investigación, la implementación, la revisión, la calidad o la interfaz, debería hacerlo mejor que uno generalista por tener un contexto y objetivo más enfocado. El reto es conseguir orquestarlos de forma eficiente.

Desarrollar software es complejo, y la fábrica también debe construirse de forma iterativa e incremental: empezar por las tareas más automatizables y delegar más a medida que el arnés y el flujo demuestren que pueden sostenerlo.
