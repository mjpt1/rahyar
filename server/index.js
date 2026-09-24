import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { Server } from 'socket.io';

const { Pool } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4000);
const jwtSecret = process.env.JWT_SECRET || 'change-this-secret';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const otpStore = new Map();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true, credentials: true } });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/auth', rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: true }));

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const toInt = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const sign = (user) => jwt.sign({ sub: user.id, role: user.role, phone: user.phone }, jwtSecret, { expiresIn: '7d' });
const verify = (token) => jwt.verify(token, jwtSecret);

function auth(req, _res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return next(fail('برای این عملیات باید وارد شوید.', 401));
  try { req.user = verify(header.slice(7)); next(); } catch { next(fail('نشست شما منقضی شده است.', 401)); }
}

const roleOnly = (...roles) => (req, _res, next) => roles.includes(req.user.role)
  ? next() : next(fail('دسترسی کافی ندارید.', 403));

async function currentUser(id) {
  const { rows } = await pool.query(
    'SELECT id, phone, first_name, last_name, role, driver_status, rating, trips_count, created_at FROM users WHERE id=$1', [id],
  );
  return rows[0];
}

async function initDb() {
  const schema = await readFile(path.join(root, 'server/schema.sql'), 'utf8');
  await pool.query(schema);
  const passwordHash = await bcrypt.hash('unused-otp-account', 10);
  const admin = await pool.query(
    `INSERT INTO users (phone, first_name, last_name, role, driver_status)
     VALUES ('09000000000','مدیر','راه‌یار','admin','approved')
     ON CONFLICT (phone) DO UPDATE SET role='admin' RETURNING id`,
  );
  const driver = await pool.query(
    `INSERT INTO users (phone, first_name, last_name, role, driver_status, rating, trips_count)
     VALUES ('09120000001','حامد','محمدی','driver','approved',4.9,86)
     ON CONFLICT (phone) DO UPDATE SET role='driver', driver_status='approved' RETURNING id`,
  );
  const passenger = await pool.query(
    `INSERT INTO users (phone, first_name, last_name, role)
     VALUES ('09120000002','سارا','احمدی','passenger')
     ON CONFLICT (phone) DO UPDATE SET first_name='سارا', last_name='احمدی' RETURNING id`,
  );
  void admin; void passenger; void passwordHash;
  const driverId = driver.rows[0].id;
  const vehicle = await pool.query(
    `INSERT INTO vehicles (driver_id, model, plate, color, capacity, verified)
     VALUES ($1,'دنا پلاس','۴۵الف۱۲۳ ایران ۱۱','سفید',12,true)
     ON CONFLICT (plate) DO UPDATE SET driver_id=EXCLUDED.driver_id, verified=true RETURNING id`, [driverId],
  );
  const vehicleId = vehicle.rows[0].id;
  const count = await pool.query('SELECT count(*)::int AS count FROM trips');
  if (count.rows[0].count === 0) {
    const samples = [
      ['تهران', 'رشت', 480000, 7, 30, 'ترمینال غرب', 'میدان گیل'],
      ['اصفهان', 'شیراز', 590000, 16, 0, 'میدان آزادی', 'بلوار مدرس'],
      ['مشهد', 'ساری', 630000, 9, 0, 'میدان جانباز', 'بلوار خزر'],
    ];
    for (const [origin, destination, price, hour, minute, boarding, dropoff] of samples) {
      const departure = new Date(Date.now() + 86_400_000);
      departure.setHours(hour, minute, 0, 0);
      const trip = await pool.query(
        `INSERT INTO trips (driver_id, vehicle_id, origin, destination, departure_at, boarding_point, dropoff_point, base_price, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published') RETURNING id`,
        [driverId, vehicleId, origin, destination, departure, boarding, dropoff, price],
      );
      for (let seat = 1; seat <= 12; seat += 1) {
        const seatPrice = seat <= 2 ? Math.round(price * 1.15) : price;
        await pool.query(
          `INSERT INTO trip_seats (trip_id, seat_number, seat_class, price) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [trip.rows[0].id, seat, seat <= 2 ? 'front' : 'standard', seatPrice],
        );
      }
    }
  }
  await pool.query(`INSERT INTO cancellation_rules (hours_before_departure, refund_percent)
    VALUES (48,100),(24,70),(0,0) ON CONFLICT DO NOTHING`);
  await pool.query(`INSERT INTO articles (title, slug, excerpt, body, published)
    VALUES ('راهنمای سفر جاده‌ای سبک‌تر','road-trip-guide','چطور برای یک سفر جاده‌ای هوشمندانه آماده شویم؟','یک برنامه خوب، مسیر روشن و انتخاب راننده مطمئن، سه پایه یک سفر آرام هستند.','true')
    ON CONFLICT (slug) DO NOTHING`);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'rahyar-api', time: new Date().toISOString() }));

app.post('/api/auth/request-otp', asyncRoute(async (req, res) => {
  const phone = String(req.body.phone || '').replace(/\s/g, '');
  const role = ['passenger', 'driver'].includes(req.body.role) ? req.body.role : 'passenger';
  if (!/^09\d{9}$/.test(phone)) throw fail('شماره موبایل معتبر نیست.');
  const code = process.env.NODE_ENV === 'production' ? String(randomInt(100000, 999999)) : '123456';
  otpStore.set(phone, { code, role, expiresAt: Date.now() + Number(process.env.OTP_TTL_SECONDS || 180) * 1000 });
  console.info(`[OTP] ${phone}: ${code}`);
  res.json({ ok: true, message: 'کد تایید ارسال شد.', ...(process.env.NODE_ENV !== 'production' ? { devCode: code } : {}) });
}));

app.post('/api/auth/verify-otp', asyncRoute(async (req, res) => {
  const phone = String(req.body.phone || '').replace(/\s/g, '');
  const code = String(req.body.code || '');
  const saved = otpStore.get(phone);
  if (!saved || saved.expiresAt < Date.now() || saved.code !== code) throw fail('کد تایید اشتباه یا منقضی شده است.', 401);
  otpStore.delete(phone);
  const role = saved.role;
  const result = await pool.query(
    `INSERT INTO users (phone, first_name, last_name, role)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (phone) DO UPDATE SET role=CASE WHEN users.role IN ('admin','driver') THEN users.role ELSE EXCLUDED.role END
     RETURNING id, phone, first_name, last_name, role, driver_status, rating, trips_count, created_at`,
    [phone, req.body.firstName || null, req.body.lastName || null, role],
  );
  const user = result.rows[0];
  res.json({ token: sign(user), user });
}));

app.get('/api/me', auth, asyncRoute(async (req, res) => res.json({ user: await currentUser(req.user.sub) })));

app.get('/api/trips', asyncRoute(async (req, res) => {
  const values = [];
  const filters = [`t.status='published'`, 't.departure_at > now()'];
  if (req.query.origin) { values.push(`%${req.query.origin}%`); filters.push(`t.origin ILIKE $${values.length}`); }
  if (req.query.destination) { values.push(`%${req.query.destination}%`); filters.push(`t.destination ILIKE $${values.length}`); }
  if (req.query.date) { values.push(req.query.date); filters.push(`t.departure_at::date = $${values.length}::date`); }
  const { rows } = await pool.query(
    `SELECT t.id, t.origin, t.destination, t.departure_at, t.arrival_at, t.boarding_point, t.dropoff_point, t.base_price,
      u.first_name || ' ' || u.last_name AS driver_name, u.rating, u.trips_count, v.model AS vehicle_model, v.plate,
      (SELECT count(*) FROM trip_seats ts WHERE ts.trip_id=t.id AND NOT EXISTS (
        SELECT 1 FROM reservation_seats rs JOIN reservations r ON r.id=rs.reservation_id
        WHERE rs.trip_seat_id=ts.id AND r.status IN ('pending','paid','completed')
      ))::int AS available_seats
      FROM trips t JOIN users u ON u.id=t.driver_id JOIN vehicles v ON v.id=t.vehicle_id
      WHERE ${filters.join(' AND ')} ORDER BY t.departure_at LIMIT 50`, values,
  );
  res.json({ trips: rows });
}));

app.get('/api/trips/:id', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, u.first_name || ' ' || u.last_name AS driver_name, u.rating, u.trips_count, u.driver_status,
      v.model AS vehicle_model, v.plate, v.capacity
     FROM trips t JOIN users u ON u.id=t.driver_id JOIN vehicles v ON v.id=t.vehicle_id WHERE t.id=$1`, [toInt(req.params.id)],
  );
  if (!rows[0]) throw fail('سفر پیدا نشد.', 404);
  const seats = await pool.query(
    `SELECT ts.id, ts.seat_number, ts.seat_class, ts.price,
      CASE WHEN r.id IS NULL THEN 'available' ELSE 'occupied' END AS status,
      r.passenger_gender AS occupied_gender
     FROM trip_seats ts LEFT JOIN reservation_seats rs ON rs.trip_seat_id=ts.id
     LEFT JOIN reservations r ON r.id=rs.reservation_id AND r.status IN ('pending','paid','completed')
     WHERE ts.trip_id=$1 ORDER BY ts.seat_number`, [toInt(req.params.id)],
  );
  res.json({ trip: rows[0], seats: seats.rows });
}));

app.post('/api/trips/:id/reservations', auth, roleOnly('passenger', 'admin'), asyncRoute(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tripResult = await client.query('SELECT * FROM trips WHERE id=$1 FOR UPDATE', [toInt(req.params.id)]);
    const trip = tripResult.rows[0];
    if (!trip || !['published', 'started'].includes(trip.status)) throw fail('این سفر برای رزرو در دسترس نیست.', 409);
    if (new Date(trip.departure_at) <= new Date()) throw fail('زمان حرکت این سفر گذشته است.', 409);
    const requested = [...new Set(Array.isArray(req.body.seatIds) ? req.body.seatIds.map(Number) : [])].filter(Number.isInteger);
    if (requested.length < 1 || requested.length > 8) throw fail('تعداد صندلی انتخابی باید بین ۱ تا ۸ باشد.');
    const seatResult = await client.query(
      `SELECT ts.id, ts.price, EXISTS (
        SELECT 1 FROM reservation_seats rs JOIN reservations r ON r.id=rs.reservation_id
        WHERE rs.trip_seat_id=ts.id AND r.status IN ('pending','paid','completed')
      ) AS occupied FROM trip_seats ts WHERE ts.trip_id=$1 AND ts.id=ANY($2::int[])`,
      [trip.id, requested],
    );
    if (seatResult.rows.length !== requested.length) throw fail('یکی از صندلی‌ها در این سفر وجود ندارد.', 409);
    if (seatResult.rows.some((seat) => seat.occupied)) throw fail('یکی از صندلی‌ها هم‌زمان توسط مسافر دیگری رزرو شد.', 409);
    const total = seatResult.rows.reduce((sum, seat) => sum + seat.price, 0);
    const reservation = await client.query(
      `INSERT INTO reservations (passenger_id, trip_id, status, total_amount, passenger_gender)
       VALUES ($1,$2,'paid',$3,$4) RETURNING id, status, total_amount, created_at`,
      [req.user.sub, trip.id, total, req.body.gender || null],
    );
    const reservationId = reservation.rows[0].id;
    for (const seat of seatResult.rows) {
      await client.query('INSERT INTO reservation_seats (reservation_id, trip_seat_id) VALUES ($1,$2)', [reservationId, seat.id]);
    }
    const gatewayRef = `manual-${randomUUID().slice(0, 8)}`;
    await client.query(
      `INSERT INTO payments (reservation_id, amount, status, gateway_ref) VALUES ($1,$2,'paid',$3)`,
      [reservationId, total, gatewayRef],
    );
    await client.query('COMMIT');
    res.status(201).json({ reservation: { ...reservation.rows[0], tripId: trip.id, seatIds: requested, gatewayRef } });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}));

