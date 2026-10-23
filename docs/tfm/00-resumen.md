# App Foundry: un flujo determinista que guía a un agente de IA desde la petición hasta el merge

**Autor:** Rubén Bernárdez Patier · **Track:** Track 1 · Desarrollo de Código · **Fecha:** Octubre de 2026

**Repositorios:**

- [Factory](https://github.com/rubenbp/app-foundry) (versión entregada: etiqueta [`tfm-entrega`](https://github.com/rubenbp/app-foundry/tree/tfm-entrega))
- Proyecto de demostración Rebobina: [`appfoundry-site-demo`](https://github.com/rubenbp/appfoundry-site-demo), en producción en [rebobina-appfoundry.vercel.app](https://rebobina-appfoundry.vercel.app/), y su copia [`appfoundry-site-demo2`](https://github.com/rubenbp/appfoundry-site-demo2), con la que probé el asistente de configuración.

## Resumen

En el departamento DXP de JAKALA usamos agentes de IA como apoyo en el IDE, pero el proceso que lleva una petición hasta una versión aceptada sigue en manos de las personas. He construido App Foundry, una fábrica de software que automatiza ese proceso. Un agente de IA analiza y construye cada petición escrita como issue de GitHub. La calidad de la fábrica descansa en dos piezas. El **arnés** acota al agente: qué contexto recibe, qué herramientas puede usar y qué tiene prohibido. El **flujo determinista** evalúa su resultado y automatiza todo lo repetitivo hasta el merge: prepara el entorno, lanza las pruebas, publica la PR, comprueba la preview de Vercel y cierra el issue tras el merge, que Vercel lleva a producción. Una persona interviene solo en momentos definidos del flujo, lo que se conoce como _human in the loop_: autorizar, aclarar, revisar y aceptar, y resolver fallos.

La probé con 14 peticiones reales. **12 se integraron sin editar código a mano**: 9 de 10 mientras corregía la Factory y 3 de 4 con la versión final. De media por Ejecución, el agente trabajó unos 5 minutos y gastó 0,18 USD de tokens. Contando una revisión técnica del código, estimo un ahorro de 66 a 185 € por petición frente a hacerlas sin IA, y de 15 a 86 € frente a un desarrollador con un agente en el IDE; la Factory se amortiza entre la petición 7 y la 20 frente al trabajo sin IA. Mi conclusión principal es que **la calidad de una fábrica de software depende sobre todo de su arnés y de su flujo**. Probé tres modelos sin cambiar ninguna de las dos piezas, aunque solo los dos de OpenAI completaron Ejecuciones. Los fallos de proceso aparecieron en los bordes de la Factory (la coordinación con GitHub y las cuotas del proveedor), y los defectos del agente, en lo que la evaluación no comprueba.

## Cómo probarlo

- **Vídeo** del recorrido completo del [issue #4](https://github.com/rubenbp/appfoundry-site-demo2/issues/4) (18 min): [recorrido-issue-4.mp4](https://github.com/rubenbp/app-foundry/blob/tfm-entrega/docs/tfm/video/recorrido-issue-4.mp4). Las figuras 3 a 8 y 11 son fotogramas suyos.
- **Instalación y prueba local:** [README de la Factory](https://github.com/rubenbp/app-foundry#readme).
- **Ejemplos:** [issue #4](https://github.com/rubenbp/appfoundry-site-demo2/issues/4) y su [PR #5](https://github.com/rubenbp/appfoundry-site-demo2/pull/5); [issue #6](https://github.com/rubenbp/appfoundry-site-demo2/issues/6) y su [PR #7](https://github.com/rubenbp/appfoundry-site-demo2/pull/7).
