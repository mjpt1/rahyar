CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) UNIQUE NOT NULL,
  first_name VARCHAR(80),
  last_name VARCHAR(80),
  national_id VARCHAR(20),
  role VARCHAR(20) NOT NULL DEFAULT 'passenger' CHECK (role IN ('passenger','driver','admin')),
  driver_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (driver_status IN ('pending','approved','rejected')),
  rating NUMERIC(2,1) NOT NULL DEFAULT 5.0,
  trips_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vehicles (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model VARCHAR(100) NOT NULL,
  plate VARCHAR(30) NOT NULL UNIQUE,
  color VARCHAR(40),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 20),
  verified BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS trips (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES users(id),
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  origin VARCHAR(100) NOT NULL,
  destination VARCHAR(100) NOT NULL,
  departure_at TIMESTAMPTZ NOT NULL,
  arrival_at TIMESTAMPTZ,
  boarding_point VARCHAR(160),
  dropoff_point VARCHAR(160),
  base_price INTEGER NOT NULL CHECK (base_price > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'published' CHECK (status IN ('draft','pending','published','started','completed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trip_seats (
  id SERIAL PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seat_number INTEGER NOT NULL,
  seat_class VARCHAR(20) NOT NULL DEFAULT 'standard' CHECK (seat_class IN ('front','standard','vip')),
  price INTEGER NOT NULL,
  UNIQUE (trip_id, seat_number)
);
CREATE TABLE IF NOT EXISTS reservations (
  id SERIAL PRIMARY KEY,
  passenger_id INTEGER NOT NULL REFERENCES users(id),
  trip_id INTEGER NOT NULL REFERENCES trips(id),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','cancelled','completed')),
  total_amount INTEGER NOT NULL,
  passenger_gender VARCHAR(10) CHECK (passenger_gender IN ('female','male','other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS reservation_seats (
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  trip_seat_id INTEGER NOT NULL REFERENCES trip_seats(id),
  PRIMARY KEY (reservation_id, trip_seat_id)
);
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  amount INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','refunded','failed')),
  gateway_ref VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS driver_documents (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type VARCHAR(40) NOT NULL,
  file_url TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (driver_id, document_type)
);
CREATE TABLE IF NOT EXISTS driver_locations (
  driver_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  lat NUMERIC(10,7) NOT NULL,
  lng NUMERIC(10,7) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  slug VARCHAR(220) UNIQUE NOT NULL,
  excerpt TEXT,
  body TEXT NOT NULL,
  cover_url TEXT,
  published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cancellation_rules (
  id SERIAL PRIMARY KEY,
  hours_before_departure INTEGER NOT NULL,
  refund_percent INTEGER NOT NULL CHECK (refund_percent BETWEEN 0 AND 100),
  UNIQUE(hours_before_departure)
);
CREATE INDEX IF NOT EXISTS trips_search_idx ON trips(origin, destination, departure_at);
CREATE INDEX IF NOT EXISTS reservations_passenger_idx ON reservations(passenger_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reservation_seats_seat_idx ON reservation_seats(trip_seat_id);
