import { scrypt } from 'scrypt-js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const q1 = async (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const qa = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const qr = async (db, sql, ...args) => db.prepare(sql).bind(...args).run();
const json = (data, status = 200, cookies = []) => {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(JSON.stringify(data), { status, headers });
};
const fail = (status, error) => json({ error }, status);
const safe = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const int = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const hex = bytes => [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
const fromHex = value => Uint8Array.from(value.match(/.{2}/g) || [], x => parseInt(x, 16));
const random = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const hash = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))));
const equal = (a, b) => { const x = enc.encode(String(a)), y = enc.encode(String(b)); let diff = x.length ^ y.length; for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0); return diff === 0; };
const cookie = request => Object.fromEntries((request.headers.get('cookie') || '').split(';').map(x => x.trim().split('=').slice(0, 2)).filter(x => x.length === 2));
const setCookie = (name, value, maxAge = 604800) => `${name}=${value}; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=${maxAge}`;
const money = n => new Intl.NumberFormat('vi-VN').format(n) + '₫';
const slugify = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const productUrl = p => `/san-pham/${p.id}-${slugify(p.name) || 'san-pham'}`;
const publicProduct = p => { const { views, cart_adds, deleted, ...rest } = p; return { ...rest, slug: productUrl(p).split('/').pop(), url: productUrl(p) }; };
const adminProduct = p => ({ ...p, views: Number(p.views || 0), cart_adds: Number(p.cart_adds || 0), slug: productUrl(p).split('/').pop(), url: productUrl(p) });
const maskPhone = phone => { const v = String(phone || '').trim(); return !v ? '' : v.length <= 5 ? '***' : v.slice(0, 3) + '*'.repeat(Math.max(4, v.length - 6)) + v.slice(-3); };
const maskAddress = value => value ? '*** (Nhập mật khẩu admin để xem)' : '';
const rate = new Map();
function limited(key, max = 5, windowMs = 900000) { const now = Date.now(), hit = rate.get(key); return hit && hit.until > now ? true : false; }
function failed(key, max = 5, windowMs = 900000) { const now = Date.now(), hit = rate.get(key) || { count: 0, until: 0 }; hit.count++; if (hit.count >= max) hit.until = now + windowMs; rate.set(key, hit); }
async function body(request, max = 100000) { if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new Error('Yêu cầu phải là JSON.'); const raw = await request.text(); if (raw.length > max) throw new Error('Dữ liệu quá lớn.'); try { return JSON.parse(raw); } catch { throw new Error('JSON không hợp lệ.'); } }
async function settings(db) { return Object.fromEntries((await qa(db, 'SELECT key,value FROM settings')).map(x => [x.key, x.value])); }
function publicSettings(s) { const accountNo = (s.bank_account_no || '937799180').trim(); return { accepting_orders: s.accepting_orders === '1', shipping_fee: s.shipping_fee === '' || s.shipping_fee == null ? null : Number(s.shipping_fee), shipping_area: s.shipping_area || '', cod_enabled: s.cod_enabled !== '0', bank_available: Boolean(s.bank_enabled !== '0' && (accountNo || s.bank_details)), bank_name: s.bank_name || 'VIB', bank_bin: s.bank_bin || '970441', bank_account_no: accountNo, bank_account_name: s.bank_account_name || '', phone: s.phone || '', email: s.email || 'Anvathouse@gmail.com', hero_title: s.hero_title || '', hero_text: s.hero_text || '', hero_image: s.hero_image || '', about_text: s.about_text || '', shipping_policy: s.shipping_policy || '', return_policy: s.return_policy || '', password_reset_enabled: false }; }
function vietQr(order, s) { if (order.payment !== 'bank') return null; const bin = (s.bank_bin || '970441').trim(), accountNo = (s.bank_account_no || '937799180').trim(), accountName = (s.bank_account_name || '').trim(); const params = new URLSearchParams({ amount: String(order.total), addInfo: order.code }); if (accountName) params.set('accountName', accountName); return { bank_name: s.bank_name || 'VIB', bin, account_no: accountNo, account_name: accountName || null, amount: Number(order.total), content: order.code, qr_url: `https://img.vietqr.io/image/${encodeURIComponent(bin)}-${encodeURIComponent(accountNo)}-compact2.png?${params}` }; }
function orderView(order, s) { const paid = !!order.payment_paid; const items = JSON.parse(order.items || '[]').map(item => ({ ...item, price: Number(item.price), qty: Number(item.qty), line_total: Number(item.price) * Number(item.qty), image_url: item.image ? item.image.startsWith('/') ? item.image : `/assets/products/${item.image}` : '' })); return { ...order, items, subtotal: Number(order.subtotal), shipping_fee: Number(order.shipping_fee), total: Number(order.total), payment_paid: paid, payment_status_label: paid ? 'Đã thanh toán' : order.payment === 'bank' ? 'Chờ xác nhận thanh toán' : 'Thanh toán khi nhận hàng', status_history: JSON.parse(order.status_history || '[]'), vietqr: vietQr(order, s), bank_details: order.payment === 'bank' ? s.bank_details || '' : '' }; }
async function listProducts(db) { return qa(db, 'SELECT * FROM products WHERE deleted=0 ORDER BY id'); }
function findProduct(param, products) { const clean = decodeURIComponent(String(param || '').trim()).toLowerCase(); if (/^\d+$/.test(clean)) return products.find(p => p.id === Number(clean)); const m = clean.match(/^(\d+)-(.+)$/); if (m) { const p = products.find(p => p.id === Number(m[1])); if (p && slugify(p.name) === m[2]) return p; } return products.find(p => slugify(p.name) === clean || productUrl(p).split('/').pop() === clean); }
async function actor(request, db) { const c = cookie(request); let adminHash = null, customer = null; if (/^[a-f0-9]{64}$/.test(c.avh_session || '')) { const h = await hash(c.avh_session); if (await q1(db, 'SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?', h, Date.now())) adminHash = h; } const token = c.avh_customer_session || (!adminHash ? c.avh_session : ''); if (/^[a-f0-9]{64}$/.test(token || '')) { const row = await q1(db, 'SELECT customer_id FROM customer_sessions WHERE token_hash=? AND expires_at>?', await hash(token), Date.now()); if (row) customer = await q1(db, 'SELECT id,email,name,phone,address,created_at FROM customers WHERE id=?', row.customer_id); } return { adminHash: customer ? null : adminHash, customer }; }
function customerView(c) { return c ? { id: c.id, email: c.email, name: c.name, phone: c.phone, address: c.address, created_at: c.created_at } : null; }
function dailyStats(orders, products, s) { const counts = { new: 0, preparing: 0, shipping: 0, complete: 0, cancelled: 0 }; let revenue = 0, todayRevenue = 0; const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10); const days = []; for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() + 7 * 3600000 - i * 86400000), key = d.toISOString().slice(0, 10); days.push({ date: key, label: `${key.slice(8)}/${key.slice(5, 7)}`, day_name: ['CN','Th 2','Th 3','Th 4','Th 5','Th 6','Th 7'][d.getUTCDay()], count: 0, new: 0, preparing: 0, shipping: 0, completed: 0, cancelled: 0, revenue: 0 }); } for (const o of orders) { if (counts[o.status] != null) counts[o.status]++; const date = new Date(new Date(o.created_at).getTime() + 7 * 3600000).toISOString().slice(0, 10); if (o.status === 'complete') { revenue += Number(o.total); if (date === today) todayRevenue += Number(o.total); } const d = days.find(x => x.date === date); if (d) { d.count++; if (o.status === 'complete') { d.completed++; d.revenue += Number(o.total); } else if (d[o.status] != null) d[o.status]++; } } const ranked = products.map(adminProduct); return { counts, total_orders: orders.length, new_orders: counts.new, preparing_orders: counts.preparing, shipping_orders: counts.shipping, preparing_shipping_orders: counts.preparing + counts.shipping, completed_orders: counts.complete, cancelled_orders: counts.cancelled, revenue, today_revenue: todayRevenue, low_stock_products: products.filter(p => p.stock < 5).map(p => ({ id: p.id, name: p.name, stock: p.stock, category: p.category, active: !!p.active })), orders_by_day: days, product_analytics: { stats_started_at: s.stats_started_at || null, total_views: products.reduce((n,p) => n + p.views, 0), total_cart_adds: products.reduce((n,p) => n + p.cart_adds, 0), most_viewed: [...ranked].sort((a,b) => b.views - a.views || a.id - b.id).slice(0, 3), most_cart_added: [...ranked].sort((a,b) => b.cart_adds - a.cart_adds || a.id - b.id).slice(0, 3) } }; }
async function adminCustomers(db, query = '') { const q = String(query).trim().toLocaleLowerCase('vi'), phoneQ = q.replace(/[ .-]/g, ''); const rows = await qa(db, 'SELECT id,name,email,phone,created_at FROM customers ORDER BY id DESC'); return Promise.all(rows.filter(c => !q || (c.name || '').toLocaleLowerCase('vi').includes(q) || c.email.toLocaleLowerCase('vi').includes(q) || (c.phone || '').includes(phoneQ)).map(async c => { const stats = await q1(db, "SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN status!='cancelled' THEN total ELSE 0 END),0) AS total_spent, COALESCE(SUM(CASE WHEN status='complete' THEN total ELSE 0 END),0) AS completed_spent FROM orders WHERE customer_id=?", c.id); const latest = await q1(db, 'SELECT code,total,status,created_at FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 1', c.id); return { ...c, phone: maskPhone(c.phone), phone_masked: maskPhone(c.phone), order_count: stats.count, total_spent: stats.total_spent, completed_spent: stats.completed_spent, latest_order: latest || null }; })); }
function customerSummary(customers, guestCount) { const top = [...customers].filter(c => c.order_count).sort((a,b) => b.total_spent - a.total_spent || b.order_count - a.order_count)[0]; return { total_registered: customers.length, returning_customers: customers.filter(c => c.order_count >= 2).length, guest_order_count: guestCount, top_customer: top ? { id: top.id, name: top.name, email: top.email, order_count: top.order_count, total_spent: top.total_spent } : null }; }

