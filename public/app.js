const roomSelect = document.getElementById("roomId");
const recurrenceTypeSelect = document.getElementById("recurrenceType");
const recurrenceCountInput = document.getElementById("recurrenceCount");
const bookingForm = document.getElementById("booking-form");
const formMessage = document.getElementById("form-message");
const approvalMessage = document.getElementById("approval-message");
const shareMessage = document.getElementById("share-message");
const approvalList = document.getElementById("approval-list");
const historyList = document.getElementById("history-list");
const scheduleList = document.getElementById("schedule-list");
const calendarGrid = document.getElementById("calendar-grid");
const calendarRange = document.getElementById("calendar-range");
const roomRules = document.getElementById("room-rules");
const blockedSlotsList = document.getElementById("blocked-slots");
const calendarLegend = document.getElementById("calendar-legend");
const pastorSummary = document.getElementById("pastor-summary");
const pastorCodeInput = document.getElementById("pastor-code");
const loadApprovalsButton = document.getElementById("load-approvals");
const refreshApprovalsButton = document.getElementById("refresh-approvals");
const previousWeekButton = document.getElementById("previous-week");
const nextWeekButton = document.getElementById("next-week");
const weekViewButton = document.getElementById("week-view");
const monthViewButton = document.getElementById("month-view");
const printCalendarButton = document.getElementById("print-calendar");
const shareWhatsappButton = document.getElementById("share-whatsapp");
const copyShareLinkButton = document.getElementById("copy-share-link");
const publicBanner = document.getElementById("public-banner");

const state = {
  roomMap: new Map(),
  approvedBookings: [],
  blockedSlots: [],
  pastorBookings: [],
  currentDate: getInitialDate(),
  calendarView: getInitialView(),
  publicMode: new URLSearchParams(window.location.search).get("public") === "1",
  settings: {}
};

bootstrap().catch((error) => {
  showMessage(formMessage, error.message || "Die Seite konnte nicht geladen werden.", true);
});

async function bootstrap() {
  applyPublicMode();
  await loadMeta();
  await loadApprovedBookings();
  renderRoomDetails();
  setCalendarView(state.calendarView);
}

async function loadMeta() {
  const response = await fetch("/api/rooms", {
    cache: "no-store"
  });
  const data = await response.json();

  state.settings = data.settings || {};
  state.blockedSlots = data.blockedSlots || [];
  state.roomMap.clear();
  (data.rooms || []).forEach((room) => {
    state.roomMap.set(room.id, room);
  });

  roomSelect.innerHTML = data.rooms
    .map((room) => `<option value="${room.id}">${room.name} (${room.capacity} Plätze)</option>`)
    .join("");

  renderLegend();
  renderRoomDetails();
  renderBlockedSlots();
}

async function loadApprovedBookings() {
  const response = await fetch("/api/bookings", {
    cache: "no-store"
  });
  const data = await response.json();
  state.approvedBookings = data.bookings || [];
  state.blockedSlots = data.blockedSlots || state.blockedSlots;
  renderCalendar();
  renderScheduleCards();
}

async function loadPastorBookings() {
  const code = pastorCodeInput.value.trim();
  if (!code) {
    showMessage(approvalMessage, "Bitte zuerst den Pastor-Code eingeben.", true);
    return;
  }

  showMessage(approvalMessage, "Anfragen werden geladen...");

  try {
    const response = await fetch("/api/bookings?view=pastor", {
      cache: "no-store",
      headers: {
        "x-pastor-code": code
      }
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Anfragen konnten nicht geladen werden.");
    }

    state.pastorBookings = data.bookings || [];
    renderPastorArea();
    showMessage(
      approvalMessage,
      `${state.pastorBookings.filter((booking) => booking.status === "pending").length} offene Anfrage(n).`
    );
  } catch (error) {
    approvalList.innerHTML = "";
    historyList.innerHTML = "";
    showMessage(approvalMessage, error.message, true);
  }
}

bookingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage(formMessage, "Anfrage wird gespeichert...");

  const formData = new FormData(bookingForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Anfrage konnte nicht gespeichert werden.");
    }

    bookingForm.reset();
    recurrenceCountInput.value = "1";
    recurrenceTypeSelect.value = "none";
    renderRoomDetails();

    const note =
      data.createdCount > 1
        ? `${data.createdCount} Anfragen als Serie gespeichert und an den Pastor gemeldet.`
        : "Anfrage wurde erfolgreich an den Pastor weitergeleitet.";
    showMessage(formMessage, note);

    await loadApprovedBookings();

    if (pastorCodeInput.value.trim()) {
      await loadPastorBookings();
    }
  } catch (error) {
    showMessage(formMessage, error.message, true);
  }
});