app.get('/api/me/reservations', auth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.status, r.total_amount, r.passenger_gender, r.created_at, r.cancelled_at,
      t.origin, t.destination, t.departure_at, t.boarding_point, t.dropoff_point,
      u.first_name || ' ' || u.last_name AS driver_name, v.model AS vehicle_model, v.plate,
      COALESCE(json_agg(json_build_object('number',ts.seat_number,'price',ts.price) ORDER BY ts.seat_number) FILTER (WHERE ts.id IS NOT NULL),'[]') AS seats
     FROM reservations r JOIN trips t ON t.id=r.trip_id JOIN users u ON u.id=t.driver_id JOIN vehicles v ON v.id=t.vehicle_id
     LEFT JOIN reservation_seats rs ON rs.reservation_id=r.id LEFT JOIN trip_seats ts ON ts.id=rs.trip_seat_id
     WHERE r.passenger_id=$1 GROUP BY r.id,t.id,u.id,v.id ORDER BY t.departure_at DESC`, [req.user.sub],
  );
  res.json({ reservations: rows });
}));

app.post('/api/reservations/:id/cancel', auth, asyncRoute(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT r.*, t.departure_at FROM reservations r JOIN trips t ON t.id=r.trip_id WHERE r.id=$1 FOR UPDATE`, [toInt(req.params.id)],
    );
    const reservation = result.rows[0];
    if (!reservation) throw fail('رزرو پیدا نشد.', 404);
    if (req.user.role !== 'admin' && reservation.passenger_id !== Number(req.user.sub)) throw fail('دسترسی ندارید.', 403);
    if (!['paid', 'pending'].includes(reservation.status)) throw fail('این رزرو قابل لغو نیست.', 409);
    const hours = (new Date(reservation.departure_at).getTime() - Date.now()) / 3_600_000;
    const rule = await client.query(
      `SELECT refund_percent FROM cancellation_rules WHERE hours_before_departure <= $1 ORDER BY hours_before_departure DESC LIMIT 1`, [Math.max(0, hours)],
    );
    const refundPercent = rule.rows[0]?.refund_percent ?? 0;
    const refundAmount = Math.floor(reservation.total_amount * refundPercent / 100);
    await client.query(`UPDATE reservations SET status='cancelled', cancelled_at=now() WHERE id=$1`, [reservation.id]);
    await client.query(`UPDATE payments SET status='refunded', amount=$2 WHERE reservation_id=$1`, [reservation.id, refundAmount]);
    await client.query('COMMIT');
    res.json({ ok: true, refundPercent, refundAmount });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}));