async function loginAdmin(request, db, env, credentials, ip) {
  if (limited(`admin:${ip}`)) return fail(429, 'Đăng nhập quá nhiều lần. Thử lại sau.');
  if (!equal(safe(credentials.username, 120).toLowerCase() || env.ADMIN_USERNAME || 'anvathouse@gmail.com', (env.ADMIN_USERNAME || 'anvathouse@gmail.com').toLowerCase()) || !equal(credentials.password || '', env.ADMIN_PASSWORD || '')) { failed(`admin:${ip}`); return fail(401, 'Tên đăng nhập hoặc mật khẩu không đúng.'); }
  rate.delete(`admin:${ip}`);
  const old = cookie(request).avh_customer_session;
  if (old) await qr(db, 'DELETE FROM customer_sessions WHERE token_hash=?', await hash(old));
  const token = random(32);
  await qr(db, 'INSERT INTO sessions (token_hash,expires_at) VALUES (?,?)', await hash(token), Date.now() + 604800000);
  return json({ ok: true, role: 'owner', username: env.ADMIN_USERNAME || 'anvathouse@gmail.com' }, 200, [setCookie('avh_session', token), setCookie('avh_customer_session', '', 0)]);
}
async function changeStatus(db, code, status, customerId = null) {
  const order = await q1(db, 'SELECT * FROM orders WHERE code=?', code);
  if (!order || (customerId !== null && order.customer_id !== customerId)) return { error: 'Không tìm thấy đơn hàng.', status: 404 };
  const allowed = { new: ['preparing','cancelled'], preparing: ['shipping','cancelled'], shipping: ['complete','cancelled'], complete: [], cancelled: [] };
  if (!allowed[order.status]?.includes(status) || (customerId !== null && !['new','preparing'].includes(order.status))) return { error: 'Không thể hủy hoặc chuyển trạng thái đơn này.', status: 409 };
  const history = JSON.parse(order.status_history || '[]'); history.push({ status, at: new Date().toISOString() });
  const result = await qr(db, 'UPDATE orders SET status=?,status_history=? WHERE code=? AND status=?', status, JSON.stringify(history), code, order.status);
  if (!result.meta.changes) return { error: 'Trạng thái đơn vừa thay đổi. Vui lòng tải lại.', status: 409 };
  return { order: await q1(db, 'SELECT * FROM orders WHERE code=?', code) };
}
async function customerDetail(db, customer, adminHash, s) {
  const grant = await q1(db, 'SELECT expires_at FROM admin_reveals WHERE token_hash=? AND (customer_id=? OR customer_id=0) AND expires_at>? ORDER BY expires_at DESC LIMIT 1', adminHash, customer.id, Date.now());
  const unlocked = !!grant;
  const rows = await qa(db, 'SELECT * FROM orders WHERE customer_id=? ORDER BY id DESC', customer.id);
  const orders = rows.map(o => { const v = orderView(o, s); if (!unlocked) { v.phone = maskPhone(v.phone); v.address = maskAddress(v.address); } return v; });
  return { customer: { ...customer, phone: unlocked ? customer.phone : maskPhone(customer.phone), phone_masked: maskPhone(customer.phone), address: unlocked ? customer.address : maskAddress(customer.address), address_masked: maskAddress(customer.address), order_count: orders.length, total_spent: orders.filter(o => o.status !== 'cancelled').reduce((n,o) => n + o.total,0), completed_spent: orders.filter(o => o.status === 'complete').reduce((n,o) => n + o.total,0), sensitive_unlocked: unlocked }, orders, sensitive_unlocked: unlocked, sensitive_expires_at: grant?.expires_at || null };
}