loadApprovalsButton.addEventListener("click", loadPastorBookings);
refreshApprovalsButton.addEventListener("click", refreshPastorData);
roomSelect.addEventListener("change", renderRoomDetails);
weekViewButton.addEventListener("click", () => setCalendarView("week"));
monthViewButton.addEventListener("click", () => setCalendarView("month"));
previousWeekButton.addEventListener("click", () => shiftCalendar(-1));
nextWeekButton.addEventListener("click", () => shiftCalendar(1));
printCalendarButton.addEventListener("click", () => window.print());
shareWhatsappButton.addEventListener("click", shareViaWhatsApp);
copyShareLinkButton.addEventListener("click", copyShareLink);

function setCalendarView(mode) {
  state.calendarView = mode;
  weekViewButton.classList.toggle("active", mode === "week");
  monthViewButton.classList.toggle("active", mode === "month");
  previousWeekButton.textContent = mode === "week" ? "Vorige Woche" : "Voriger Monat";
  nextWeekButton.textContent = mode === "week" ? "Nächste Woche" : "Nächster Monat";
  syncPublicUrl();
  renderCalendar();
}

function shiftCalendar(direction) {
  const date = new Date(state.currentDate);
  if (state.calendarView === "week") {
    date.setDate(date.getDate() + direction * 7);
  } else {
    date.setMonth(date.getMonth() + direction);
  }
  state.currentDate = date;
  syncPublicUrl();
  renderCalendar();
}

async function refreshPastorData() {
  showMessage(approvalMessage, "Aktualisiere Daten vom Server...");
  await loadApprovedBookings();
  if (pastorCodeInput.value.trim()) {
    await loadPastorBookings();
    return;
  }
  showMessage(approvalMessage, "Kalender wurde aktualisiert.");
}

function renderRoomDetails() {
  const room = state.roomMap.get(roomSelect.value) || [...state.roomMap.values()][0];
  if (!room) {
    roomRules.innerHTML = "<p>Keine Raumdaten vorhanden.</p>";
    return;
  }

  roomRules.innerHTML = `
    <p><strong>${escapeHtml(room.name)}</strong> (${room.capacity} Plätze)</p>
    <ul class="inline-list">
      ${(room.rules || []).map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}
    </ul>
    <p class="muted-inline">Anfragen werden immer vom Pastor geprüft.</p>
  `;
}

function renderBlockedSlots() {
  const upcoming = state.blockedSlots.slice(0, 8);
  if (!upcoming.length) {
    blockedSlotsList.innerHTML = "<p>Keine Sperrzeiten eingetragen.</p>";
    return;
  }

  blockedSlotsList.innerHTML = upcoming
    .map((slot) => {
      const rooms = slot.roomIds.map((roomId) => state.roomMap.get(roomId)?.name || roomId).join(", ");
      return `
        <article class="mini-entry">
          <p><strong>${escapeHtml(slot.title)}</strong></p>
          <p>${formatDate(slot.startAt)} bis ${formatDate(slot.endAt)}</p>
          <p>${escapeHtml(rooms)}</p>
        </article>
      `;
    })
    .join("");
}

function renderLegend() {
  calendarLegend.innerHTML = [...state.roomMap.values()]
    .map(
      (room) => `
        <span class="legend-item">
          <span class="legend-swatch" style="background:${escapeHtml(room.color)}"></span>
          ${escapeHtml(room.name)}
        </span>
      `
    )
    .join("");
}

function renderCalendar() {
  const days =
    state.calendarView === "week" ? getWeekDays(state.currentDate) : getMonthDays(state.currentDate);

  const rangeLabel =
    state.calendarView === "week"
      ? `${formatDay(days[0])} bis ${formatDay(days[days.length - 1])}`
      : new Intl.DateTimeFormat("de-AT", { month: "long", year: "numeric" }).format(days[10]);
  calendarRange.textContent = rangeLabel;

  calendarGrid.className = `calendar-grid ${state.calendarView === "month" ? "month-view" : "week-view"}`;
  calendarGrid.innerHTML = days
    .map((day) => {
      const isToday = isSameDay(day, new Date());
      const entries = getEntriesForDay(day);
      return `
        <section class="calendar-day${isToday ? " today" : ""}${day.outsideMonth ? " outside-month" : ""}">
          <div class="calendar-day-header">
            <p class="calendar-weekday">${formatWeekday(day)}</p>
            <h3>${formatDayNumber(day)}</h3>
            <p class="calendar-date">${formatMonth(day)}</p>
          </div>
          <div class="calendar-slots">
            ${
              entries.length
                ? entries
                    .map((entry) =>
                      entry.type === "blocked" ? renderBlockedEntry(entry) : renderBookingEntry(entry)
                    )
                    .join("")
                : `<p class="calendar-empty">Keine Belegung</p>`
            }
          </div>
        </section>
      `;
    })
    .join("");
}