app.get('/api/articles', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`SELECT id,title,slug,excerpt,cover_url,created_at FROM articles WHERE published=true ORDER BY created_at DESC`);
  res.json({ articles: rows });
}));

app.get('/api/driver/trips', auth, roleOnly('driver', 'admin'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, v.model AS vehicle_model, v.plate,
      (SELECT count(*)::int FROM reservations r WHERE r.trip_id=t.id AND r.status IN ('paid','completed')) AS reservations_count
     FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.driver_id=$1 ORDER BY t.departure_at DESC`, [req.user.sub],
  );
  res.json({ trips: rows });
}));

app.post('/api/driver/vehicles', auth, roleOnly('driver'), asyncRoute(async (req, res) => {
  const { model, plate, color, capacity } = req.body;
  if (!model || !plate || !Number(capacity)) throw fail('اطلاعات خودرو کامل نیست.');
  const { rows } = await pool.query(
    `INSERT INTO vehicles (driver_id,model,plate,color,capacity) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.sub, model, plate, color || null, Number(capacity)],
  );
  res.status(201).json({ vehicle: rows[0] });
}));

app.get('/api/driver/vehicles', auth, roleOnly('driver'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM vehicles WHERE driver_id=$1 ORDER BY id DESC', [req.user.sub]);
  res.json({ vehicles: rows });
}));

