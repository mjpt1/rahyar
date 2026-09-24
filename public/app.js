const API = '/api';
const state = { user: null, trip: null, seats: [], selectedSeats: [], pendingReservation: null, socket: null };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
$('#travelDate').value = tomorrow.toISOString().slice(0, 10);
$('#travelDate').min = new Date().toISOString().slice(0, 10);
const money = (value) => `${Number(value || 0).toLocaleString('fa-IR')} تومان`;
const dateTime = (value) => new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const dateOnly = (value) => new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(new Date(value));
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('') || 'ر';
const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = localStorage.getItem('rahyar_token');
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'خطایی رخ داد.');
  return data;
}

function toast(message) {
  const element = $('#toast'); element.textContent = message; element.classList.add('show');
  window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => element.classList.remove('show'), 2800);
}

function openModal(id) { $(`#${id}`).classList.add('show'); }
function closeModal(id) { $(`#${id}`).classList.remove('show'); }

function renderTrips(trips) {
  const list = $('#tripList');
  if (!trips.length) { list.innerHTML = '<div class="empty">برای این مسیر سفری پیدا نشد. مسیر یا تاریخ دیگری را امتحان کنید.</div>'; return; }
  list.innerHTML = trips.map((trip) => `
    <article class="trip-card">
      <div class="trip-meta"><span class="trip-tag">${trip.available_seats} صندلی باقی مانده</span><span class="trip-date">${dateTime(trip.departure_at)}</span></div>
      <div class="trip-route"><div class="city"><strong>${escapeHTML(trip.origin)}</strong><small>${escapeHTML(trip.boarding_point || 'نقطه سوار شدن')}</small></div><div class="route-line"></div><div class="city"><strong>${escapeHTML(trip.destination)}</strong><small>${escapeHTML(trip.dropoff_point || 'نقطه پیاده شدن')}</small></div></div>
      <div class="trip-bottom"><div class="driver"><span class="driver-avatar">${escapeHTML(initials(trip.driver_name))}</span><div><span class="driver-name">${escapeHTML(trip.driver_name)}</span><span class="rating">★ ${trip.rating || '۵.۰'} · ${trip.trips_count || 0} سفر</span></div></div><div class="price"><strong>${money(trip.base_price)}</strong><small>شروع قیمت / صندلی</small><button class="choose-seat" data-trip-id="${trip.id}">انتخاب صندلی</button></div></div>
    </article>`).join('');
  $$('.choose-seat').forEach((button) => button.addEventListener('click', () => openSeatModal(button.dataset.tripId)));
}

async function loadTrips(params = {}) {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value));
  $('#tripList').innerHTML = '<div class="loading">در حال دریافت سفرها...</div>';
  try {
    const data = await request(`/trips${search.toString() ? `?${search}` : ''}`);
    renderTrips(data.trips);
    $('#resultHint').textContent = `${data.trips.length.toLocaleString('fa-IR')} سفر پیدا شد`;
  } catch (error) { $('#tripList').innerHTML = `<div class="empty">${escapeHTML(error.message)}</div>`; }
}

async function openSeatModal(tripId) {
  try {
    const data = await request(`/trips/${tripId}`); state.trip = data.trip; state.seats = data.seats; state.selectedSeats = [];
    $('#seatTripTitle').textContent = `${data.trip.origin} به ${data.trip.destination} · ${dateTime(data.trip.departure_at)}`;
    renderSeatGrid(); updateBookingSummary(); openModal('seatModal');
    if (state.socket) state.socket.emit('trip:join', Number(tripId));
  } catch (error) { toast(error.message); }
}

function renderSeatGrid() {
  $('#seatGrid').innerHTML = state.seats.map((seat) => {
    const selected = state.selectedSeats.includes(seat.id);
    return `<button class="seat${selected ? ' selected' : ''}" data-seat-id="${seat.id}" ${seat.status === 'occupied' ? 'disabled' : ''}>${seat.seat_number}</button>`;
  }).join('');
  $$('.seat:not(:disabled)').forEach((button) => button.addEventListener('click', () => {
    const id = Number(button.dataset.seatId);
    state.selectedSeats = state.selectedSeats.includes(id) ? state.selectedSeats.filter((seatId) => seatId !== id) : [...state.selectedSeats, id];
    renderSeatGrid(); updateBookingSummary();
  }));
}

function updateBookingSummary() {
  const selected = state.seats.filter((seat) => state.selectedSeats.includes(seat.id));
  $('#selectedSeatsLabel').textContent = selected.length ? `صندلی‌های ${selected.map((seat) => seat.seat_number).join('، ')} · ${selected.length} نفر` : 'صندلی انتخاب نشده';
  $('#selectedTotal').textContent = money(selected.reduce((total, seat) => total + Number(seat.price), 0));
}

