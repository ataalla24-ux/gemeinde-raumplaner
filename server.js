const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const nodemailer = require("nodemailer");
const { createStorage } = require("./storage");

const PORT = process.env.PORT || 3000;
const PASTOR_CODE = process.env.PASTOR_CODE || "gemeinde123";
const PASTOR_EMAIL = process.env.PASTOR_EMAIL || "pastor@gemeinde.local";
const EMAIL_FROM = process.env.EMAIL_FROM || "raumplaner@gemeinde.local";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const DATABASE_URL = process.env.DATABASE_URL || "";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const BOOKINGS_FILE = path.join(DATA_DIR, "bookings.json");
const OUTBOX_FILE = path.join(DATA_DIR, "outbox.log");
const PUBLIC_DIR = path.join(__dirname, "public");
const storage = createStorage({
  dataDir: DATA_DIR,
  bookingsFile: BOOKINGS_FILE,
  outboxFile: OUTBOX_FILE,
  databaseUrl: DATABASE_URL
});

const rooms = [
  {
    id: "grosser-saal",
    name: "Großer Saal",
    capacity: 80,
    color: "#99582a",
    rules: ["Buchbar von 08:00 bis 22:00", "Geeignet für große Veranstaltungen"],
    allowedHours: { start: 8, end: 22 }
  },
  {
    id: "kleiner-saal",
    name: "Kleiner Saal",
    capacity: 40,
    color: "#566f44",
    rules: ["Buchbar von 08:00 bis 21:00"],
    allowedHours: { start: 8, end: 21 }
  },
  {
    id: "saal-1",
    name: "Saal 1",
    capacity: 20,
    color: "#407a9e",
    rules: ["Buchbar von 09:00 bis 21:00"],
    allowedHours: { start: 9, end: 21 }
  },
  {
    id: "saal-2",
    name: "Saal 2",
    capacity: 20,
    color: "#795891",
    rules: ["Buchbar von 09:00 bis 21:00"],
    allowedHours: { start: 9, end: 21 }
  },
  {
    id: "saal-3",
    name: "Saal 3",
    capacity: 20,
    color: "#be7344",
    rules: ["Buchbar von 09:00 bis 21:00"],
    allowedHours: { start: 9, end: 21 }
  },
  {
    id: "saal-4",
    name: "Saal 4",
    capacity: 20,
    color: "#2f7d4a",
    rules: ["Buchbar von 09:00 bis 21:00"],
    allowedHours: { start: 9, end: 21 }
  },
  {
    id: "saal-5",
    name: "Saal 5",
    capacity: 20,
    color: "#b17e21",
    rules: ["Buchbar von 09:00 bis 21:00"],
    allowedHours: { start: 9, end: 21 }
  },
  {
    id: "kueche",
    name: "Küche",
    capacity: 10,
    color: "#aa3a55",
    rules: ["Buchbar von 08:00 bis 20:00", "Bitte Zweck genau angeben"],
    allowedHours: { start: 8, end: 20 }
  },
  {
    id: "sky-kaffee",
    name: "Sky Kaffee",
    capacity: 24,
    color: "#2d6072",
    rules: ["Buchbar von 10:00 bis 22:00", "Nicht während Kaffeeausgabe am Sonntag"],
    allowedHours: { start: 10, end: 22 }
  }
];

const blockedSlots = [
  {
    id: "sonntag-gottesdienst",
    title: "Gottesdienst und Aufbau",
    roomIds: ["grosser-saal", "kleiner-saal", "kueche", "sky-kaffee"],
    recurrence: "weekly",
    weekday: 0,
    startHour: 8,
    startMinute: 0,
    endHour: 14,
    endMinute: 0
  },
  {
    id: "dienstag-team",
    title: "Leitungssitzung",
    roomIds: ["saal-1"],
    recurrence: "weekly",
    weekday: 2,
    startHour: 18,
    startMinute: 30,
    endHour: 20,
    endMinute: 30
  }
];

let storageReadyPromise = null;

