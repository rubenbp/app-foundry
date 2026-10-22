const storageKey = "app-foundry:show-technical-records:v1";

/** Defaults to visible when the preference is missing, invalid or unreadable. */
export function readTechnicalRecordsVisibility(): boolean {
  try {
    return window.localStorage.getItem(storageKey) !== "false";
  } catch (error) {
    console.warn(
      "No se pudo leer la preferencia de registros técnicos; se mostrarán por defecto.",
      error,
    );

    return true;
  }
}

/** A failed write leaves the in-memory selection usable for this page. */
export function saveTechnicalRecordsVisibility(showTechnical: boolean): void {
  try {
    window.localStorage.setItem(storageKey, String(showTechnical));
  } catch (error) {
    console.warn(
      "No se pudo guardar la preferencia de registros técnicos; la selección se conserva hasta recargar.",
      error,
    );
  }
}