function renderBookingEntry(booking) {
  const room = state.roomMap.get(booking.roomId);
  return `
    <article class="calendar-entry room-${escapeHtml(booking.roomId)}">
      <p class="calendar-entry-time">${formatTime(booking.startAt)} - ${formatTime(booking.endAt)}</p>
      <h4>${escapeHtml(booking.purpose)}</h4>
      <p>${escapeHtml(room ? room.name : booking.roomId)}</p>
      <p>${escapeHtml(booking.requestedBy)}</p>
    </article>
  `;
}

function renderBlockedEntry(slot) {
  const roomNames = slot.roomIds.map((roomId) => state.roomMap.get(roomId)?.name || roomId).join(", ");
  return `
    <article class="calendar-entry blocked-entry">
      <p class="calendar-entry-time">${formatTime(slot.startAt)} - ${formatTime(slot.endAt)}</p>
      <h4>${escapeHtml(slot.title)}</h4>
      <p>${escapeHtml(roomNames)}</p>
      <p>Gesperrt</p>
    </article>
  `;
}

function getEntriesForDay(day) {
  const dateBookings = state.approvedBookings
    .filter((booking) => isSameDay(new Date(booking.startAt), day))
    .map((booking) => ({ ...booking, type: "booking" }));
  const dateBlocks = state.blockedSlots
    .filter((slot) => isSameDay(new Date(slot.startAt), day))
    .map((slot) => ({ ...slot, type: "blocked" }));

  return [...dateBlocks, ...dateBookings].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  );
}

function renderScheduleCards() {
  if (!state.approvedBookings.length) {
    scheduleList.innerHTML = `<div class="card"><p>Keine bestätigten Buchungen vorhanden.</p></div>`;
    return;
  }

  scheduleList.innerHTML = state.approvedBookings
    .map((booking) => {
      const room = state.roomMap.get(booking.roomId);
      const seriesText =
        booking.recurrenceCount > 1
          ? `<p><strong>Serie:</strong> ${booking.recurrenceIndex} von ${booking.recurrenceCount}</p>`
          : "";
      return `
        <article class="card">
          <div class="card-top">
            <div>
              <p class="section-label">${room ? room.name : booking.roomId}</p>
              <h3>${escapeHtml(booking.purpose)}</h3>
            </div>
            <span class="status ${booking.status}">${statusLabel(booking.status)}</span>
          </div>
          <p><strong>Von:</strong> ${escapeHtml(booking.requestedBy)}</p>
          <p><strong>Kontakt:</strong> ${escapeHtml(booking.email)}</p>
          <p><strong>Zeit:</strong> ${formatDate(booking.startAt)} bis ${formatDate(booking.endAt)}</p>
          ${seriesText}
        </article>
      `;
    })
    .join("");
}

function renderPastorArea() {
  const pending = state.pastorBookings.filter((booking) => booking.status === "pending");
  const history = state.pastorBookings
    .filter((booking) => booking.status !== "pending")
    .sort((a, b) => new Date(b.decidedAt || b.createdAt) - new Date(a.decidedAt || a.createdAt));

  pastorSummary.innerHTML = `
    <span>${pending.length} offen</span>
    <span>${history.filter((booking) => booking.status === "approved").length} im Archiv freigegeben</span>
    <span>${history.filter((booking) => booking.status === "rejected").length} im Archiv abgelehnt</span>
    <span>E-Mail: ${state.settings.emailConfigured ? "SMTP aktiv" : "Outbox-Datei aktiv"}</span>
  `;

  renderPastorCards(approvalList, pending, true);
  renderHistoryCards(historyList, history);
}

