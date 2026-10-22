# App Foundry: un flujo determinista que guía a un agente de IA desde la petición hasta el merge

**Autor:** Rubén Bernárdez Patier · **Track:** Track 1 · Desarrollo de Código · **Fecha:** Octubre de 2026

**Repositorios:**

- [Factory](https://github.com/rubenbp/app-foundry) (versión entregada: etiqueta [`tfm-entrega`](https://github.com/rubenbp/app-foundry/tree/tfm-entrega))
- Proyecto de demostración Rebobina: [`appfoundry-site-demo`](https://github.com/rubenbp/appfoundry-site-demo), en producción en [rebobina-appfoundry.vercel.app](https://rebobina-appfoundry.vercel.app/), y su copia [`appfoundry-site-demo2`](https://github.com/rubenbp/appfoundry-site-demo2), con la que probé el asistente de configuración.

## Resumen

En el departamento DXP de JAKALA usamos agentes de IA como apoyo en el IDE, pero el proceso que lleva una petición hasta una versión aceptada sigue en manos de las personas. He construido App Foundry, una fábrica de software que automatiza ese proceso. Un agente de IA analiza y construye cada petición escrita como issue de GitHub. La calidad de la fábrica descansa en dos piezas. El **arnés** acota al agente: qué contexto recibe, qué herramientas puede usar y qué tiene prohibido. El **flujo determinista** evalúa su resultado y automatiza todo lo repetitivo hasta producción: prepara el entorno, lanza las pruebas, publica la PR, despliega la preview en Vercel y cierra el issue tras el merge, que Vercel lleva a producción. Una persona interviene solo en momentos definidos del flujo, lo que se conoce como _human in the loop_: autoriza el trabajo, aclara dudas, corrige y acepta con el merge.

La probé con 14 peticiones reales. **12 se integraron sin editar código a mano**, con unos 5 minutos de agente y 0,18 USD de tokens de media por Ejecución. Estimo un ahorro de 80 a 190 € por petición frente a hacerlas sin IA, y que la Factory se amortiza en 7 a 15 peticiones. Mi conclusión principal es que **la calidad de una fábrica de software depende sobre todo de su arnés y de su flujo**. Cambié tres veces de modelo y los problemas aparecieron en sus bordes (la coordinación con GitHub, las cuotas del proveedor y lo que la evaluación no comprueba), no en el agente.

## Cómo probarlo

- **Vídeo** del recorrido completo del [issue #4](https://github.com/rubenbp/appfoundry-site-demo2/issues/4) (18 min): [recorrido-issue-4.mp4](video/recorrido-issue-4.mp4). Las figuras 3 a 8 y 11 son fotogramas suyos.
- **Instalación y prueba local:** [README de la Factory](https://github.com/rubenbp/app-foundry#readme).
- **Ejemplos:** [issue #4](https://github.com/rubenbp/appfoundry-site-demo2/issues/4) y su [PR #5](https://github.com/rubenbp/appfoundry-site-demo2/pull/5); [issue #6](https://github.com/rubenbp/appfoundry-site-demo2/issues/6) y su [PR #7](https://github.com/rubenbp/appfoundry-site-demo2/pull/7).
