const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { Pool } = require("pg");

function createStorage({ dataDir, bookingsFile, outboxFile, databaseUrl }) {
  if (databaseUrl) {
    return new PostgresStorage(databaseUrl);
  }

  return new FileStorage({ dataDir, bookingsFile, outboxFile });
}

class FileStorage {
  constructor({ dataDir, bookingsFile, outboxFile }) {
    this.dataDir = dataDir;
    this.bookingsFile = bookingsFile;
    this.outboxFile = outboxFile;
  }

  async init() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (!fs.existsSync(this.bookingsFile)) {
      fs.writeFileSync(this.bookingsFile, "[]\n", "utf8");
    }

    if (!fs.existsSync(this.outboxFile)) {
      fs.writeFileSync(this.outboxFile, "", "utf8");
    }
  }

  async listBookings() {
    return JSON.parse(fs.readFileSync(this.bookingsFile, "utf8"));
  }

  async appendBookings(bookings) {
    const existing = await this.listBookings();
    existing.push(...bookings);
    this.writeBookings(existing);
  }

  async updateBookings(bookings) {
    const existing = await this.listBookings();
    const byId = new Map(bookings.map((booking) => [booking.id, booking]));
    const merged = existing.map((booking) => byId.get(booking.id) || booking);
    this.writeBookings(merged);
  }

  async logNotification({ to, subject, text }) {
    const logEntry = [
      `--- ${new Date().toISOString()} ---`,
      `TO: ${to}`,
      `SUBJECT: ${subject}`,
      text,
      ""
    ].join("\n");
    fs.appendFileSync(this.outboxFile, `${logEntry}\n`, "utf8");
  }

  writeBookings(bookings) {
    fs.writeFileSync(this.bookingsFile, `${JSON.stringify(bookings, null, 2)}\n`, "utf8");
  }
}

class PostgresStorage {
  constructor(databaseUrl) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : false
    });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        recurrence_group_id TEXT,
        recurrence_type TEXT NOT NULL,
        recurrence_count INTEGER NOT NULL,
        recurrence_index INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        decided_at TIMESTAMPTZ,
        room_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        email TEXT NOT NULL,
        purpose TEXT NOT NULL,
        start_at TIMESTAMPTZ NOT NULL,
        end_at TIMESTAMPTZ NOT NULL,
        history JSONB NOT NULL DEFAULT '[]'::jsonb
      );
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS notification_logs (
        id TEXT PRIMARY KEY,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
    `);
  }

  async listBookings() {
    const result = await this.pool.query(
      `
        SELECT
          id,
          recurrence_group_id,
          recurrence_type,
          recurrence_count,
          recurrence_index,
          status,
          created_at,
          decided_at,
          room_id,
          requested_by,
          email,
          purpose,
          start_at,
          end_at,
          history
        FROM bookings
        ORDER BY start_at ASC
      `
    );

    return result.rows.map(mapBookingRow);
  }

  async appendBookings(bookings) {
    if (!bookings.length) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const booking of bookings) {
        await client.query(
          `
            INSERT INTO bookings (
              id,
              recurrence_group_id,
              recurrence_type,
              recurrence_count,
              recurrence_index,
              status,
              created_at,
              decided_at,
              room_id,
              requested_by,
              email,
              purpose,
              start_at,
              end_at,
              history
            )
            VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9, $10,
              $11, $12, $13, $14, $15::jsonb
            )
          `,
          [
            booking.id,
            booking.recurrenceGroupId,
            booking.recurrenceType || "none",
            booking.recurrenceCount || 1,
            booking.recurrenceIndex || 1,
            booking.status,
            booking.createdAt,
            booking.decidedAt || null,
            booking.roomId,
            booking.requestedBy,
            booking.email,
            booking.purpose,
            booking.startAt,
            booking.endAt,
            JSON.stringify(booking.history || [])
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateBookings(bookings) {
    if (!bookings.length) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const booking of bookings) {
        await client.query(
          `
            UPDATE bookings
            SET
              recurrence_group_id = $2,
              recurrence_type = $3,
              recurrence_count = $4,
              recurrence_index = $5,
              status = $6,
              created_at = $7,
              decided_at = $8,
              room_id = $9,
              requested_by = $10,
              email = $11,
              purpose = $12,
              start_at = $13,
              end_at = $14,
              history = $15::jsonb
            WHERE id = $1
          `,
          [
            booking.id,
            booking.recurrenceGroupId,
            booking.recurrenceType || "none",
            booking.recurrenceCount || 1,
            booking.recurrenceIndex || 1,
            booking.status,
            booking.createdAt,
            booking.decidedAt || null,
            booking.roomId,
            booking.requestedBy,
            booking.email,
            booking.purpose,
            booking.startAt,
            booking.endAt,
            JSON.stringify(booking.history || [])
          ]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async logNotification({ to, subject, text }) {
    await this.pool.query(
      `
        INSERT INTO notification_logs (id, recipient, subject, body, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [randomUUID(), to, subject, text, new Date().toISOString()]
    );
  }
}

function mapBookingRow(row) {
  return {
    id: row.id,
    recurrenceGroupId: row.recurrence_group_id,
    recurrenceType: row.recurrence_type,
    recurrenceCount: row.recurrence_count,
    recurrenceIndex: row.recurrence_index,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    decidedAt: row.decided_at ? toIsoString(row.decided_at) : undefined,
    roomId: row.room_id,
    requestedBy: row.requested_by,
    email: row.email,
    purpose: row.purpose,
    startAt: toIsoString(row.start_at),
    endAt: toIsoString(row.end_at),
    history: row.history || []
  };
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function shouldUseSsl(databaseUrl) {
  const sslMode = process.env.DATABASE_SSL_MODE || "";
  if (sslMode.toLowerCase() === "disable") {
    return false;
  }

  if (sslMode.toLowerCase() === "require") {
    return true;
  }

  return /render\.com|supabase\.co|railway\.app|neon\.tech/i.test(databaseUrl);
}

module.exports = {
  createStorage
};