function renderPastorCards(container, bookings, includeActions) {
  if (!bookings.length) {
    container.innerHTML = `<div class="card"><p>Keine Einträge vorhanden.</p></div>`;
    return;
  }

  container.innerHTML = bookings
    .map((booking) => {
      const room = state.roomMap.get(booking.roomId);
      const seriesActions =
        includeActions && booking.recurrenceGroupId && booking.recurrenceCount > 1
          ? `
            <div class="card-actions">
              <button type="button" data-series-action="approve" data-series-id="${booking.recurrenceGroupId}">Serie freigeben</button>
              <button type="button" class="secondary" data-series-action="reject" data-series-id="${booking.recurrenceGroupId}">Serie ablehnen</button>
            </div>
          `
          : "";

      return `
        <article class="card">
          <div class="card-top">
            <div>
              <p class="section-label">${room ? room.name : booking.roomId}</p>
              <h3>${escapeHtml(booking.purpose)}</h3>
            </div>
            <span class="status ${booking.status}">${statusLabel(booking.status)}</span>
          </div>
          <p><strong>Von:</strong> ${escapeHtml(booking.requestedBy)}</p>
          <p><strong>Kontakt:</strong> ${escapeHtml(booking.email)}</p>
          <p><strong>Zeit:</strong> ${formatDate(booking.startAt)} bis ${formatDate(booking.endAt)}</p>
          ${
            booking.recurrenceCount > 1
              ? `<p><strong>Serie:</strong> ${booking.recurrenceIndex} von ${booking.recurrenceCount} (${recurrenceLabel(booking.recurrenceType)})</p>`
              : ""
          }
          ${
            includeActions
              ? `<div class="card-actions">
                  <button type="button" data-action="approve" data-id="${booking.id}">Freigeben</button>
                  <button type="button" class="secondary" data-action="reject" data-id="${booking.id}">Ablehnen</button>
                </div>`
              : ""
          }
          ${seriesActions}
        </article>
      `;
    })
    .join("");

  bindPastorActions(container);
}

function renderHistoryCards(container, bookings) {
  if (!bookings.length) {
    container.innerHTML = `<div class="card"><p>Noch keine Historie vorhanden.</p></div>`;
    return;
  }

  container.innerHTML = bookings
    .slice(0, 12)
    .map((booking) => {
      const room = state.roomMap.get(booking.roomId);
      const historyItems = (booking.history || [])
        .map(
          (entry) => `
            <li>${escapeHtml(formatDate(entry.createdAt))} · ${escapeHtml(entry.actor)} · ${escapeHtml(entry.detail)}</li>
          `
        )
        .join("");

      return `
        <article class="card">
          <div class="card-top">
            <div>
              <p class="section-label">${room ? room.name : booking.roomId}</p>
              <h3>${escapeHtml(booking.purpose)}</h3>
            </div>
            <span class="status ${booking.status}">${statusLabel(booking.status)}</span>
          </div>
          <p><strong>Zeit:</strong> ${formatDate(booking.startAt)} bis ${formatDate(booking.endAt)}</p>
          <div class="card-actions">
            ${
              booking.status === "approved"
                ? `<button type="button" class="secondary" data-action="reject" data-id="${booking.id}">Doch ablehnen</button>`
                : `<button type="button" data-action="approve" data-id="${booking.id}">Doch freigeben</button>`
            }
            <button type="button" class="secondary" data-action="reopen" data-id="${booking.id}">Als offen markieren</button>
          </div>
          <ul class="inline-list history-list">${historyItems}</ul>
        </article>
      `;
    })
    .join("");

  bindPastorActions(container);
}

function bindPastorActions(container) {
  const code = pastorCodeInput.value.trim();

  container.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.action;
      const bookingId = button.dataset.id;
      await runPastorAction(`/api/bookings/${bookingId}/${action}`, code, action);
    });
  });

  container.querySelectorAll("[data-series-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const action = button.dataset.seriesAction;
      const seriesId = button.dataset.seriesId;
      await runPastorAction(`/api/series/${seriesId}/${action}`, code, action);
    });
  });
}

async function runPastorAction(url, code, action) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-pastor-code": code
      }
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Aktion konnte nicht durchgeführt werden.");
    }

    applyPastorActionLocally(url, action);
    renderPastorArea();
    showMessage(
      approvalMessage,
      pastorActionMessage(action)
    );
    await loadApprovedBookings();
    await loadPastorBookings();
  } catch (error) {
    showMessage(approvalMessage, error.message, true);
  }
}