app.post('/api/driver/documents', auth, roleOnly('driver'), asyncRoute(async (req, res) => {
  const allowed = ['national_card', 'license', 'car_card', 'insurance'];
  if (!allowed.includes(req.body.documentType)) throw fail('نوع مدرک معتبر نیست.');
  const { rows } = await pool.query(
    `INSERT INTO driver_documents (driver_id,document_type,file_url,status) VALUES ($1,$2,$3,'pending')
     ON CONFLICT (driver_id,document_type) DO UPDATE SET file_url=EXCLUDED.file_url,status='pending',reviewed_at=NULL RETURNING *`,
    [req.user.sub, req.body.documentType, req.body.fileUrl || null],
  );
  res.status(201).json({ document: rows[0] });
}));

app.post('/api/driver/trips', auth, roleOnly('driver'), asyncRoute(async (req, res) => {
  const driver = await currentUser(req.user.sub);
  if (driver.driver_status !== 'approved') throw fail('پس از تایید مدارک می‌توانید سفر ثبت کنید.', 403);
  const { origin, destination, departureAt, arrivalAt, boardingPoint, dropoffPoint, basePrice, vehicleId } = req.body;
  if (!origin || !destination || !departureAt || !Number(basePrice)) throw fail('اطلاعات سفر کامل نیست.');
  const vehicle = await pool.query('SELECT * FROM vehicles WHERE id=$1 AND driver_id=$2 AND verified=true', [vehicleId, req.user.sub]);
  if (!vehicle.rows[0]) throw fail('خودروی تاییدشده‌ای برای این سفر انتخاب نشده است.', 403);
  const trip = await pool.query(
    `INSERT INTO trips (driver_id,vehicle_id,origin,destination,departure_at,arrival_at,boarding_point,dropoff_point,base_price,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') RETURNING *`,
    [req.user.sub, vehicleId, origin, destination, departureAt, arrivalAt || null, boardingPoint || null, dropoffPoint || null, Number(basePrice)],
  );
  for (let seat = 1; seat <= vehicle.rows[0].capacity; seat += 1) {
    await pool.query(`INSERT INTO trip_seats (trip_id,seat_number,seat_class,price) VALUES ($1,$2,$3,$4)`,
      [trip.rows[0].id, seat, seat <= 2 ? 'front' : 'standard', seat <= 2 ? Math.round(Number(basePrice) * 1.15) : Number(basePrice)]);
  }
  res.status(201).json({ trip: trip.rows[0] });
}));

