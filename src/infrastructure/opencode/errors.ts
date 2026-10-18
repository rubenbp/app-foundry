export function errorText(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error);
  }
  const value = error as {
    name?: string;
    _tag?: string;
    message?: string;
    data?: { message?: string };
  };

  return `${value.name ?? value._tag ?? "Error de OpenCode"}: ${value.message ?? value.data?.message ?? "No hay un mensaje de error disponible"}`;
}

// El SDK de red es independiente del host integrado de OpenCode y sigue siendo compatible con Node 24.