export async function apiFetch(request, env) {
  const db = env.DB;
  if (!db) return fail(503, 'Cơ sở dữ liệu chưa sẵn sàng.');
  const url = new URL(request.url), path = url.pathname, method = request.method, ip = request.headers.get('cf-connecting-ip') || 'local';
  if (method !== 'GET' && request.headers.get('origin') && new URL(request.headers.get('origin')).host !== url.host) return fail(403, 'Nguồn yêu cầu không hợp lệ.');
  const who = await actor(request, db), s = await settings(db), pub = publicSettings(s);
  try {
    if (method === 'GET' && path === '/api/products') return json({ products: (await listProducts(db)).filter(p => p.active).map(publicProduct), settings: pub });
    const eventParam = path.match(/^\/api\/products\/([^/]+)\/event$/)?.[1];
    if (method === 'POST' && eventParam) {
      const p = findProduct(eventParam, (await listProducts(db)).filter(x => x.active)); if (!p) return fail(404, 'Không tìm thấy sản phẩm.');
      const b = await body(request); if (!['view','cart_add'].includes(b.type)) return fail(400, 'Loại sự kiện không hợp lệ.');
      const key = `event:${ip}:${p.id}:${b.type}`, now = Date.now(), cooldown = b.type === 'view' ? 3000 : 400;
      if (rate.get(key)?.until > now) return json({ ok: true, counted: false, deduplicated: true });
      rate.set(key, { until: now + cooldown });
      const field = b.type === 'view' ? 'views' : 'cart_adds'; await qr(db, `UPDATE products SET ${field}=${field}+1 WHERE id=?`, p.id);
      const updated = await q1(db, 'SELECT views,cart_adds FROM products WHERE id=?', p.id);
      return json({ ok: true, counted: true, ...updated });
    }
    const productParam = path.match(/^\/api\/products\/([^/]+)$/)?.[1];
    if (method === 'GET' && productParam) { const p = findProduct(productParam, (await listProducts(db)).filter(x => x.active)); return p ? json({ product: publicProduct(p), settings: pub }) : fail(404, 'Không tìm thấy sản phẩm.'); }

    if (method === 'GET' && ['/api/customer/me','/api/auth/me'].includes(path)) return json(who.adminHash ? { role: 'owner', authenticated: true, customer: null, password_reset_enabled: false } : who.customer ? { role: 'customer', authenticated: true, customer: customerView(who.customer), password_reset_enabled: false } : { role: 'guest', authenticated: false, customer: null, password_reset_enabled: false });
    if (method === 'POST' && ['/api/customer/register','/api/auth/register'].includes(path)) {
      const b = await body(request), email = safe(b.email, 120).toLowerCase(), password = typeof b.password === 'string' ? b.password : '', name = safe(b.name, 80), phone = safe(b.phone, 20).replace(/[ .-]/g, ''), address = safe(b.address, 240);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, 'Email không hợp lệ.');
      if (email === (env.ADMIN_USERNAME || 'anvathouse@gmail.com').toLowerCase() || await q1(db, 'SELECT 1 FROM customers WHERE email=?', email)) return fail(409, 'Email này đã được đăng ký.');
      if (password.length < 8 || password.length > 200) return fail(400, 'Mật khẩu phải từ 8 đến 200 ký tự.');
      if (phone && !/^(0|\+84)[0-9]{9,10}$/.test(phone)) return fail(400, 'Số điện thoại không hợp lệ.');
      const salt = random(16), hashValue = hex(await scrypt(enc.encode(password), fromHex(salt), 16384, 8, 1, 64));
      const result = await qr(db, 'INSERT INTO customers (email,password_salt,password_hash,name,phone,address,created_at) VALUES (?,?,?,?,?,?,?)', email, salt, hashValue, name, phone, address, new Date().toISOString());
      const old = cookie(request).avh_session; if (old) await qr(db, 'DELETE FROM sessions WHERE token_hash=?', await hash(old));
      const token = random(32); await qr(db, 'INSERT INTO customer_sessions (token_hash,customer_id,expires_at) VALUES (?,?,?)', await hash(token), result.meta.last_row_id, Date.now() + 604800000);
      const c = await q1(db, 'SELECT id,email,name,phone,address,created_at FROM customers WHERE id=?', result.meta.last_row_id);
      return json({ customer: customerView(c), role: 'customer' }, 201, [setCookie('avh_customer_session', token), setCookie('avh_session', '', 0)]);
    }
    if (method === 'POST' && ['/api/customer/login','/api/auth/login','/api/admin/login'].includes(path)) {
      const b = await body(request), email = safe(b.email ?? b.username, 120).toLowerCase();
      if (path === '/api/admin/login' || email === (env.ADMIN_USERNAME || 'anvathouse@gmail.com').toLowerCase()) return loginAdmin(request, db, env, { username: email, password: b.password }, ip);
      const key = `customer:${ip}:${email}`; if (limited(key)) return fail(429, 'Đăng nhập quá nhiều lần. Thử lại sau.');
      const c = await q1(db, 'SELECT * FROM customers WHERE email=?', email);
      const candidate = await scrypt(enc.encode(String(b.password || '').slice(0,200)), c ? fromHex(c.password_salt) : crypto.getRandomValues(new Uint8Array(16)), 16384, 8, 1, 64);
      if (!c || !equal(hex(candidate), c.password_hash)) { failed(key); return fail(401, 'Email hoặc mật khẩu không đúng.'); }
      rate.delete(key); const old = cookie(request).avh_session; if (old) await qr(db, 'DELETE FROM sessions WHERE token_hash=?', await hash(old));
      const token = random(32); await qr(db, 'INSERT INTO customer_sessions (token_hash,customer_id,expires_at) VALUES (?,?,?)', await hash(token), c.id, Date.now() + 604800000);
      return json({ customer: customerView(c), role: 'customer' }, 200, [setCookie('avh_customer_session', token), setCookie('avh_session', '', 0)]);
    }
    if (method === 'POST' && ['/api/customer/forgot-password','/api/auth/forgot-password','/api/customer/reset-password','/api/auth/reset-password'].includes(path)) return fail(503, 'Chức năng đặt lại mật khẩu qua email chưa được bật.');
    if (method === 'POST' && ['/api/customer/logout','/api/auth/logout','/api/admin/logout'].includes(path)) {
      const c = cookie(request); for (const token of [c.avh_session,c.avh_customer_session]) if (token) { const h = await hash(token); await qr(db, 'DELETE FROM sessions WHERE token_hash=?', h); await qr(db, 'DELETE FROM customer_sessions WHERE token_hash=?', h); await qr(db, 'DELETE FROM admin_reveals WHERE token_hash=?', h); }
      return json({ ok: true }, 200, [setCookie('avh_session','',0),setCookie('avh_customer_session','',0)]);
    }
    if (method === 'GET' && path === '/api/customer/profile') return who.customer ? json({ customer: customerView(who.customer) }) : fail(401, 'Vui lòng đăng nhập tài khoản khách hàng.');
    if (method === 'PATCH' && ['/api/customer/profile','/api/customer/me'].includes(path)) {
      if (!who.customer) return fail(401, 'Vui lòng đăng nhập tài khoản khách hàng.'); const b = await body(request), c = who.customer;
      const name = b.name !== undefined ? safe(b.name,80) : c.name, phone = b.phone !== undefined ? safe(b.phone,20).replace(/[ .-]/g,'') : c.phone, address = b.address !== undefined ? safe(b.address,240) : c.address;
      if (name.length < 2 || (phone && !/^(0|\+84)[0-9]{9,10}$/.test(phone)) || (address && address.length < 8)) return fail(400, 'Thông tin cá nhân không hợp lệ.');
      await qr(db, 'UPDATE customers SET name=?,phone=?,address=? WHERE id=?', name, phone, address, c.id);
      return json({ customer: customerView(await q1(db, 'SELECT id,email,name,phone,address,created_at FROM customers WHERE id=?', c.id)) });
    }
    if (method === 'GET' && path === '/api/customer/orders') return who.customer ? json({ orders: (await qa(db, 'SELECT * FROM orders WHERE customer_id=? ORDER BY id DESC', who.customer.id)).map(o => orderView(o,s)) }) : fail(401, 'Vui lòng đăng nhập tài khoản khách hàng.');
    const cancelCode = path.match(/^\/api\/customer\/orders\/(AVH-[A-F0-9]{16})\/cancel$/)?.[1];
    if (method === 'POST' && cancelCode) { if (!who.customer) return fail(401, 'Vui lòng đăng nhập.'); const result = await changeStatus(db,cancelCode,'cancelled',who.customer.id); return result.error ? fail(result.status,result.error) : json({ order: orderView(result.order,s) }); }
    const customerOrderCode = path.match(/^\/api\/(?:customer\/)?orders\/(AVH-[A-F0-9]{16})$/)?.[1];
    if (method === 'GET' && customerOrderCode) { if (!who.customer && !who.adminHash) return fail(401, 'Vui lòng đăng nhập.'); const o = await q1(db, 'SELECT * FROM orders WHERE code=?', customerOrderCode); if (!o) return fail(404, 'Không tìm thấy đơn hàng.'); if (!who.adminHash && o.customer_id !== who.customer.id) return fail(403, 'Không có quyền xem đơn hàng này.'); return json({ order: orderView(o,s) }); }
    if (method === 'GET' && path === '/api/order') {
      const code = safe(url.searchParams.get('code'), 24).toUpperCase(), phone = safe(url.searchParams.get('phone'), 20).replace(/[ .-]/g,''), key = `lookup:${ip}`;
      if (limited(key,8,600000)) return fail(429, 'Tra cứu quá nhiều lần. Thử lại sau.');
      const o = await q1(db, 'SELECT * FROM orders WHERE code=?', code);
      if (!o || o.phone.replace(/[ .-]/g,'') !== phone) { failed(key,8,600000); return fail(404, 'Không tìm thấy đơn hàng.'); }
      if (who.customer && o.customer_id !== who.customer.id && !who.adminHash) return fail(403, 'Không có quyền xem đơn hàng này.');
      rate.delete(key); return json({ order: orderView(o,s) });
    }
    if (method === 'POST' && path === '/api/orders') {
      if (!who.customer) return fail(401, 'Vui lòng đăng nhập tài khoản khách hàng để mua hàng.');
      if (!pub.accepting_orders || pub.shipping_fee === null || !pub.shipping_area) return fail(409, 'Cửa hàng chưa nhận đơn trực tuyến.');
      const b = await body(request), name = safe(b.name,80), phone = safe(b.phone,20).replace(/[ .-]/g,''), address = safe(b.address,240), note = safe(b.note,300);
      if (name.length < 2 || !/^(0|\+84)[0-9]{9,10}$/.test(phone) || address.length < 8) return fail(400, 'Vui lòng kiểm tra tên, số điện thoại và địa chỉ.');
      if (!Array.isArray(b.items) || !b.items.length || b.items.length > 40 || !['cod','bank'].includes(b.payment) || (b.payment === 'cod' && !pub.cod_enabled) || (b.payment === 'bank' && !pub.bank_available)) return fail(400, 'Giỏ hàng hoặc phương thức thanh toán không hợp lệ.');
      const quantities = new Map(); for (const item of b.items) { if (!int(item.id,1,1000000) || !int(item.qty,1,99)) return fail(400, 'Số lượng sản phẩm không hợp lệ.'); quantities.set(item.id, (quantities.get(item.id) || 0) + item.qty); }
      if ([...quantities.values()].some(n => n > 99)) return fail(400, 'Số lượng sản phẩm quá lớn.');
      let subtotal = 0; const lines = [], statements = [];
      for (const [id,qty] of quantities) { const p = await q1(db, 'SELECT * FROM products WHERE id=? AND active=1 AND deleted=0', id); if (!p || p.stock < qty) return fail(409, 'Một món trong giỏ đã hết hoặc không đủ hàng. Vui lòng tải lại trang.'); subtotal += p.price * qty; lines.push({ id, name: p.name, weight: p.weight, price: p.price, qty, image: p.image }); statements.push(db.prepare('UPDATE products SET stock=stock-? WHERE id=?').bind(qty,id)); }
      if (b.expected_total !== subtotal + pub.shipping_fee) return fail(409, 'Giá hoặc phí giao đã thay đổi. Vui lòng kiểm tra lại đơn.');
      const code = 'AVH-' + random(8).toUpperCase(), created = new Date().toISOString();
      statements.push(db.prepare('INSERT INTO orders (code,name,phone,address,note,items,subtotal,shipping_fee,total,payment,created_at,customer_id,status_history) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(code,name,phone,address,note,JSON.stringify(lines),subtotal,pub.shipping_fee,subtotal + pub.shipping_fee,b.payment,created,who.customer.id,JSON.stringify([{ status:'new',at:created }])));
      try { await db.batch(statements); } catch { return fail(409, 'Một món trong giỏ đã hết hoặc không đủ hàng. Vui lòng tải lại trang.'); }
      return json({ order: orderView(await q1(db, 'SELECT * FROM orders WHERE code=?', code),s) },201);
    }
    if (path.startsWith('/api/admin/') && !who.adminHash) return fail(who.customer ? 403 : 401, who.customer ? 'Tài khoản khách hàng không có quyền truy cập quản trị.' : 'Vui lòng đăng nhập.');
    if (method === 'GET' && path === '/api/admin/data') {
      const rawOrders = await qa(db, 'SELECT * FROM orders ORDER BY id DESC'), products = await listProducts(db), customers = await adminCustomers(db), guest = await q1(db, 'SELECT COUNT(*) AS count FROM orders WHERE customer_id IS NULL'), dashboard = dailyStats(rawOrders,products,s);
      return json({ products: products.map(adminProduct), orders: rawOrders.map(o => orderView(o,s)), customers, customer_summary: customerSummary(customers, guest.count), settings:s, stats:{ counts:dashboard.counts,revenue:dashboard.revenue,today_revenue:dashboard.today_revenue }, dashboard });
    }
    if (method === 'GET' && path === '/api/admin/customers') { const customers = await adminCustomers(db, safe(url.searchParams.get('q'),120)), all = await adminCustomers(db), guest = await q1(db,'SELECT COUNT(*) AS count FROM orders WHERE customer_id IS NULL'); return json({ customers, summary: customerSummary(all,guest.count) }); }
    const customerId = path.match(/^\/api\/admin\/customers\/(\d+)$/)?.[1];
    if (method === 'GET' && customerId) { const c = await q1(db,'SELECT id,name,email,phone,address,created_at FROM customers WHERE id=?', Number(customerId)); return c ? json(await customerDetail(db,c,who.adminHash,s)) : fail(404,'Không tìm thấy khách hàng.'); }
    const revealId = path.match(/^\/api\/admin\/customers\/(\d+)\/reveal$/)?.[1];
    if (method === 'POST' && (revealId || ['/api/admin/customers/reveal','/api/admin/verify-password'].includes(path))) {
      const b = await body(request), id = Number(revealId || b.customer_id || 0), key = `reveal:${who.adminHash}`;
      if (limited(key)) return fail(429, 'Xác nhận mật khẩu sai quá nhiều lần. Vui lòng thử lại sau.');
      if (id && !await q1(db,'SELECT 1 FROM customers WHERE id=?',id)) return fail(404,'Không tìm thấy khách hàng.');
      const success = equal(b.password || '', env.ADMIN_PASSWORD || '');
      await qr(db, 'INSERT INTO admin_audit_logs (action,target_customer_id,success,ip,created_at) VALUES (?,?,?,?,?)', 'reveal_customer_sensitive', id || null, success ? 1 : 0, ip, new Date().toISOString());
      if (!success) { failed(key); return fail(401, 'Mật khẩu quản trị không đúng.'); }
      rate.delete(key); const expires = Date.now() + Number(env.ADMIN_REVEAL_TTL_MS || 300000);
      await qr(db, 'INSERT OR REPLACE INTO admin_reveals (token_hash,customer_id,expires_at) VALUES (?,?,?)', who.adminHash,id,expires);
      if (id) { const c = await q1(db,'SELECT id,name,email,phone,address,created_at FROM customers WHERE id=?',id); return json({ ...(await customerDetail(db,c,who.adminHash,s)), revealed_at:new Date().toISOString() }); }
      return json({ ok:true,sensitive_unlocked:true,sensitive_expires_at:expires,revealed_at:new Date().toISOString() });
    }
    if (method === 'GET' && path === '/api/admin/audit-logs') return json({ logs: await qa(db,'SELECT id,action,target_customer_id,success,ip,created_at FROM admin_audit_logs ORDER BY id DESC LIMIT 100') });
    if (method === 'POST' && path === '/api/admin/upload') {
      const b = await body(request,5500000); if (!['image/jpeg','image/png'].includes(b.type) || typeof b.data !== 'string' || b.data.length > 5400000) return fail(400, 'Chỉ nhận ảnh JPG hoặc PNG tối đa 4 MB.');
      const bytes = Uint8Array.from(atob(b.data), c => c.charCodeAt(0)); if (bytes.length > 4000000 || bytes.length < 100 || (b.type === 'image/jpeg' && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)) || (b.type === 'image/png' && !(bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78))) return fail(400, 'Tệp ảnh không hợp lệ.');
      const filename = random(16) + (b.type === 'image/png' ? '.png' : '.jpg'); await env.BUCKET.put(filename,bytes,{httpMetadata:{contentType:b.type}}); return json({ image:'/uploads/'+filename },201);
    }
    if (method === 'POST' && path === '/api/admin/products') { const b = await body(request); if (!int(b.price,0,100000000) || !int(b.stock,0,1000000) || typeof b.active !== 'boolean' || !safe(b.name,100) || !safe(b.category,40) || !safe(b.weight,40) || typeof b.description !== 'string' || b.description.length > 1000 || !/^\/uploads\/[a-f0-9]{32}\.(jpg|png)$/.test(b.image || '')) return fail(400,'Thông tin sản phẩm không hợp lệ.'); const result = await qr(db,'INSERT INTO products (name,category,weight,price,stock,active,description,image) VALUES (?,?,?,?,?,?,?,?)', safe(b.name,100),safe(b.category,40),safe(b.weight,40),b.price,b.stock,b.active?1:0,b.description.trim(),b.image); return json({id:result.meta.last_row_id},201); }
    const productId = path.match(/^\/api\/admin\/products\/(\d+)$/)?.[1];
    if (method === 'PATCH' && productId) { const b = await body(request), p = await q1(db,'SELECT * FROM products WHERE id=? AND deleted=0',Number(productId)); if (!p) return fail(404,'Không tìm thấy sản phẩm.'); if (!int(b.price,0,100000000) || !int(b.stock,0,1000000) || typeof b.active !== 'boolean' || !safe(b.name,100) || !safe(b.category,40) || !safe(b.weight,40) || typeof b.description !== 'string' || b.description.length > 1000 || (b.image !== undefined && !/^\/uploads\/[a-f0-9]{32}\.(jpg|png)$/.test(b.image))) return fail(400,'Thông tin sản phẩm không hợp lệ.'); await qr(db,'UPDATE products SET name=?,category=?,weight=?,price=?,stock=?,active=?,description=?,image=? WHERE id=?',safe(b.name,100),safe(b.category,40),safe(b.weight,40),b.price,b.stock,b.active?1:0,b.description.trim(),b.image || p.image,Number(productId)); return json({ok:true}); }
    if (method === 'DELETE' && productId) { const r = await qr(db,'UPDATE products SET deleted=1,active=0 WHERE id=? AND deleted=0', Number(productId)); return r.meta.changes ? json({ok:true}) : fail(404,'Không tìm thấy sản phẩm.'); }
    const orderCode = path.match(/^\/api\/admin\/orders\/(AVH-[A-F0-9]{16})$/)?.[1];
    if (method === 'PATCH' && orderCode) { const b = await body(request), o = await q1(db,'SELECT * FROM orders WHERE code=?',orderCode); if (!o) return fail(404,'Không tìm thấy đơn hàng.'); if (b.status !== undefined) { const result = await changeStatus(db,orderCode,b.status); if (result.error) return fail(result.status,result.error); } if (b.payment_paid !== undefined) { if (typeof b.payment_paid !== 'boolean') return fail(400,'Trạng thái thanh toán không hợp lệ.'); await qr(db,'UPDATE orders SET payment_paid=? WHERE code=?',b.payment_paid?1:0,orderCode); } return json({ok:true,order:orderView(await q1(db,'SELECT * FROM orders WHERE code=?',orderCode),s)}); }
    if (method === 'PATCH' && path === '/api/admin/settings') { const b = await body(request); if (typeof b.accepting_orders !== 'boolean' || !int(b.shipping_fee,0,1000000) || typeof b.shipping_area !== 'string' || b.shipping_area.length > 160 || typeof b.bank_details !== 'string' || b.bank_details.length > 500 || typeof b.phone !== 'string' || b.phone.length > 30 || typeof b.hero_title !== 'string' || b.hero_title.length > 80 || typeof b.hero_text !== 'string' || b.hero_text.length > 300 || typeof b.hero_image !== 'string' || (b.hero_image && !/^\/uploads\/[a-f0-9]{32}\.(jpg|png)$/.test(b.hero_image)) || typeof b.about_text !== 'string' || b.about_text.length > 700 || typeof b.shipping_policy !== 'string' || b.shipping_policy.length > 1000 || typeof b.return_policy !== 'string' || b.return_policy.length > 1000 || (b.accepting_orders && !b.shipping_area.trim())) return fail(400,'Cài đặt cửa hàng không hợp lệ.'); const values = { ...b, accepting_orders:b.accepting_orders?'1':'0',shipping_fee:String(b.shipping_fee),cod_enabled:b.cod_enabled?'1':'0',bank_enabled:b.bank_enabled?'1':'0',shipping_area:b.shipping_area.trim(),bank_details:b.bank_details.trim(),hero_title:b.hero_title.trim(),hero_text:b.hero_text.trim(),about_text:b.about_text.trim(),shipping_policy:b.shipping_policy.trim(),return_policy:b.return_policy.trim() }; const allowed = ['accepting_orders','shipping_area','shipping_fee','cod_enabled','bank_enabled','bank_name','bank_bin','bank_account_no','bank_account_name','bank_details','phone','email','hero_title','hero_text','hero_image','about_text','shipping_policy','return_policy']; await db.batch(allowed.map(k => db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind(k,String(values[k] ?? s[k] ?? '')))); return json({ok:true}); }
    return fail(404, 'Không tìm thấy.');
  } catch (error) { console.error(error); return fail(400, error.message || 'Có lỗi xảy ra.'); }
}

