import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { FactoryView } from "../src/application/factoryView.ts";
import { Dashboard } from "./dashboard/dashboard.tsx";
import { poll } from "./polling.ts";
import {
  readTechnicalRecordsVisibility,
  saveTechnicalRecordsVisibility,
} from "./technicalRecordsPreference.ts";
import "./style.css";
import "./dashboard/dashboard.css";

function App() {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<FactoryView | null>(null);
  const [lastLocal, setLastLocal] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [failing, setFailing] = useState(false);
  const [showTechnical, setShowTechnical] = useState(
    readTechnicalRecordsVisibility,
  );

  function toggleTechnicalRecords() {
    const visible = !showTechnical;
    setShowTechnical(visible);
    saveTechnicalRecordsVisibility(visible);
  }

  useEffect(
    () =>
      poll<FactoryView>(
        () =>
          `/api/view${selected !== null ? `?run=${encodeURIComponent(selected)}` : ""}`,
        (data) => {
          setView(data);
          setLastLocal(Date.now());
          setFailing(false);
        },
        () => setFailing(true),
      ),
    [selected],
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <Dashboard
      key={selected ?? "automatic"}
      view={view}
      showTechnical={showTechnical}
      onToggleTechnical={toggleTechnicalRecords}
      onSelect={setSelected}
      onDeleted={(id) => {
        setSelected("");
        setView((current) =>
          current
            ? {
                ...current,
                runs: current.runs.filter((run) => run.id !== id),
                run: null,
                consumption: null,
              }
            : current,
        );
      }}
      failing={failing}
      lastLocal={lastLocal}
      now={now}
    />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
