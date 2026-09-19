import { formatDate, formatDisplayDate, parseDisplayDate, shiftDate } from "./settings.js";

export function calendarDays(year, month) {
  const first = new Date(year, month, 1, 12);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => formatDate(new Date(year, month, 1 - offset + index, 12)));
}

// A local calendar also works in embedded browsers that do not expose a native date picker.
export function setupDatePickers() {
  const dialog = document.createElement("dialog");
  dialog.className = "calendar-dialog";
  dialog.setAttribute("aria-labelledby", "calendar-title");
  dialog.innerHTML = `<header class="calendar-head"><h2 id="calendar-title">Choose date</h2><button type="button" data-calendar-close aria-label="Close calendar">×</button></header>
    <div class="calendar-navigation"><button type="button" data-month-back aria-label="Previous month">‹</button><select aria-label="Month"></select><input type="number" aria-label="Year" min="1900" max="9999"><button type="button" data-month-next aria-label="Next month">›</button></div>
    <p class="sr-only" data-calendar-month aria-live="polite"></p><div class="calendar-weekdays" aria-hidden="true"><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div>
    <div class="calendar-days" role="group" aria-label="Days. Use arrow keys to navigate; Enter to select."></div><footer><button type="button" data-calendar-today>Today</button><small>Arrow keys move by day; Page Up/Down changes month.</small></footer>`;
  document.body.append(dialog);
  const monthSelect = dialog.querySelector("select");
  const yearInput = dialog.querySelector("input");
  const grid = dialog.querySelector(".calendar-days");
  let today = formatDate(new Date());
  let active = today;
  let selected = null;
  let input;
  let trigger;
  for (let month = 0; month < 12; month++) {
    const option = document.createElement("option");
    option.value = String(month);
    option.textContent = new Date(2024, month, 1).toLocaleDateString("en-GB", { month: "long" });
    monthSelect.append(option);
  }
  const render = (focusDay = false) => {
    const date = new Date(`${active}T12:00:00`);
    const year = date.getFullYear();
    const month = date.getMonth();
    monthSelect.value = String(month);
    yearInput.value = String(year);
    dialog.querySelector("[data-calendar-month]").textContent = date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    grid.replaceChildren();
    for (const iso of calendarDays(year, month)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = String(Number(iso.slice(8)));
      button.dataset.date = iso;
      button.tabIndex = iso === active ? 0 : -1;
      button.classList.toggle("outside-month", Number(iso.slice(5, 7)) !== month + 1);
      button.classList.toggle("selected-day", iso === selected);
      button.setAttribute("aria-pressed", String(iso === selected));
      button.setAttribute("aria-label", new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
      if (iso === today) button.setAttribute("aria-current", "date");
      button.addEventListener("click", () => selectDate(iso));
      grid.append(button);
    }
    if (focusDay) grid.querySelector(`[data-date="${active}"]`)?.focus();
  };
  const selectDate = (iso) => {
    input.value = formatDisplayDate(iso);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    dialog.close();
  };
  const changeMonth = (delta, focus = false) => {
    const date = new Date(`${active}T12:00:00`);
    const target = new Date(date.getFullYear(), date.getMonth() + delta, 1, 12);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(date.getDate(), lastDay));
    active = formatDate(target);
    render(focus);
  };
  dialog.querySelector("[data-month-back]").addEventListener("click", () => changeMonth(-1));
  dialog.querySelector("[data-month-next]").addEventListener("click", () => changeMonth(1));
  dialog.querySelector("[data-calendar-close]").addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-calendar-today]").addEventListener("click", () => selectDate(formatDate(new Date())));
  const changeDisplayedMonth = () => {
    const year = Number(yearInput.value);
    if (!Number.isInteger(year) || year < 1900 || year > 9999) return;
    active = formatDate(new Date(year, Number(monthSelect.value), 1, 12));
    render();
  };
  monthSelect.addEventListener("change", changeDisplayedMonth);
  yearInput.addEventListener("change", changeDisplayedMonth);
  grid.addEventListener("keydown", (event) => {
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in offsets) active = shiftDate(active, offsets[event.key]);
    else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      changeMonth(event.key === "PageUp" ? -1 : 1, true);
      return;
    } else if (event.key === "Home" || event.key === "End") {
      const day = (new Date(`${active}T12:00:00`).getDay() + 6) % 7;
      active = shiftDate(active, event.key === "Home" ? -day : 6 - day);
    } else return;
    event.preventDefault();
    render(true);
  });
  dialog.addEventListener("close", () => trigger?.focus({ preventScroll: true }));
  document.querySelectorAll("[data-calendar-for]").forEach((button) => {
    button.addEventListener("click", () => {
      trigger = button;
      input = document.getElementById(button.dataset.calendarFor);
      today = formatDate(new Date());
      selected = parseDisplayDate(input.value);
      active = selected || today;
      dialog.querySelector("#calendar-title").textContent = button.getAttribute("aria-label");
      render();
      dialog.showModal();
      grid.querySelector(`[data-date="${active}"]`)?.focus();
    });
  });
}