function applyPastorActionLocally(url, action) {
  const targetStatus = pastorTargetStatus(action);
  const decidedAt = new Date().toISOString();
  const detail =
    action === "approve"
      ? "Anfrage freigegeben"
      : action === "reject"
        ? "Anfrage abgelehnt"
        : "Anfrage wieder auf offen gesetzt";
  const match = url.match(/^\/api\/(bookings|series)\/([^/]+)\//);

  if (!match) {
    return;
  }

  const [, type, targetId] = match;
  state.pastorBookings = state.pastorBookings.map((booking) => {
    const isMatch =
      type === "bookings" ? booking.id === targetId : booking.recurrenceGroupId === targetId;

    if (!isMatch || booking.status !== "pending") {
      return booking;
    }

    const history = Array.isArray(booking.history) ? [...booking.history] : [];
    history.push({
      createdAt: decidedAt,
      actor: "Pastor",
      detail
    });

    return {
      ...booking,
      status: targetStatus,
      decidedAt: action === "reopen" ? undefined : decidedAt,
      history
    };
  });
}

function pastorTargetStatus(action) {
  if (action === "approve") {
    return "approved";
  }

  if (action === "reject") {
    return "rejected";
  }

  return "pending";
}

function pastorActionMessage(action) {
  if (action === "approve") {
    return "Anfrage wurde freigegeben und direkt ins Archiv verschoben.";
  }

  if (action === "reject") {
    return "Anfrage wurde abgelehnt und direkt ins Archiv verschoben.";
  }

  return "Anfrage wurde wieder auf offen gesetzt.";
}

function formatDate(value) {
  return new Intl.DateTimeFormat("de-AT", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDay(value) {
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(value));
}

function formatWeekday(value) {
  return new Intl.DateTimeFormat("de-AT", { weekday: "long" }).format(new Date(value));
}

function formatDayNumber(value) {
  return new Intl.DateTimeFormat("de-AT", { day: "2-digit" }).format(new Date(value));
}

function formatMonth(value) {
  return new Intl.DateTimeFormat("de-AT", { month: "long" }).format(new Date(value));
}

function formatTime(value) {
  return new Intl.DateTimeFormat("de-AT", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function recurrenceLabel(value) {
  return { none: "einmalig", weekly: "wöchentlich", monthly: "monatlich" }[value] || value;
}

function statusLabel(status) {
  const labels = {
    pending: "Offen",
    approved: "Freigegeben",
    rejected: "Abgelehnt"
  };
  return labels[status] || status;
}

function showMessage(element, text, isError = false) {
  element.textContent = text;
  element.className = `message${isError ? " error" : text ? " success" : ""}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getWeekDays(value) {
  const start = startOfWeek(value);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function getMonthDays(value) {
  const date = new Date(value);
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const first = startOfWeek(start);
  const last = addDays(startOfWeek(end), 6);
  const days = [];

  for (let cursor = new Date(first); cursor <= last; cursor = addDays(cursor, 1)) {
    const day = new Date(cursor);
    day.outsideMonth = day.getMonth() !== date.getMonth();
    days.push(day);
  }

  return days;
}

function startOfWeek(value) {
  const date = new Date(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + diff);
  return date;
}

function addDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function isSameDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function applyPublicMode() {
  document.body.classList.toggle("public-mode", state.publicMode);
  document.querySelectorAll("[data-private-only]").forEach((element) => {
    element.classList.toggle("hidden", state.publicMode);
  });
  publicBanner.classList.toggle("hidden", !state.publicMode);
}

function buildPublicShareUrl() {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("public", "1");
  url.searchParams.set("view", state.calendarView);
  url.searchParams.set("date", formatIsoDay(state.currentDate));
  return url.toString();
}

async function copyShareLink() {
  const url = buildPublicShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    showMessage(shareMessage, "Öffentlicher Link wurde kopiert.");
  } catch {
    showMessage(shareMessage, url);
  }
}

async function shareViaWhatsApp() {
  const url = buildPublicShareUrl();
  const text =
    `Hier ist unser Raumkalender der Gemeinde. Du kannst freie Zeiten ansehen und direkt eine Anfrage stellen: ${url}`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: "Gemeinde Raumkalender",
        text
      });
      showMessage(shareMessage, "Kalender wurde zum Teilen vorbereitet.");
      return;
    } catch {
      // Fallback to WhatsApp URL below.
    }
  }

  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  showMessage(shareMessage, "WhatsApp wurde zum Teilen geöffnet.");
}

function syncPublicUrl() {
  if (!state.publicMode) {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.set("public", "1");
  url.searchParams.set("view", state.calendarView);
  url.searchParams.set("date", formatIsoDay(state.currentDate));
  window.history.replaceState({}, "", url);
}

function getInitialDate() {
  const raw = new URLSearchParams(window.location.search).get("date");
  if (!raw) {
    return new Date();
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function getInitialView() {
  const raw = new URLSearchParams(window.location.search).get("view");
  return raw === "month" ? "month" : "week";
}

function formatIsoDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Service Worker konnte nicht registriert werden.", error);
    });
  });
}
