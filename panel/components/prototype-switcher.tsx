import { useEffect, useState, type ReactNode } from "react";

export const prototypeVariants = [
  { key: "A", name: "Cabina", description: "Fases arriba · contexto lateral" },
  {
    key: "B",
    name: "Bitácora",
    description: "Fases laterales · lectura densa",
  },
  { key: "C", name: "Foco", description: "Flujo amplio · resumen inferior" },
] as const;

export type PrototypeVariant = (typeof prototypeVariants)[number]["key"];

export function PrototypeSwitcher({
  variant,
  onChange,
  state,
}: {
  variant: PrototypeVariant;
  onChange: (variant: PrototypeVariant) => void;
  state: ReactNode;
}) {
  const [showState, setShowState] = useState(false);
  const current = prototypeVariants.findIndex((item) => item.key === variant);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable]")
      ) {
        return;
      }
      if (event.altKey || event.metaKey || event.ctrlKey) {
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const offset = event.key === "ArrowRight" ? 1 : -1;
        onChange(prototypeVariants[(current + offset + 3) % 3].key);
      }
    }
    window.addEventListener("keydown", handleKey);

    return () => window.removeEventListener("keydown", handleKey);
  }, [current, onChange]);

  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <div className="prototype-switcher">
      {showState ? (
        <div className="prototype-state">
          <strong>Estado del prototipo</strong>
          {state}
        </div>
      ) : null}
      <span className="prototype-mark">PROTOTIPO</span>
      <button
        aria-label="Variante anterior"
        onClick={() => onChange(prototypeVariants[(current + 2) % 3].key)}
      >
        ←
      </button>
      <span className="prototype-label">
        <strong>
          {variant} · {prototypeVariants[current].name}
        </strong>
        <small>{prototypeVariants[current].description}</small>
      </span>
      <button
        aria-label="Variante siguiente"
        onClick={() => onChange(prototypeVariants[(current + 1) % 3].key)}
      >
        →
      </button>
      <button
        className="prototype-state-toggle"
        aria-expanded={showState}
        onClick={() => setShowState(!showState)}
      >
        {showState ? "Cerrar estado" : "Estado"}
      </button>
    </div>
  );
}
