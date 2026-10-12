# Triage labels

Las skills usan cinco roles canónicos de triage. Esta tabla los relaciona con las etiquetas de GitHub Issues de `rubenbp/app-foundry`.

| Rol canónico | Etiqueta en GitHub | Significado |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | El maintainer debe evaluar el issue. |
| `needs-info` | `needs-info` | Falta información del reporter. |
| `ready-for-agent` | `ready-for-agent` | El issue está completamente especificado y listo para un agent autónomo. |
| `ready-for-human` | `ready-for-human` | La implementación requiere intervención humana. |
| `wontfix` | `wontfix` | El issue no se llevará a cabo. |

Cuando una skill mencione un rol de triage, aplica la etiqueta correspondiente de esta tabla con `gh issue edit <number> --repo rubenbp/app-foundry --add-label "<label>"`. Retira la etiqueta del rol anterior cuando cambie el estado de triage.

Para cambiar el vocabulario, edita la columna «Etiqueta en GitHub».
