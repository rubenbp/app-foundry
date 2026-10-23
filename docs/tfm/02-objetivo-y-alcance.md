# 2. Objetivo y alcance

**En una frase:** mi objetivo es construir una fábrica de software que lleve un issue de GitHub hasta el merge, tras el que Vercel publica producción, con un agente de IA que construye, un arnés que lo acota, un flujo determinista que evalúa y automatiza el resto, y una persona que decide en momentos fijos del flujo (_human in the loop_).

## Hipótesis

Si el agente trabaja dentro de un arnés que fija su contexto, sus herramientas y sus límites, y un flujo determinista evalúa su resultado y automatiza la preparación, las pruebas, la publicación y la comprobación de la preview, entonces puede llevar una petición razonablemente clara hasta una PR con preview y comprobaciones superadas **sin edición humana de código**. La persona solo interviene en los momentos de _human in the loop_ que fija el flujo: autorizar, aclarar, revisar y aceptar, y resolver fallos.

## Qué busco

- **Un proceso repetible:** todas las peticiones pasan por las mismas fases y validaciones, sea cual sea el modelo.
- **Menos tiempo humano:** la persona escribe el issue y revisa el resultado.
- **Menos espera:** la preview llega en minutos, no en días.
- **Trazabilidad:** la petición, las dudas, las correcciones, la evidencia y la aceptación quedan en GitHub.

## Qué incluye

- La **Factory**: aplicación local en Node.js y TypeScript que aplica el arnés y ejecuta el flujo sobre GitHub y Vercel, con un Dashboard en React para observarlo.
- **Rebobina**, un catálogo de videojuegos retro en Astro conectado a GitHub y Vercel. La generé con IA y sin backend para simplificar el ejemplo: es el banco de pruebas, no el límite de la Factory.
- El recorrido completo: issue, agente, verificación, PR, preview, revisión, merge y cierre, con aclaraciones, correcciones y recuperación desde el propio issue.
- Registro de tokens y coste estimado, y proveedores de modelo intercambiables (OpenAI, Gemini, Claude y Ollama).

## Qué dejo fuera

| Fuera de alcance                       | Motivo                                                            |
| -------------------------------------- | ----------------------------------------------------------------- |
| Varias Ejecuciones en paralelo         | Prioricé un recorrido completo y fiable antes que la concurrencia |
| Aislamiento con contenedores           | El MVP presupone operadores y repositorios de confianza           |
| Proyectos con backend o base de datos  | Simplifiqué el banco de pruebas para centrarme en el flujo        |
| Merge automático                       | La aceptación es siempre humana                                   |
| Despliegue de la Factory como servicio | La ejecuto en local; no hace falta para demostrar el flujo        |