app.post('/api/driver/trips/:id/start', auth, roleOnly('driver'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`UPDATE trips SET status='started' WHERE id=$1 AND driver_id=$2 RETURNING *`, [toInt(req.params.id), req.user.sub]);
  if (!rows[0]) throw fail('سفر پیدا نشد.', 404);
  res.json({ trip: rows[0] });
}));

app.post('/api/driver/location', auth, roleOnly('driver'), asyncRoute(async (req, res) => {
  const tripId = toInt(req.body.tripId);
  const lat = Number(req.body.lat); const lng = Number(req.body.lng);
  if (!tripId || !Number.isFinite(lat) || !Number.isFinite(lng)) throw fail('موقعیت معتبر نیست.');
  const trip = await pool.query(`SELECT id FROM trips WHERE id=$1 AND driver_id=$2`, [tripId, req.user.sub]);
  if (!trip.rows[0]) throw fail('سفر پیدا نشد.', 404);
  await pool.query(`INSERT INTO driver_locations (driver_id,trip_id,lat,lng) VALUES ($1,$2,$3,$4)
    ON CONFLICT (driver_id) DO UPDATE SET trip_id=EXCLUDED.trip_id,lat=EXCLUDED.lat,lng=EXCLUDED.lng,updated_at=now()`, [req.user.sub, tripId, lat, lng]);
  io.to(`trip:${tripId}`).emit('driver:location', { tripId, lat, lng, updatedAt: new Date().toISOString() });
  res.json({ ok: true });
}));

