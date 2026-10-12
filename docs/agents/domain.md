# Domain docs

Este repositorio usa un layout single-context: `GLOSSARY.md` en la raíz y ADRs en `docs/adr/`.

Todas las rutas de este documento son relativas a la raíz del repositorio, `app-foundry/`.

## Antes de explorar el codebase

- Lee el `GLOSSARY.md` de la raíz si existe.
- Lee los ADRs de `docs/adr/` relacionados con el área en la que vas a trabajar.

Si estos archivos no existen, continúa sin señalar su ausencia ni proponer su creación por adelantado. Usa `/domain-modeling` para crearlos cuando se concreten términos o decisiones.

## Estructura de archivos

```text
app-foundry/
├── GLOSSARY.md
└── docs/
    └── adr/
        └── 0001-<decision-slug>.md
```

## Usa el vocabulario del glossary

Cuando nombres un concepto de dominio en un título de issue, una propuesta de refactor, una hipótesis o un nombre de test, usa el término definido en `GLOSSARY.md`. Respeta las distinciones entre términos que establezca el glossary.

Si falta un concepto, comprueba primero si un término existente lo cubre. Registra las carencias reales de vocabulario para `/domain-modeling`.

## Señala conflictos con ADRs

Si una propuesta contradice un ADR existente, identifica el ADR y explica por qué conviene reconsiderar la decisión.