export async function importData(request, env) {
  if (!env.IMPORT_KEY || !equal(request.headers.get('x-import-key') || '', env.IMPORT_KEY)) return fail(403, 'Không có quyền.');
  try {
    const b = await body(request, 8000000), db = env.DB;
    if (!Array.isArray(b.products) || !Array.isArray(b.orders) || !Array.isArray(b.customers) || !Array.isArray(b.settings) || !Array.isArray(b.uploads)) return fail(400, 'Dữ liệu nhập không hợp lệ.');
    if ((await q1(db, 'SELECT COUNT(*) AS count FROM products')).count || (await q1(db, 'SELECT COUNT(*) AS count FROM orders')).count) return fail(409, 'Dữ liệu đã tồn tại.');
    const stmts = [];
    for (const p of b.products) stmts.push(db.prepare('INSERT INTO products (id,name,category,weight,price,image,stock,active,description,views,cart_adds,deleted) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(p.id,p.name,p.category,p.weight,p.price,p.image,p.stock,p.active,p.description,p.views,p.cart_adds,p.deleted));
    for (const c of b.customers) stmts.push(db.prepare('INSERT INTO customers (id,email,password_salt,password_hash,name,phone,address,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(c.id,c.email,c.password_salt,c.password_hash,c.name,c.phone,c.address,c.created_at));
    for (const o of b.orders) stmts.push(db.prepare('INSERT INTO orders (id,code,name,phone,address,note,items,subtotal,shipping_fee,total,payment,payment_paid,status,created_at,customer_id,status_history) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(o.id,o.code,o.name,o.phone,o.address,o.note,o.items,o.subtotal,o.shipping_fee,o.total,o.payment,o.payment_paid,o.status,o.created_at,o.customer_id,o.status_history));
    for (const s of b.settings) stmts.push(db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').bind(s.key,s.value));
    await db.batch(stmts);
    for (const upload of b.uploads) {
      if (!/^[a-f0-9]{32}\.(jpg|png)$/.test(upload.name)) continue;
      const bytes = Uint8Array.from(atob(upload.data), c => c.charCodeAt(0));
      await env.BUCKET.put(upload.name, bytes, { httpMetadata: { contentType: upload.name.endsWith('.png') ? 'image/png' : 'image/jpeg' } });
    }
    return json({ ok: true, counts: { products: b.products.length, customers: b.customers.length, orders: b.orders.length, settings: b.settings.length, uploads: b.uploads.length } });
  } catch (error) { console.error(error); return fail(400, 'Không nhập được dữ liệu.'); }
}