async function completeReservation() {
  if (!state.selectedSeats.length) { toast('لطفاً ابتدا یک صندلی انتخاب کنید.'); return; }
  if (!state.user) {
    state.pendingReservation = { tripId: state.trip.id, seatIds: state.selectedSeats };
    $('#authMessage').textContent = 'برای ادامه رزرو، ابتدا وارد شوید.'; openModal('authModal'); return;
  }
  try {
    const result = await request(`/trips/${state.trip.id}/reservations`, { method: 'POST', body: JSON.stringify({ seatIds: state.selectedSeats }) });
    closeModal('seatModal'); toast(`رزرو شما با شماره ${result.reservation.id} ثبت شد.`); state.pendingReservation = null; openDashboard();
  } catch (error) { toast(error.message); await openSeatModal(state.trip.id); }
}

async function loadArticles() {
  try {
    const { articles } = await request('/articles');
    $('#articleList').innerHTML = articles.length ? articles.map((article, index) => `<article class="article ${index % 2 ? 'yellow' : ''}"><small>مجله راه‌یار · ${dateOnly(article.created_at)}</small><h3>${escapeHTML(article.title)}</h3><p>${escapeHTML(article.excerpt || '')}</p><span class="arrow">↙</span></article>`).join('') : '<div class="empty">هنوز مقاله‌ای منتشر نشده است.</div>';
  } catch { $('#articleList').innerHTML = '<div class="empty">مجله راه‌یار به‌زودی به‌روزرسانی می‌شود.</div>'; }
}

function setUser(user, token) {
  state.user = user;
  if (token) localStorage.setItem('rahyar_token', token);
  $('#loginButton').textContent = user ? `${user.first_name || 'حساب'} ${user.last_name || ''}`.trim() : 'ورود / ثبت‌نام';
}

async function restoreSession() {
  if (!localStorage.getItem('rahyar_token')) return;
  try { const { user } = await request('/me'); setUser(user); } catch { localStorage.removeItem('rahyar_token'); }
}

