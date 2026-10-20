import type { Run } from "../src/domain/run.ts";
import { validPreview } from "../src/domain/publication.ts";

export const deploymentLabels = {
  pending: "Deployment pendiente",
  success: "Deployment correcto",
  failure: "Deployment fallido",
  error: "Error de deployment",
  inactive: "Deployment inactivo; no acredita un fallo de build",
};

/** Only admitted HTTPS origins become links, including last observed deployments. */
function previewLink(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);

    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.origin === value
      ? value
      : null;
  } catch {
    return null;
  }
}

/** Read-only presentation of the retained publication; domain rules remain authoritative. */
export function publicationState(run: Run) {
  const publication = run.publication;
  if (!publication) {
    return null;
  }
  const { preview, acceptance } = publication;
  const request = run.request;
  const configuration = request?.configuration.publication;
  const url = previewLink(preview?.url);
  const available = Boolean(
    request &&
    configuration &&
    request.repository === request.configuration.repository &&
    url &&
    validPreview(
      preview,
      publication.head,
      request.repository,
      configuration.projectId,
      configuration.previewEnvironment ?? "Preview",
    ),
  );
  const versionMismatch = Boolean(
    preview &&
    (preview.head !== publication.head ||
      (preview.servedHead !== null && preview.servedHead !== publication.head)),
  );
  const identityMismatch = Boolean(
    preview &&
    request &&
    configuration &&
    (preview.repository !== request.repository ||
      preview.projectId !== configuration.projectId ||
      preview.environment !== (configuration.previewEnvironment ?? "Preview")),
  );
  const previewLabel = available
    ? "Disponible"
    : !preview
      ? "Pendiente"
      : preview.state !== "success"
        ? deploymentLabels[preview.state]
        : versionMismatch
          ? "Otra versión"
          : identityMismatch
            ? "Identidad no acreditada"
            : preview.access === "protected"
              ? "Acceso protegido"
              : "Comprobación pendiente";
  const previewContext = available
    ? "Versión vigente y acceso comprobados."
    : !preview
      ? "Esperando la preview del Commit candidato."
      : versionMismatch
        ? "La preview observada no corresponde al Commit candidato vigente."
        : identityMismatch
          ? "El repositorio, proyecto o entorno observado no corresponde a la configuración capturada."
          : preview.access === "protected"
            ? "Falta acceso autorizado para comprobar la preview."
            : preview.access === "pending"
              ? "Acceso pendiente de comprobar."
              : !url
                ? "Sin URL HTTPS admitida para la preview."
                : "La preview aún no acredita la versión vigente.";
  const accepted = acceptance?.head === publication.head;

  return {
    available,
    previewLabel,
    previewContext,
    url,
    versionMismatch,
    identityMismatch,
    accepted,
    acceptanceLabel: accepted
      ? "Aceptación vigente"
      : acceptance
        ? "Aceptación anterior"
        : "Sin aceptación registrada",
  };
}