const server = http.createServer(async (req, res) => {
  await handleRequest(req, res);
});

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    try {
      await handleApi(req, res, url);
    } catch (error) {
      if (error && error.statusCode) {
        sendJson(res, error.statusCode, { error: error.message });
        return;
      }
      console.error(error);
      sendJson(res, 500, { error: error && error.message ? error.message : "Interner Serverfehler." });
    }
    return;
  }

  serveStatic(req, res, url);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/rooms") {
    sendJson(res, 200, buildPublicMeta());
    return;
  }

  await ensureStorageReady();

  if (req.method === "GET" && url.pathname === "/api/bookings") {
    const requiresPastorCode = url.searchParams.get("view") === "pastor";
    assertPastorAccess(req, requiresPastorCode);

    const bookings = (await storage.listBookings()).sort((a, b) => {
      return new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
    });

    sendJson(res, 200, {
      bookings: requiresPastorCode ? bookings : bookings.filter((entry) => entry.status === "approved"),
      ...buildPublicMeta()
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/bookings") {
    const body = await parseJsonBody(req);
    const validated = validateBookingRequest(body);
    const bookings = await storage.listBookings();
    const series = buildSeries(validated);

    for (const occurrence of series) {
      assertNoBlockingIssues(bookings, occurrence);
    }

    const recurrenceGroupId = series.length > 1 ? randomUUID() : null;
    const createdAt = new Date().toISOString();
    const newBookings = series.map((occurrence, index) => {
      const historyEntry = createHistoryEntry("created", {
        actor: occurrence.requestedBy,
        detail: "Anfrage eingereicht"
      });

      return {
        id: randomUUID(),
        recurrenceGroupId,
        recurrenceType: validated.recurrenceType,
        recurrenceCount: series.length,
        recurrenceIndex: index + 1,
        status: "pending",
        createdAt,
        history: [historyEntry],
        ...occurrence
      };
    });

    await storage.appendBookings(newBookings);
    await notifyPastorAboutRequest(newBookings);
    sendJson(res, 201, { booking: newBookings[0], bookings: newBookings, createdCount: newBookings.length });
    return;
  }

  if (req.method === "POST" && /^\/api\/bookings\/[^/]+\/approve$/.test(url.pathname)) {
    assertPastorAccess(req, true);
    const bookingId = url.pathname.split("/")[3];
    const body = await parseJsonBody(req);
    const result = await decideBookings({ bookingId, action: "approve", note: normalizeDecisionNote(body.note) });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && /^\/api\/bookings\/[^/]+\/reject$/.test(url.pathname)) {
    assertPastorAccess(req, true);
    const bookingId = url.pathname.split("/")[3];
    const body = await parseJsonBody(req);
    const result = await decideBookings({ bookingId, action: "reject", note: normalizeDecisionNote(body.note) });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && /^\/api\/bookings\/[^/]+\/reopen$/.test(url.pathname)) {
    assertPastorAccess(req, true);
    const bookingId = url.pathname.split("/")[3];
    const body = await parseJsonBody(req);
    const result = await decideBookings({ bookingId, action: "reopen", note: normalizeDecisionNote(body.note) });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && /^\/api\/series\/[^/]+\/approve$/.test(url.pathname)) {
    assertPastorAccess(req, true);
    const recurrenceGroupId = url.pathname.split("/")[3];
    const body = await parseJsonBody(req);
    const result = await decideBookings({
      recurrenceGroupId,
      action: "approve",
      note: normalizeDecisionNote(body.note)
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && /^\/api\/series\/[^/]+\/reject$/.test(url.pathname)) {
    assertPastorAccess(req, true);
    const recurrenceGroupId = url.pathname.split("/")[3];
    const body = await parseJsonBody(req);
    const result = await decideBookings({
      recurrenceGroupId,
      action: "reject",
      note: normalizeDecisionNote(body.note)
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && /^\/api\/series\/[^/]+\/reopen$/.test(url.pathname)) {
    assertPastorAccess(req, true);
    const recurrenceGroupId = url.pathname.split("/")[3];
    const body = await parseJsonBody(req);
    const result = await decideBookings({
      recurrenceGroupId,
      action: "reopen",
      note: normalizeDecisionNote(body.note)
    });
    sendJson(res, 200, result);
    return;
  }

  sendJson(res, 404, { error: "Route nicht gefunden." });
}

function serveStatic(req, res, url) {
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = path.join(PUBLIC_DIR, filePath);

  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Zugriff verweigert.");
    return;
  }

  fs.readFile(absolutePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendText(res, 404, "Datei nicht gefunden.");
        return;
      }
      sendText(res, 500, "Interner Serverfehler.");
      return;
    }

    res.writeHead(200, { "Content-Type": getContentType(absolutePath) });
    res.end(content);
  });
}

function getContentType(filePath) {
  const extension = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8"
  };

  return contentTypes[extension] || "application/octet-stream";
}

