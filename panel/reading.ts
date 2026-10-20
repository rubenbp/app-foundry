import type { TimelineEntry } from "./timeline.ts";

type Reading = { following: boolean; pending: number };
type Anchor = { id: string; offset: number };

/** Owns the viewport's reading position; layout changes never express user intent. */
export function timelineReading(
  viewport: HTMLElement,
  content: HTMLElement,
  report: (reading: Reading) => void,
) {
  let following = true;
  let observed = new Map<string, string>();
  let visible = new Set<string>();
  const pending = new Set<string>();
  let anchors: Anchor[] = [];
  let previousTop = viewport.scrollTop;
  let programmaticTop: number | null = null;
  let intentUntil = 0;
  let touchY: number | null = null;
  let reported = "";

  function reportReading() {
    const count = [...pending].filter((id) => visible.has(id)).length;
    const signature = `${following}:${count}`;
    if (signature !== reported) {
      reported = signature;
      report({ following, pending: count });
    }
  }

  function rows() {
    return [...content.querySelectorAll<HTMLElement>("[data-entry-id]")];
  }

  function recordAnchor() {
    const top = viewport.getBoundingClientRect().top;
    const positions = rows().map((row) => ({
      id: row.dataset.entryId!,
      offset: row.getBoundingClientRect().top - top,
      bottom: row.getBoundingClientRect().bottom - top,
    }));
    // Prefer a visible common entry when a filter or compaction removes the first.
    anchors = [
      ...positions.filter((row) => row.bottom > 0),
      ...positions.filter((row) => row.bottom <= 0).reverse(),
    ];
    previousTop = viewport.scrollTop;
  }

  function position(top: number) {
    viewport.scrollTop = top;
    programmaticTop = viewport.scrollTop;
    previousTop = viewport.scrollTop;
  }

  function preserve() {
    if (following) {
      content.style.minHeight = "";
      position(viewport.scrollHeight);
    } else {
      const available = new Map(
        rows().map((row) => [row.dataset.entryId, row]),
      );
      const anchor = anchors.find((entry) => available.has(entry.id));
      if (anchor) {
        const row = available.get(anchor.id)!;
        const target =
          viewport.scrollTop +
          row.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          anchor.offset;
        // A reordered anchor can become the final short row. Reserve enough
        // trailing space to retain its offset instead of clamping to the end.
        content.style.minHeight = `${Math.max(0, target + viewport.clientHeight)}px`;
        position(target);
      } else {
        position(previousTop);
      }
    }
    recordAnchor();
  }

  function pause() {
    if (following) {
      following = false;
      pending.clear();
    }
    recordAnchor();
    reportReading();
  }

  function resume() {
    following = true;
    pending.clear();
    intentUntil = 0;
    preserve();
    reportReading();
  }

  function userIntent() {
    intentUntil = performance.now() + 1500;
    programmaticTop = null;
  }

  function scroll() {
    const top = viewport.scrollTop;
    if (programmaticTop !== null && Math.abs(top - programmaticTop) < 1) {
      programmaticTop = null;
      return;
    }
    if (performance.now() <= intentUntil) {
      intentUntil = performance.now() + 1500;
      const atEnd = viewport.scrollHeight - viewport.clientHeight - top <= 24;
      if (atEnd && top > previousTop) {
        resume();
      } else if (top < previousTop) {
        pause();
      }
    }
    recordAnchor();
  }

  function wheel(event: WheelEvent) {
    userIntent();
    if (event.deltaY < 0) {
      pause();
    }
  }

  function key(event: KeyboardEvent) {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("input, textarea, select, button, summary, a, pre")
    ) {
      return;
    }
    if (
      [
        "ArrowUp",
        "PageUp",
        "Home",
        "ArrowDown",
        "PageDown",
        "End",
        " ",
      ].includes(event.key)
    ) {
      userIntent();
      if (
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.key === " " && event.shiftKey)
      ) {
        pause();
      }
    }
  }

  function pointer(event: PointerEvent) {
    const bounds = viewport.getBoundingClientRect();
    // Only the scrollbar expresses scroll intent; clicking a row does not pause.
    if (event.clientX >= bounds.left + viewport.clientWidth) {
      userIntent();
    }
  }

  function touchStart(event: TouchEvent) {
    touchY = event.touches[0]?.clientY ?? null;
  }

  function touchMove(event: TouchEvent) {
    const next = event.touches[0]?.clientY;
    if (next === undefined || touchY === null) {
      return;
    }
    userIntent();
    if (next > touchY) {
      pause();
    }
    touchY = next;
  }

  function inspect() {
    intentUntil = 0;
    pause();
  }

  const passive = { passive: true };
  viewport.addEventListener("scroll", scroll, passive);
  viewport.addEventListener("wheel", wheel, passive);
  viewport.addEventListener("keydown", key);
  viewport.addEventListener("pointerdown", pointer);
  viewport.addEventListener("touchstart", touchStart, passive);
  viewport.addEventListener("touchmove", touchMove, passive);
  document.addEventListener("cabina:inspect", inspect);
  const resize = new ResizeObserver(preserve);
  resize.observe(viewport);
  resize.observe(content);

  return {
    observe(entries: TimelineEntry[], displayed: TimelineEntry[]) {
      visible = new Set(displayed.map((entry) => entry.id));
      for (const entry of entries) {
        if (
          !following &&
          observed.get(entry.id) !== entry.version &&
          visible.has(entry.id)
        ) {
          pending.add(entry.id);
        }
      }
      observed = new Map(entries.map((entry) => [entry.id, entry.version]));
      preserve();
      reportReading();
    },
    resume,
    locate(element: HTMLElement) {
      inspect();
      position(
        viewport.scrollTop +
          element.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          24,
      );
      recordAnchor();
    },
    beginning() {
      pause();
      intentUntil = 0;
      position(0);
      recordAnchor();
    },
    close() {
      resize.disconnect();
      viewport.removeEventListener("scroll", scroll);
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("keydown", key);
      viewport.removeEventListener("pointerdown", pointer);
      viewport.removeEventListener("touchstart", touchStart);
      viewport.removeEventListener("touchmove", touchMove);
      document.removeEventListener("cabina:inspect", inspect);
    },
  };
}
