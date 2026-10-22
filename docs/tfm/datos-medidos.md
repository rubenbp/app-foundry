# Datos medidos de las Ejecuciones

Generado el 2026-10-22 con `scripts/tfmMetrics.ts` a partir de las bases SQLite de la Factory. No editar a mano: volver a generar.

## Cómo leer las cifras

- **Medido**: tokens por mensaje (protocolo de OpenCode), intentos, estado, hitos con fecha y resultado de las comprobaciones.
- **Calculado**: duración de cada fase, aproximada como la distancia entre hitos del historial (`process-started` → `result` para el agente, `preview-ready` → orden o merge para la revisión humana, etc.).
- **Calculado con tarifa configurada**: el coste en USD multiplica tokens por la tarifa de `tokenPrices`. Con OAuth, OpenCode informa coste 0; el importe mostrado es un equivalente en API, no un cargo facturado.
- **Espera humana** es tiempo de reloj hasta la siguiente decisión (responder, corregir o hacer merge). Es un límite superior del tiempo humano activo, que no se mide.
- **Otros** agrupa errores, reinicios de la Factory, recuperaciones y esperas no atribuibles a otra fase.

## Tanda `sample` (10 Ejecuciones)

| #   | Issue                                                                                                                     | Estado    | Intentos | Modelo     | Agente (min) | Verificación (min) | Preview (min) | Espera humana (min) | Otros (min) | Total (min) | Tokens entrada | Tokens salida | Tokens caché | Coste USD | Tarifa             | Comprobaciones |
| --- | ------------------------------------------------------------------------------------------------------------------------- | --------- | -------- | ---------- | ------------ | ------------------ | ------------- | ------------------- | ----------- | ----------- | -------------- | ------------- | ------------ | --------- | ------------------ | -------------- |
| 1   | [Cambiar el título del pie de las páginas](https://github.com/rubenbp/appfoundry-site-demo/issues/8) (#8)                 | completed | 1        | gpt-6-luna | 1.7          | 0.5                | 0.0           | 5.5                 | 1.1         | 8.9         | 32.1 k         | 0.7 k         | 137.0 k      | 0.005     | Config. del modelo | 5/5            |
| 2   | [Añade nuevo juego: Suikoden](https://github.com/rubenbp/appfoundry-site-demo/issues/11) (#11)                            | completed | 3        | gpt-6-sol  | 4.9          | 1.3                | 0.0           | 46.5                | 1.3         | 54.1        | 81.5 k         | 6.5 k         | 434.2 k      | 0.272     | Config. del modelo | 5/5            |
| 3   | [Añade el juego Super Mario Bros](https://github.com/rubenbp/appfoundry-site-demo/issues/13) (#13)                        | completed | 2        | gpt-6-sol  | 3.4          | 0.8                | 1.4           | 86.7                | 1.0         | 93.5        | 58.6 k         | 5.6 k         | 297.6 k      | 0.203     | Config. del modelo | 5/5            |
| 4   | [hola](https://github.com/rubenbp/appfoundry-site-demo/issues/15) (#15)                                                   | completed | 2        | gpt-6-sol  | 4.2          | 0.8                | 1.4           | 33.8                | 35.2        | 75.6        | 72.4 k         | 6.5 k         | 815.2 k      | 0.291     | Config. del modelo | 5/5            |
| 5   | [Wipeout](https://github.com/rubenbp/appfoundry-site-demo/issues/16) (#16)                                                | completed | 2        | gpt-6-sol  | 3.6          | 0.5                | 0.7           | 2.4                 | 611.3       | 618.5       | 91.9 k         | 6.0 k         | 226.8 k      | 0.266     | Config. del modelo | 5/5            |
| 6   | [Modo comparador de juegos](https://github.com/rubenbp/appfoundry-site-demo/issues/19) (#19)                              | completed | 1        | gpt-6-sol  | 3.3          | 0.4                | 1.9           | 19.6                | 54.9        | 80.2        | 63.5 k         | 6.4 k         | 357.5 k      | 0.226     | Config. del modelo | 5/5            |
| 7   | [comparador con juegos como parametros del query string](https://github.com/rubenbp/appfoundry-site-demo/issues/21) (#21) | completed | 1        | gpt-6-sol  | 4.3          | 0.5                | 14.6          | 188.1               | 0.9         | 208.4       | 51.4 k         | 6.2 k         | 379.5 k      | 0.203     | Ejecución          | 5/5            |
| 8   | [Juego diferente en portada cada X segundos](https://github.com/rubenbp/appfoundry-site-demo/issues/23) (#23)             | completed | 2        | gpt-6-luna | 2.8          | 0.9                | 1.5           | 6.7                 | 5.9         | 17.9        | 77.1 k         | 2.5 k         | 347.3 k      | 0.012     | Ejecución          | 5/5            |
| 9   | [Filtro por compañía en el catálogo](https://github.com/rubenbp/appfoundry-site-demo/issues/25) (#25)                     | stopped   | 2        | gpt-6-luna | 5.3          | 1.0                | 1.5           | 26.1                | 2.2         | 36.2        | 187.6 k        | 4.7 k         | 1658.4 k     | 0.038     | Ejecución          | 5/5            |
| 10  | [Mejora del hero](https://github.com/rubenbp/appfoundry-site-demo/issues/27) (#27)                                        | completed | 2        | gpt-6-luna | 2.7          | 0.8                | 1.4           | 3.6                 | 1.1         | 9.8         | 70.4 k         | 2.7 k         | 465.2 k      | 0.013     | Ejecución          | 5/5            |

Incidencias registradas por Ejecución:

| #   | Issue                                                  | Preguntas del agente | Intentos adicionales (corrección o reintento) | Errores de agente/publicación | Reinicios de la Factory | Recuperaciones |
| --- | ------------------------------------------------------ | -------------------- | --------------------------------------------- | ----------------------------- | ----------------------- | -------------- |
| 1   | Cambiar el título del pie de las páginas               | 0                    | 0                                             | 0                             | 0                       | 0              |
| 2   | Añade nuevo juego: Suikoden                            | 0                    | 2                                             | 2                             | 0                       | 1              |
| 3   | Añade el juego Super Mario Bros                        | 0                    | 1                                             | 0                             | 0                       | 0              |
| 4   | hola                                                   | 2                    | 1                                             | 57                            | 0                       | 3              |
| 5   | Wipeout                                                | 0                    | 1                                             | 13                            | 0                       | 2              |
| 6   | Modo comparador de juegos                              | 0                    | 0                                             | 4                             | 3                       | 3              |
| 7   | comparador con juegos como parametros del query string | 0                    | 0                                             | 0                             | 0                       | 0              |
| 8   | Juego diferente en portada cada X segundos             | 0                    | 1                                             | 1                             | 0                       | 0              |
| 9   | Filtro por compañía en el catálogo                     | 0                    | 1                                             | 1                             | 2                       | 2              |
| 10  | Mejora del hero                                        | 0                    | 1                                             | 0                             | 1                       | 0              |

## Tanda `sample2` (4 Ejecuciones)

| #   | Issue                                                                                             | Estado    | Intentos | Modelo           | Agente (min) | Verificación (min) | Preview (min) | Espera humana (min) | Otros (min) | Total (min) | Tokens entrada | Tokens salida | Tokens caché | Coste USD | Tarifa    | Comprobaciones |
| --- | ------------------------------------------------------------------------------------------------- | --------- | -------- | ---------------- | ------------ | ------------------ | ------------- | ------------------- | ----------- | ----------- | -------------- | ------------- | ------------ | --------- | --------- | -------------- |
| 1   | [Añade el juego Super Mario Bros](https://github.com/rubenbp/appfoundry-site-demo2/issues/1) (#1) | stopped   | 2        | gemini-3.8-flash | 18.1         | 0.0                | 0.0           | 0.0                 | 573.7       | 591.8       | 243.9 k        | 3.9 k         | 725.4 k      | 0.252     | Ejecución | 0/0            |
| 2   | [Añade el juego Super Mario Bros](https://github.com/rubenbp/appfoundry-site-demo2/issues/2) (#2) | completed | 2        | gpt-6-sol        | 4.2          | 0.9                | 18.1          | 9.4                 | 60.3        | 93.0        | 48.1 k         | 5.1 k         | 390.9 k      | 0.186     | Ejecución | 5/5            |
| 3   | [Modo comparador de juegos](https://github.com/rubenbp/appfoundry-site-demo2/issues/4) (#4)       | completed | 2        | gpt-6-sol        | 5.8          | 0.9                | 1.5           | 4.4                 | 1.1         | 13.8        | 62.9 k         | 10.1 k        | 825.5 k      | 0.309     | Ejecución | 5/5            |
| 4   | [Algo nuevo](https://github.com/rubenbp/appfoundry-site-demo2/issues/6) (#6)                      | completed | 1        | gpt-6-sol        | 5.1          | 0.4                | 0.7           | 19.2                | 0.9         | 26.6        | 59.6 k         | 8.1 k         | 601.7 k      | 0.260     | Ejecución | 5/5            |

Incidencias registradas por Ejecución:

| #   | Issue                           | Preguntas del agente | Intentos adicionales (corrección o reintento) | Errores de agente/publicación | Reinicios de la Factory | Recuperaciones |
| --- | ------------------------------- | -------------------- | --------------------------------------------- | ----------------------------- | ----------------------- | -------------- |
| 1   | Añade el juego Super Mario Bros | 0                    | 1                                             | 72                            | 5                       | 4              |
| 2   | Añade el juego Super Mario Bros | 0                    | 1                                             | 2                             | 2                       | 2              |
| 3   | Modo comparador de juegos       | 0                    | 1                                             | 0                             | 0                       | 0              |
| 4   | Algo nuevo                      | 2                    | 0                                             | 0                             | 0                       | 0              |

## Totales

- Ejecuciones: 14 (12 completadas).
- Tiempo de agente acumulado: 69.5 min; media 5.0 min por Ejecución.
- Espera humana acumulada (límite superior): 451.9 min.
- Tokens totales: 8937.9 k. Coste equivalente en API: 2.537 USD; media 0.181 USD por Ejecución.