function validateBookingRequest(payload) {
  if (!payload || typeof payload !== "object") {
    throw createHttpError(400, "Ungültige Anfrage.");
  }

  const roomId = String(payload.roomId || "").trim();
  const requestedBy = String(payload.requestedBy || "").trim();
  const email = String(payload.email || "").trim();
  const purpose = String(payload.purpose || "").trim();
  const startAt = String(payload.startAt || "").trim();
  const endAt = String(payload.endAt || "").trim();
  const recurrenceType = String(payload.recurrenceType || "none").trim();
  const recurrenceCount = Number(payload.recurrenceCount || 1);

  const room = rooms.find((entry) => entry.id === roomId);
  if (!room) {
    throw createHttpError(400, "Bitte einen gültigen Raum auswählen.");
  }

  if (!requestedBy || !email || !purpose || !startAt || !endAt) {
    throw createHttpError(400, "Bitte alle Felder ausfüllen.");
  }

  const startDate = new Date(startAt);
  const endDate = new Date(endAt);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw createHttpError(400, "Start- und Endzeit sind ungültig.");
  }

  if (endDate <= startDate) {
    throw createHttpError(400, "Die Endzeit muss nach der Startzeit liegen.");
  }

  if (!["none", "weekly", "monthly"].includes(recurrenceType)) {
    throw createHttpError(400, "Wiederholung ist ungültig.");
  }

  if (!Number.isInteger(recurrenceCount) || recurrenceCount < 1 || recurrenceCount > 24) {
    throw createHttpError(400, "Die Anzahl der Wiederholungen muss zwischen 1 und 24 liegen.");
  }

  assertRoomHours(room, startDate, endDate);

  return {
    roomId,
    requestedBy,
    email,
    purpose,
    recurrenceType,
    recurrenceCount,
    startAt: startDate.toISOString(),
    endAt: endDate.toISOString()
  };
}

