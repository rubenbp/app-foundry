# 4. Del merge al cierre

[Índice](README.md) · [Anterior](03-verificacion-y-aceptacion.md) · [Siguiente: variantes e intervención](05-variantes-e-intervencion.md)

## El merge lo hace una persona

`Factory / ready-to-merge: success` indica que la Factory acredita una aceptación vigente para el Commit candidato. No ejecuta el merge. La persona integra en GitHub respetando los demás controles del repositorio.

La Factory observa el merge y conserva por separado base, Commit candidato aceptado y commit integrado. Un squash puede generar otro SHA; producción debe corresponder al integrado.

```mermaid
flowchart TD
    M["GitHub informa de PR integrada"] --> A{"¿Candidato aceptado antes del merge<br/>y aceptación e informe acreditados?"}
    A -->|"No"| X["Incidencia de integración<br/>Intervención y sin completar"]
    A -->|"Sí"| G{"¿Rama destino correcta, permisos válidos<br/>y control favorable anterior al merge?"}
    G -->|"No"| X
    G -->|"Sí"| C["Conservar aceptación de integración<br/>y SHA integrado"]
    C --> P["Esperar deployment de producción"]
```

Se comprueba también que no haya instrucciones de revocación autorizadas anteriores al merge. Un merge externo sin estas garantías es una incidencia, aunque GitHub lo permita o el issue ya esté cerrado.

La observación puede coincidir con el merge. La Factory usa el historial del informe, la aceptación y el control de GitHub para reconstruir qué estaba aceptado al integrar; no exige que una preview retirada después del merge siga activa para siempre.

## Secuencia hasta completar

```mermaid
sequenceDiagram
    actor H as Persona
    participant G as GitHub
    participant V as Vercel
    participant F as Factory
    participant P as Dominio público
    H->>G: Hacer merge del Commit candidato aceptado
    G->>V: La integración Git activa producción
    F->>G: Observar merge, versión integrada y control histórico
    F->>G: Buscar deployment del commit integrado
    F->>V: Verificar identidad y destino production
    alt Deployment pendiente o inactive
        F->>F: Seguir esperando producción
    else Deployment correcto
        F->>P: Abrir navegador nuevo sin credenciales
        F->>P: Leer marcador de versión
        F->>P: Comprobar texto y enlaces de cada criterio
        F->>P: Releer marcador de versión
        F->>F: Guardar resultados y capturas
        F->>G: Publicar evidencia de producción en el issue
        F->>G: Cerrar issue tras comprobar evidencia publicada
        F->>F: Marcar completed y liberar puesto
    else Fallo o identidad incorrecta
        F->>F: Conservar evidencia y exigir intervención
    end
```

La Factory acredita el deployment GitHub del commit integrado, repositorio y entorno configurados. Después contrasta con Vercel el proyecto y `target: production`. No basta con encontrar cualquier deployment verde o una marca genérica de entorno de producción.

## Qué se comprueba en el sitio público

La navegación usa una sesión nueva, online y sin credenciales. Solo admite lecturas GET/HEAD al origen de producción configurado. Una preview accesible mediante credenciales no sustituye esta comprobación pública.

El plan `factory-production` declara entre 1 y 30 comprobaciones. Cada una vincula un criterio numerado desde 1 con una ruta local del sitio, un selector y texto exacto o un enlace interno. `follow: true` exige además navegar por el enlace. Debe haber al menos una comprobación por criterio.

Para una comprobación de texto, el elemento debe ser único y visible; se normalizan espacios al comparar. Para un enlace se comprueba el `href` declarado y, si se pide seguirlo, que la navegación al destino responda correctamente. Las rutas del plan no admiten URLs externas ni parámetros de consulta.

```mermaid
flowchart TD
    D["Deployment observado"] --> E{"¿Estado del deployment?"}
    E -->|"No observado, pending o inactive"| W["Esperar nueva observación"]
    E -->|"failure o error"| X["Intervención"]
    E -->|"success"| I{"¿Identidad coincide con commit integrado,<br/>repositorio, proyecto y entorno?"}
    I -->|"No"| X
    I -->|"Sí"| C{"¿Plan público válido<br/>y cobertura de todos los criterios?"}
    C -->|"No"| X
    C -->|"Sí"| M{"¿Dominio público sirve el SHA integrado<br/>antes y después de comprobar?"}
    M -->|"No"| X
    M -->|"Sí"| B{"¿Pasan todas las comprobaciones<br/>y se conserva evidencia completa?"}
    B -->|"No"| X
    B -->|"Sí"| R["Publicar informe en issue"]
    R --> J{"¿Informe confirmado y petición intacta?"}
    J -->|"No"| X
    J -->|"Sí"| F["Cerrar issue y completar Ejecución"]
```

El marcador se lee antes y después para detectar que el dominio haya cambiado de versión durante la revisión. Se rechaza una versión diferente, un build sucio, una redirección o un acceso que no sea público.

Las comprobaciones actuales cubren contenido visible y navegación interna declarados. Una interacción que requiera enviar formularios, autenticar usuarios o validar un comportamiento que el plan no expresa necesita ampliar la verificación antes de acreditar producción. Añadir una comprobación superficial no demuestra ese criterio.

## Qué significa «completado»

La Ejecución termina como `completed` cuando la producción pedida queda acreditada, la evidencia se conserva y el informe está publicado en el issue antes del cierre. Entonces se libera el puesto.

Un cierre manual del issue no prueba producción ni cancela por sí solo la Ejecución. La Factory mantiene la obligación de verificar; si el issue ya estaba cerrado, solo puede completar después de reunir las mismas evidencias.

Si producción falla, se conserva la evidencia obtenida y la Ejecución queda en intervención. No hay rollback, promoción alternativa ni reparación automática. Después del merge, una intervención de producción no se resuelve repitiendo comprobaciones en cada consulta.