app.get('/api/trips/:id/location', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT dl.driver_id, dl.trip_id, dl.lat, dl.lng, dl.updated_at FROM driver_locations dl WHERE dl.trip_id=$1`, [toInt(req.params.id)],
  );
  res.json({ location: rows[0] || null });
}));

app.get('/api/admin/stats', auth, roleOnly('admin'), asyncRoute(async (_req, res) => {
  const [users, drivers, trips, revenue, reservations] = await Promise.all([
    pool.query(`SELECT count(*)::int AS value FROM users WHERE role='passenger'`),
    pool.query(`SELECT count(*)::int AS value FROM users WHERE role='driver' AND driver_status='approved'`),
    pool.query(`SELECT count(*)::int AS value FROM trips WHERE status IN ('published','started','completed')`),
    pool.query(`SELECT COALESCE(sum(amount),0)::int AS value FROM payments WHERE status='paid'`),
    pool.query(`SELECT count(*)::int AS value FROM reservations WHERE status IN ('paid','completed')`),
  ]);
  res.json({ stats: { passengers: users.rows[0].value, activeDrivers: drivers.rows[0].value, trips: trips.rows[0].value, revenue: revenue.rows[0].value, reservations: reservations.rows[0].value } });
}));

app.get('/api/admin/drivers', auth, roleOnly('admin'), asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id,u.phone,u.first_name,u.last_name,u.driver_status,u.rating,u.trips_count,u.created_at,
      COALESCE(json_agg(json_build_object('type',dd.document_type,'status',dd.status,'url',dd.file_url)) FILTER (WHERE dd.id IS NOT NULL),'[]') AS documents
     FROM users u LEFT JOIN driver_documents dd ON dd.driver_id=u.id WHERE u.role='driver' GROUP BY u.id ORDER BY u.created_at DESC`,
  );
  res.json({ drivers: rows });
}));

app.patch('/api/admin/drivers/:id/verify', auth, roleOnly('admin'), asyncRoute(async (req, res) => {
  const status = ['approved', 'rejected', 'pending'].includes(req.body.status) ? req.body.status : null;
  if (!status) throw fail('وضعیت تایید معتبر نیست.');
  const { rows } = await pool.query(`UPDATE users SET driver_status=$1 WHERE id=$2 AND role='driver' RETURNING id,driver_status`, [status, toInt(req.params.id)]);
  if (!rows[0]) throw fail('راننده پیدا نشد.', 404);
  await pool.query(`UPDATE driver_documents SET status=$1,reviewed_at=now() WHERE driver_id=$2`, [status, rows[0].id]);
  res.json({ driver: rows[0] });
}));

app.post('/api/admin/trips/:id/publish', auth, roleOnly('admin'), asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`UPDATE trips SET status='published' WHERE id=$1 AND status IN ('pending','draft') RETURNING *`, [toInt(req.params.id)]);
  if (!rows[0]) throw fail('سفر برای انتشار پیدا نشد.', 404);
  res.json({ trip: rows[0] });
}));

app.post('/api/admin/articles', auth, roleOnly('admin'), asyncRoute(async (req, res) => {
  const { title, slug, excerpt, body, coverUrl, published = false } = req.body;
  if (!title || !slug || !body) throw fail('عنوان، نامک و متن مقاله الزامی است.');
  const { rows } = await pool.query(
    `INSERT INTO articles (title,slug,excerpt,body,cover_url,published) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [title, slug, excerpt || null, body, coverUrl || null, Boolean(published)],
  );
  res.status(201).json({ article: rows[0] });
}));

io.on('connection', (socket) => {
  socket.on('trip:join', (tripId) => {
    const id = toInt(tripId);
    if (id) socket.join(`trip:${id}`);
  });
  socket.on('trip:leave', (tripId) => socket.leave(`trip:${toInt(tripId)}`));
});

app.use(express.static(path.join(root, 'public'), { extensions: ['html'] }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next(fail('مسیر API پیدا نشد.', 404));
  return res.sendFile(path.join(root, 'public/index.html'));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status || (error.code === '23505' ? 409 : 500);
  const message = error.code === '23505' ? 'این اطلاعات قبلاً ثبت شده است.' : (status === 500 ? 'خطای داخلی سرور.' : error.message);
  res.status(status).json({ error: message });
});

async function boot() {
  await initDb();
  httpServer.listen(port, () => console.log(`RahyAR is running at http://localhost:${port}`));
}

boot().catch((error) => {
  console.error('Could not start RahyAR:', error);
  process.exitCode = 1;
});