function hasConflict(bookings, roomId, startAt, endAt, status, ignoreId) {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();

  return bookings.some((entry) => {
    if (entry.id === ignoreId) {
      return false;
    }

    if (entry.roomId !== roomId || entry.status !== status) {
      return false;
    }

    const entryStart = new Date(entry.startAt).getTime();
    const entryEnd = new Date(entry.endAt).getTime();
    return start < entryEnd && end > entryStart;
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let rawBody = "";

    req.on("data", (chunk) => {
      rawBody += chunk;

      if (rawBody.length > 1_000_000) {
        req.destroy();
        reject(createHttpError(413, "Anfrage ist zu groß."));
      }
    });

    req.on("end", () => {
      try {
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch {
        reject(createHttpError(400, "JSON konnte nicht gelesen werden."));
      }
    });

    req.on("error", reject);
  });
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

process.on("unhandledRejection", (error) => {
  console.error(error);
});

function buildSeries(validated) {
  const start = new Date(validated.startAt);
  const end = new Date(validated.endAt);
  const series = [];

  for (let index = 0; index < validated.recurrenceCount; index += 1) {
    const occurrenceStart = new Date(start);
    const occurrenceEnd = new Date(end);

    if (validated.recurrenceType === "weekly") {
      occurrenceStart.setDate(occurrenceStart.getDate() + index * 7);
      occurrenceEnd.setDate(occurrenceEnd.getDate() + index * 7);
    } else if (validated.recurrenceType === "monthly") {
      occurrenceStart.setMonth(occurrenceStart.getMonth() + index);
      occurrenceEnd.setMonth(occurrenceEnd.getMonth() + index);
    }

    series.push({
      roomId: validated.roomId,
      requestedBy: validated.requestedBy,
      email: validated.email,
      purpose: validated.purpose,
      startAt: occurrenceStart.toISOString(),
      endAt: occurrenceEnd.toISOString()
    });
  }

  return series;
}

function assertRoomHours(room, startDate, endDate) {
  if (!room) {
    throw createHttpError(400, "Der angefragte Raum existiert nicht mehr in der aktuellen Raumliste.");
  }

  const { start, end } = room.allowedHours;
  const startValue = startDate.getHours() + startDate.getMinutes() / 60;
  const endValue = endDate.getHours() + endDate.getMinutes() / 60;

  if (startValue < start || endValue > end) {
    throw createHttpError(
      400,
      `${room.name} ist nur zwischen ${formatHour(start)} und ${formatHour(end)} buchbar.`
    );
  }
}

function assertNoBlockingIssues(bookings, booking, ignoreId) {
  const room = rooms.find((entry) => entry.id === booking.roomId);
  assertRoomHours(room, new Date(booking.startAt), new Date(booking.endAt));

  if (hasConflict(bookings, booking.roomId, booking.startAt, booking.endAt, "approved", ignoreId)) {
    throw createHttpError(409, `Der Raum ${room.name} ist in diesem Zeitraum bereits freigegeben.`);
  }

  const blockingSlot = findBlockingSlot(booking.roomId, booking.startAt, booking.endAt);
  if (blockingSlot) {
    throw createHttpError(
      409,
      `${room.name} ist in diesem Zeitraum gesperrt: ${blockingSlot.title}.`
    );
  }
}

function findBlockingSlot(roomId, startAt, endAt) {
  const start = new Date(startAt);
  const end = new Date(endAt);

  return expandBlockedSlots(start, end).find((slot) => {
    if (!slot.roomIds.includes(roomId)) {
      return false;
    }

    const slotStart = new Date(slot.startAt).getTime();
    const slotEnd = new Date(slot.endAt).getTime();
    return new Date(startAt).getTime() < slotEnd && new Date(endAt).getTime() > slotStart;
  });
}

function expandBlockedSlots(rangeStartInput, rangeEndInput) {
  const rangeStart = new Date(rangeStartInput);
  const rangeEnd = new Date(rangeEndInput);
  const expanded = [];

  blockedSlots.forEach((slot) => {
    if (slot.recurrence === "weekly") {
      const cursor = startOfDay(rangeStart);
      cursor.setDate(cursor.getDate() - 7);

      while (cursor <= rangeEnd) {
        if (cursor.getDay() === slot.weekday) {
          const startAt = new Date(cursor);
          startAt.setHours(slot.startHour, slot.startMinute, 0, 0);
          const endAt = new Date(cursor);
          endAt.setHours(slot.endHour, slot.endMinute, 0, 0);

          if (endAt >= rangeStart && startAt <= rangeEnd) {
            expanded.push({
              id: `${slot.id}-${startAt.toISOString()}`,
              title: slot.title,
              roomIds: slot.roomIds,
              startAt: startAt.toISOString(),
              endAt: endAt.toISOString()
            });
          }
        }

        cursor.setDate(cursor.getDate() + 1);
      }
    }
  });

  return expanded.sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatHour(value) {
  return `${String(value).padStart(2, "0")}:00`;
}

function buildPublicMeta() {
  const today = new Date();
  const rangeEnd = new Date(today);
  rangeEnd.setMonth(rangeEnd.getMonth() + 3);

  return {
    rooms,
    roomRules: rooms.map((room) => ({
      roomId: room.id,
      name: room.name,
      color: room.color,
      capacity: room.capacity,
      rules: room.rules
    })),
    blockedSlots: expandBlockedSlots(today, rangeEnd),
    settings: {
      recurrenceTypes: ["none", "weekly", "monthly"],
      emailConfigured: Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS),
      pastorEmail: PASTOR_EMAIL,
      usingDefaultPastorCode: PASTOR_CODE === "gemeinde123"
    }
  };
}

function assertPastorAccess(req, required) {
  if (required && req.headers["x-pastor-code"] !== PASTOR_CODE) {
    throw createHttpError(401, "Pastor-Code ist ungültig.");
  }
}

async function decideBookings({ bookingId, recurrenceGroupId, action, note }) {
  const bookings = await storage.listBookings();
  const targetBookings = recurrenceGroupId
    ? bookings.filter((entry) => entry.recurrenceGroupId === recurrenceGroupId)
    : bookings.filter((entry) => entry.id === bookingId);

  if (!targetBookings.length) {
    throw createHttpError(404, "Anfrage nicht gefunden.");
  }

  if (targetBookings.every((entry) => entry.status === mapStatusFromAction(action))) {
    throw createHttpError(400, "Die Anfrage hat bereits diesen Status.");
  }

  if (action === "approve") {
    targetBookings.forEach((entry) => assertNoBlockingIssues(bookings, entry, entry.id));
  }

  const decidedAt = new Date().toISOString();
  targetBookings.forEach((entry) => {
    entry.status = mapStatusFromAction(action);
    entry.decidedAt = action === "reopen" ? undefined : decidedAt;
    entry.history = entry.history || [];
    entry.history.push(
      createHistoryEntry(action, {
        actor: "Pastor",
        detail: actionDetail(action, note)
      })
    );
  });

  await storage.updateBookings(targetBookings);
  await Promise.all(targetBookings.map((entry) => notifyRequester(entry, action)));

  return {
    booking: targetBookings[0],
    bookings: targetBookings,
    updatedCount: targetBookings.length
  };
}

function createHistoryEntry(action, { actor, detail }) {
  return {
    id: randomUUID(),
    action,
    actor,
    detail,
    createdAt: new Date().toISOString()
  };
}

async function notifyPastorAboutRequest(bookings) {
  const first = bookings[0];
  const subject =
    bookings.length > 1
      ? `Neue Serienanfrage: ${first.purpose} (${bookings.length} Termine)`
      : `Neue Raumanfrage: ${first.purpose}`;
  const text = [
    `Eine neue Anfrage wurde erstellt.`,
    `Anfragender: ${first.requestedBy}`,
    `Kontakt: ${first.email}`,
    `Raum: ${getRoomName(first.roomId)}`,
    `Erster Termin: ${new Date(first.startAt).toLocaleString("de-AT")}`,
    bookings.length > 1 ? `Anzahl Termine: ${bookings.length}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  await sendNotification({
    to: PASTOR_EMAIL,
    subject,
    text
  });
}

async function notifyRequester(booking, action) {
  const subject =
    action === "approve"
      ? `Ihre Anfrage wurde freigegeben: ${booking.purpose}`
      : action === "reject"
        ? `Ihre Anfrage wurde abgelehnt: ${booking.purpose}`
        : `Ihre Anfrage wird erneut geprüft: ${booking.purpose}`;
  const text = [
    `Hallo ${booking.requestedBy},`,
    "",
    action === "approve"
      ? `Ihre Anfrage für ${getRoomName(booking.roomId)} wurde freigegeben.`
      : action === "reject"
        ? `Ihre Anfrage für ${getRoomName(booking.roomId)} wurde abgelehnt.`
        : `Ihre Anfrage für ${getRoomName(booking.roomId)} wurde wieder auf offen gesetzt und wird erneut geprüft.`,
    `Termin: ${new Date(booking.startAt).toLocaleString("de-AT")} bis ${new Date(booking.endAt).toLocaleString("de-AT")}`,
    latestPastorNote(booking)
  ].join("\n");

  await sendNotification({
    to: booking.email,
    subject,
    text
  });
}

async function sendNotification({ to, subject, text }) {
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });

    try {
      await transporter.sendMail({
        from: EMAIL_FROM,
        to,
        subject,
        text
      });
      return;
    } catch (error) {
      console.error("E-Mail-Versand fehlgeschlagen, schreibe in Outbox.", error);
    }
  }

  await storage.logNotification({ to, subject, text });
}

function getRoomName(roomId) {
  const room = rooms.find((entry) => entry.id === roomId);
  return room ? room.name : roomId;
}

function mapStatusFromAction(action) {
  if (action === "approve") {
    return "approved";
  }

  if (action === "reject") {
    return "rejected";
  }

  return "pending";
}

function actionDetail(action, note) {
  const base =
    action === "approve"
      ? "Anfrage freigegeben"
      : action === "reject"
        ? "Anfrage abgelehnt"
        : "Anfrage wieder auf offen gesetzt";

  return note ? `${base}: ${note}` : base;
}

function normalizeDecisionNote(value) {
  return String(value || "")
    .trim()
    .slice(0, 300);
}

function latestPastorNote(booking) {
  const history = Array.isArray(booking.history) ? booking.history : [];
  const entry = [...history].reverse().find((item) => item.actor === "Pastor" && item.detail.includes(":"));

  if (!entry) {
    return "";
  }

  return `Hinweis vom Pastor: ${entry.detail.split(":").slice(1).join(":").trim()}`;
}

async function startServer() {
  await ensureStorageReady();
  server.listen(PORT, () => {
    console.log(`Gemeinde-Raumplaner läuft auf http://localhost:${PORT}`);
  });
}

async function ensureStorageReady() {
  if (!storageReadyPromise) {
    storageReadyPromise = storage.init();
  }

  await storageReadyPromise;
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Serverstart fehlgeschlagen.", error);
    process.exit(1);
  });
}

module.exports = {
  handleRequest,
  startServer
};