async function handleAuth(event) {
  event.preventDefault();
  const phone = $('#phone').value.replace(/\s/g, '');
  const submit = $('#authSubmit');
  try {
    if ($('#otpBox').classList.contains('hidden')) {
      const result = await request('/auth/request-otp', { method: 'POST', body: JSON.stringify({ phone, role: $('#authRole').value }) });
      $('#otpBox').classList.remove('hidden'); $('#authRole').disabled = true; submit.textContent = 'ورود به حساب';
      $('#authMessage').textContent = result.devCode ? `کد محیط توسعه: ${result.devCode}` : result.message;
      $('#otpCode').focus();
    } else {
      const names = $('#fullName').value.trim().split(/\s+/);
      const result = await request('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ phone, code: $('#otpCode').value, role: $('#authRole').value, firstName: names[0] || null, lastName: names.slice(1).join(' ') || null }) });
      setUser(result.user, result.token); closeModal('authModal'); toast(`خوش آمدید ${result.user.first_name || 'به راه‌یار'}`);
      if (state.pendingReservation) await completeReservation();
    }
  } catch (error) { $('#authMessage').textContent = error.message; }
}

function resetAuth() {
  $('#authForm').reset(); $('#otpBox').classList.add('hidden'); $('#authRole').disabled = false; $('#authSubmit').textContent = 'دریافت کد تایید'; $('#authMessage').textContent = '';
}

async function renderPassengerDashboard() {
  const { reservations } = await request('/me/reservations');
  $('#dashboardRole').textContent = 'مسافر';
  $('#dashboardContent').innerHTML = `<h3>رزروهای من</h3>${reservations.length ? `<div class="reservation-list">${reservations.map((item) => `<div class="reservation"><div><strong>${escapeHTML(item.origin)} ← ${escapeHTML(item.destination)}</strong><small>${dateTime(item.departure_at)} · صندلی ${item.seats.map((seat) => seat.number).join('، ') || '-'}</small><small>${money(item.total_amount)} · ${item.status === 'cancelled' ? 'لغوشده' : item.status === 'paid' ? 'پرداخت‌شده' : item.status}</small></div>${['paid','pending'].includes(item.status) ? `<button class="cancel" data-reservation-id="${item.id}">لغو رزرو</button>` : ''}</div>`).join('')}</div>` : '<p>هنوز رزروی ثبت نکرده‌اید.</p>'}`;
  $$('.cancel').forEach((button) => button.addEventListener('click', () => cancelReservation(button.dataset.reservationId)));
}

async function renderDriverDashboard() {
  const { trips } = await request('/driver/trips');
  $('#dashboardRole').textContent = `راننده · ${state.user.driver_status === 'approved' ? 'تاییدشده' : 'در انتظار تایید'}`;
  $('#dashboardContent').innerHTML = `<h3>سفرهای من</h3>${state.user.driver_status !== 'approved' ? '<p>پس از بارگذاری مدارک و تایید مدیر، امکان ثبت سفر فعال می‌شود.</p>' : ''}${trips.length ? `<div class="reservation-list">${trips.map((trip) => `<div class="reservation"><div><strong>${escapeHTML(trip.origin)} ← ${escapeHTML(trip.destination)}</strong><small>${dateTime(trip.departure_at)} · ${trip.reservations_count} رزرو</small><small>وضعیت: ${trip.status}</small></div>${trip.status === 'published' ? `<button class="cancel start-trip" data-trip-id="${trip.id}">شروع سفر</button>` : ''}</div>`).join('')}</div>` : '<p>هنوز سفری ثبت نکرده‌اید.</p>'}`;
  $$('.start-trip').forEach((button) => button.addEventListener('click', () => startTrip(button.dataset.tripId)));
}

async function renderAdminDashboard() {
  const [{ stats }, { drivers }] = await Promise.all([request('/admin/stats'), request('/admin/drivers')]);
  $('#dashboardRole').textContent = 'مدیر سیستم';
  $('#dashboardContent').innerHTML = `<div class="admin-grid"><div class="admin-stat"><b>${stats.passengers.toLocaleString('fa-IR')}</b><span>مسافر</span></div><div class="admin-stat"><b>${stats.activeDrivers.toLocaleString('fa-IR')}</b><span>راننده فعال</span></div><div class="admin-stat"><b>${stats.trips.toLocaleString('fa-IR')}</b><span>سفر</span></div><div class="admin-stat"><b>${money(stats.revenue)}</b><span>درآمد ثبت‌شده</span></div></div><h3 style="margin-top:20px">رانندگان</h3><div class="reservation-list">${drivers.map((driver) => `<div class="reservation"><div><strong>${escapeHTML(`${driver.first_name || ''} ${driver.last_name || ''}`)}</strong><small>${driver.phone} · ${driver.documents.length} مدرک</small><small>وضعیت: ${driver.driver_status}</small></div><button class="cancel verify-driver" data-driver-id="${driver.id}" data-status="${driver.driver_status === 'approved' ? 'rejected' : 'approved'}">${driver.driver_status === 'approved' ? 'رد تایید' : 'تایید راننده'}</button></div>`).join('')}</div>`;
  $$('.verify-driver').forEach((button) => button.addEventListener('click', () => verifyDriver(button.dataset.driverId, button.dataset.status)));
}

async function openDashboard() {
  if (!state.user) { resetAuth(); openModal('authModal'); return; }
  openModal('dashboardModal'); $('#dashboardContent').innerHTML = '<div class="loading">در حال دریافت اطلاعات...</div>';
  try {
    if (state.user.role === 'admin') await renderAdminDashboard();
    else if (state.user.role === 'driver') await renderDriverDashboard();
    else { $('#dashboardTitle').textContent = 'پنل مسافر'; await renderPassengerDashboard(); }
  } catch (error) { $('#dashboardContent').innerHTML = `<p>${escapeHTML(error.message)}</p>`; }
}

async function cancelReservation(id) {
  if (!window.confirm('آیا از لغو این رزرو مطمئن هستید؟')) return;
  try { const result = await request(`/reservations/${id}/cancel`, { method: 'POST' }); toast(`رزرو لغو شد؛ بازگشت وجه: ${result.refundPercent}%`); await renderPassengerDashboard(); } catch (error) { toast(error.message); }
}

async function startTrip(id) {
  try { await request(`/driver/trips/${id}/start`, { method: 'POST' }); toast('سفر شروع شد. موقعیت زنده فعال است.'); await renderDriverDashboard(); } catch (error) { toast(error.message); }
}

async function verifyDriver(id, status) {
  try { await request(`/admin/drivers/${id}/verify`, { method: 'PATCH', body: JSON.stringify({ status }) }); toast('وضعیت راننده به‌روزرسانی شد.'); await renderAdminDashboard(); } catch (error) { toast(error.message); }
}

function connectLiveLocation() {
  if (typeof window.io !== 'function') return;
  state.socket = window.io({ autoConnect: true, transports: ['websocket', 'polling'] });
  state.socket.on('driver:location', (location) => toast(`موقعیت راننده به‌روزرسانی شد: ${Number(location.lat).toFixed(3)}, ${Number(location.lng).toFixed(3)}`));
}

$('#searchForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  await loadTrips({ origin: $('#origin').value, destination: $('#destination').value, date: $('#travelDate').value });
  $('#trips').scrollIntoView({ behavior: 'smooth' });
});
$('#reserveButton').addEventListener('click', completeReservation);
$('#authForm').addEventListener('submit', handleAuth);
$('#loginButton').addEventListener('click', () => { resetAuth(); openModal('authModal'); });
$('#dashboardButton').addEventListener('click', openDashboard);
$('#driverCta').addEventListener('click', () => { resetAuth(); $('#authRole').value = 'driver'; openModal('authModal'); });
$('#driverTab').addEventListener('click', () => { resetAuth(); $('#authRole').value = 'driver'; openModal('authModal'); });
$('#menuButton').addEventListener('click', () => $('.nav').classList.toggle('open'));
$$('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
$$('.modal-layer').forEach((layer) => layer.addEventListener('click', (event) => { if (event.target === layer) closeModal(layer.id); }));

window.addEventListener('beforeunload', () => { if (state.socket) state.socket.disconnect(); });
await restoreSession();
connectLiveLocation();
await Promise.all([loadTrips(), loadArticles()]);
