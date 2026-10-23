# 5. Justificación de negocio

**En una frase:** con mis supuestos, y contando una revisión técnica del código, cada petición cuesta entre 66 y 185 € menos que sin IA y entre 15 y 86 € menos que con un agente en el IDE; los tokens son despreciables y el coste real está en las horas de revisión y de operación.

## 5.1 Supuestos

Todas las cifras de este apartado son **estimaciones** construidas sobre datos medidos.

- **Perfil sin IA:** un desarrollador frontend con experiencia, a **35 €/h** de coste para la empresa: unos 45.000 € brutos al año, por 1,3 de cargas sociales, entre unas 1.700 horas productivas. Uso el coste interno y no la tarifa de venta, más alta, para que el ahorro quede por lo bajo.
- **Horas sin IA:** incluyen entender la petición, implementar, probar, abrir la PR, esperar la preview y una ronda de corrección.
- **Perfil con IA en el IDE:** el mismo desarrollador con un agente en el IDE, que es como trabajamos hoy (apartado 1). Con la calidad de los modelos actuales, supongo que el agente hace casi toda la implementación y ayuda a entender y probar, pero que preparar, verificar, publicar y coordinar la revisión siguen siendo manuales. Resultado: la mitad de las horas sin IA.

| Tipo de petición | Issues integrados                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Horas sin IA por issue |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Cambio de texto  | [demo #8](https://github.com/rubenbp/appfoundry-site-demo/issues/8)                                                                                                                                                                                                                                                                                                                                                                                                                     | 0,5 – 1                |
| Ficha nueva      | [demo #11](https://github.com/rubenbp/appfoundry-site-demo/issues/11), [#13](https://github.com/rubenbp/appfoundry-site-demo/issues/13) y [#16](https://github.com/rubenbp/appfoundry-site-demo/issues/16); [demo2 #2](https://github.com/rubenbp/appfoundry-site-demo2/issues/2)                                                                                                                                                                                                       | 2 – 3                  |
| Funcionalidad    | [demo #15](https://github.com/rubenbp/appfoundry-site-demo/issues/15), [#19](https://github.com/rubenbp/appfoundry-site-demo/issues/19), [#21](https://github.com/rubenbp/appfoundry-site-demo/issues/21), [#23](https://github.com/rubenbp/appfoundry-site-demo/issues/23) y [#27](https://github.com/rubenbp/appfoundry-site-demo/issues/27); [demo2 #4](https://github.com/rubenbp/appfoundry-site-demo2/issues/4) y [#6](https://github.com/rubenbp/appfoundry-site-demo2/issues/6) | 4 – 8                  |
| **Total**        | **12 issues**                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **36,5 – 69 h**        |

- **Tiempo humano con la Factory:** de 10 a 20 minutos por petición para escribir el issue, revisar la preview y, si hace falta, corregir. No lo medí; la espera medida en los 12 issues, 7,1 h, es su límite superior.
- **Revisión técnica con la Factory:** de 15 a 30 minutos por petición para que un desarrollador lea el diff de la PR antes del merge. No la medí.
- **Coste del modelo:** una suscripción de ChatGPT Plus de 23 €/mes, conectada por OAuth. Imputo la suscripción entera a las Ejecuciones. Sin factura por Ejecución, el coste en USD de los tokens es un equivalente calculado con las tarifas configuradas, y no lo sumo.
- **Herramientas:** GitHub y Vercel, en sus planes gratuitos. Cursor, en el plan Super de 100 USD/mes, solo lo usé para construir la Factory (apartado 5.3); en el día a día, cualquier desarrollador tiene ya su IDE, con o sin Factory, así que no lo imputo por petición.

## 5.2 Coste de las 12 peticiones

| Concepto                        | Sin IA              | Con IA en el IDE  | Con la Factory                         | Tipo de dato         |
| ------------------------------- | ------------------- | ----------------- | -------------------------------------- | -------------------- |
| Horas de desarrollo             | 36,5 – 69 h         | 18,3 – 34,5 h     | 0 h                                    | Estimado / medido    |
| Revisión técnica del código     | Incluida arriba     | Incluida arriba   | 3 – 6 h                                | Estimado             |
| Horas de la persona que decide  | Incluidas arriba    | Incluidas arriba  | 2 – 4 h (máximo 7,1 h)                 | Estimado / calculado |
| Coste del modelo                | 0 €                 | 23 €              | 23 € (2,25 USD equivalentes en tokens) | Medido / calculado   |
| **Coste total**                 | **1.278 – 2.415 €** | **662 – 1.231 €** | **198 – 373 € (máximo 482 €)**         | Estimado             |
| **Coste por petición**          | **106 – 201 €**     | **55 – 103 €**    | **16,5 – 31 € (máximo 40 €)**          | Estimado             |
| Tiempo hasta la primera preview | Horas o días        | Horas o días      | Minutos                                | Estimado / medido    |

Frente al trabajo sin IA, el ahorro va de unos **66 €** por petición en el caso más pesimista a unos **185 €** en el más favorable. Frente a un desarrollador con IA en el IDE, va de unos **15 €** a unos **86 €**. El [issue #4](https://github.com/rubenbp/appfoundry-site-demo2/issues/4) lo ilustra: un comparador con su corrección, listo en 13,8 minutos por 0,31 USD de tokens.

![Figura 13. Tokens y coste estimado de la Ejecución del issue #4 en el Dashboard. Permite comprobar el origen de las cifras de este apartado](img/fig-13-consumo.png)

## 5.3 Coste de construir la Factory

- **Construcción:** unas 33 h entre el 12 y el 22 de octubre. A 35 €/h son 1.155 €, más 23 € de ChatGPT Plus y 100 € de Cursor, que redondeo por lo alto desde 100 USD: **unos 1.280 €**.
- **Punto de equilibrio:** con el ahorro por petición, la Factory se amortiza **entre la petición 7 y la 20** frente al trabajo sin IA, y entre la 15 y la 86 frente al IDE. Las 12 integradas solo bastan en el caso favorable sin IA; frente al IDE, el valor depende del volumen de peticiones.
- **Suscripción:** me bastó Plus porque este mes OpenAI restableció el límite de uso cada 2 o 3 días. Con Pro (103 €/mes), la construcción costaría unos 1.360 € y cada petición unos 7 € más; frente al trabajo sin IA, se amortizaría entre la petición 8 y la 23.

## 5.4 Lectura honesta

- **La muestra es pequeña:** 14 Ejecuciones en un banco de pruebas sin backend muestran un orden de magnitud, no un ahorro general.
- **El banco de pruebas es pequeño y simple:** en un proyecto real, cada petición costaría más sin IA, porque entender el código, preparar el entorno y verificar llevan más tiempo, y ese trabajo repetitivo es justo el que automatiza la Factory. Pero también podrían bajar los aciertos del agente y crecer la revisión y el contexto. No he medido qué efecto pesa más; es lo que respondería probarla en un proyecto real (apartado 6.5).
- **El ahorro está en las horas, no en los tokens:** la petición más cara costó 0,31 USD, menos que un minuto de un desarrollador.
- **Operar no es gratis:** las incidencias de la tanda 1 necesitaron a alguien que entendiera la Factory, y no medí ese tiempo. La revisión técnica, que sí incluyo, reduce el ahorro, pero no lo elimina.
- **La comparación con el IDE es la más débil:** el 50 % es un supuesto, no una medición, y en el caso pesimista el ahorro es pequeño.
- **Es el coste de un prototipo:** llevar la Factory a producción, con aislamiento real y concurrencia, costaría bastante más.
