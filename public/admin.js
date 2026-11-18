const $ = s => document.querySelector(s);
const money = n => new Intl.NumberFormat('vi-VN').format(Number(n || 0)) + '₫';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const photo = p => p.image && p.image.startsWith('/uploads/') ? p.image : '/assets/products/' + (p.image || '');
const statusName = {
  new: 'Đơn mới',
  preparing: 'Đang chuẩn bị',
  shipping: 'Đang giao',
  complete: 'Hoàn tất',
  cancelled: 'Đã hủy'
};
const nextStatus = {
  new: ['preparing', 'cancelled'],
  preparing: ['shipping', 'cancelled'],
  shipping: ['complete', 'cancelled'],
  complete: [],
  cancelled: []
};
const primaryActionLabel = {
  new: 'Xác nhận đơn',
  preparing: 'Giao hàng',
  shipping: 'Cập nhật hoàn tất'
};

let data = {
  products: [],
  orders: [],
  customers: [],
  customer_summary: { total_registered: 0, returning_customers: 0, guest_order_count: 0, top_customer: null },
  settings: {},
  stats: { counts: {}, revenue: 0, today_revenue: 0 },
  dashboard: {
    counts: {},
    total_orders: 0,
    new_orders: 0,
    preparing_orders: 0,
    shipping_orders: 0,
    preparing_shipping_orders: 0,
    completed_orders: 0,
    cancelled_orders: 0,
    revenue: 0,
    today_revenue: 0,
    low_stock_products: [],
    orders_by_day: [],
    product_analytics: { stats_started_at: null, total_views: 0, total_cart_adds: 0, most_viewed: [], most_cart_added: [] }
  }
};
let tab = 'overview';
let selectedCustomerId = null;
let customerDetail = null;
let revealExpiryTimer = null;
let searchTimer = null;
let orderSearchQuery = '';
let orderFilter = 'all';
let expandedOrderCode = null;
let revenuePeriod = 'week';
let productSearchQuery = '';

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function message(text) {
  const el = $('#admin-toast');
  if (!el) return;
  el.textContent = text;
  clearTimeout(message.timer);
  message.timer = setTimeout(() => { el.textContent = ''; }, 4500);
}

async function api(path, options = {}) {
  const r = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(d.error || 'Có lỗi xảy ra.');
    err.status = r.status;
    throw err;
  }
  return d;
}

async function load() {
  try {
    data = await api('/api/admin/data');
    $('#login-view').hidden = true;
    $('#admin-view').hidden = false;
    $('#login-error').textContent = '';
    render();
  } catch (e) {
    $('#admin-view').hidden = true;
    $('#login-view').hidden = false;
    if (e.status === 403) {
      $('#login-error').textContent = e.message || 'Tài khoản khách hàng không có quyền truy cập khu vực quản trị.';
    }
  }
}

function showTab(name) {
  tab = name;
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.admin-tab').forEach(el => { el.hidden = el.id !== 'tab-' + name; });
  $('#admin-title').textContent = ({
    overview: 'Tổng quan',
    orders: 'Đơn hàng',
    customers: 'Khách hàng',
    products: 'Sản phẩm',
    settings: 'Cửa hàng'
  })[name] || 'Quản trị';
}

function render() {
  showTab(tab);
  renderOverview();
  renderOrders();
  renderCustomers();
  renderProducts();
  renderSettings();
}

function renderDailyBarChart(days) {
  if (!days || !days.length) {
    return '<p class="empty-note">Chưa có dữ liệu đơn hàng theo ngày.</p>';
  }
  const maxCount = Math.max(1, ...days.map(d => Number(d.count || 0)));
  const parts = [['completed', 'Hoàn tất'], ['shipping', 'Đang giao'], ['preparing', 'Chuẩn bị'], ['new', 'Đơn mới'], ['cancelled', 'Đã hủy']];
  return `<div class="chart-legend">${parts.map(([key, label]) => `<span><i class="chart-dot ${key}"></i>${label}</span>`).join('')}</div><div class="daily-bar-chart" aria-label="Biểu đồ đơn hàng 7 ngày gần nhất">
    ${days.map(d => {
      const count = Number(d.count || 0);
      const heightPct = count > 0 ? Math.max(14, Math.round((count / maxCount) * 100)) : 4;
      return `<div class="bar-col">
        <strong class="bar-value">${count}</strong>
        <div class="bar-track">
          <div class="bar-stack" style="height:${heightPct}%" title="${esc(d.day_name)} (${esc(d.label)}): ${parts.map(([key, label]) => `${label}: ${Number(d[key] || 0)}`).join(' • ')}">
            ${parts.map(([key]) => `<span class="bar-segment ${key}" style="flex:${Number(d[key] || 0)}"></span>`).join('')}
          </div>
        </div>
        <span class="bar-day">${esc(d.day_name)}</span>
        <small class="bar-date">(${esc(d.label)})</small>
      </div>`;
    }).join('')}
  </div>`;
}

function revenueSeries(period, orders, now = new Date()) {
  const vnNow = new Date(now.getTime() + 7 * 3600000);
  const year = vnNow.getUTCFullYear(), month = vnNow.getUTCMonth(), day = vnNow.getUTCDate();
  const points = [];
  if (period === 'week') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.UTC(year, month, day - i));
      points.push({ key: d.toISOString().slice(0, 10), label: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`, value: 0 });
    }
  } else if (period === 'month') {
    for (let start = 1; start <= day; start += 7) points.push({ key: `${year}-${String(month + 1).padStart(2, '0')}-${start}`, label: `${start}–${Math.min(start + 6, day)}/${month + 1}`, value: 0 });
  } else {
    for (let m = 1; m <= month + 1; m++) points.push({ key: `${year}-${String(m).padStart(2, '0')}`, label: `Th ${m}`, value: 0 });
  }
  for (const order of orders) {
    if (order.status !== 'complete') continue;
    const completedAt = (order.status_history || []).find(h => h.status === 'complete')?.at || order.created_at;
    const at = new Date(new Date(completedAt).getTime() + 7 * 3600000);
    if (isNaN(at.getTime())) continue;
    const date = at.toISOString().slice(0, 10);
    const key = period === 'week' ? date : period === 'month' ? `${date.slice(0, 7)}-${Math.floor((at.getUTCDate() - 1) / 7) * 7 + 1}` : date.slice(0, 7);
    const point = points.find(p => p.key === key);
    if (point) point.value += Number(order.total || 0);
  }
  return points;
}

function renderRevenueChart(points) {
  const max = Math.max(1, ...points.map(p => p.value));
  const coords = points.map((p, i) => ({ ...p, x: 42 + i * 676 / Math.max(1, points.length - 1), y: 210 - p.value / max * 150 }));
  const compact = n => n >= 1000000 ? `${(n / 1000000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}tr` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
  return `<div class="revenue-chart" role="img" aria-label="Biểu đồ doanh thu: ${points.map(p => `${p.label}: ${money(p.value)}`).join(', ')}">
    <svg viewBox="0 0 760 270" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      ${[60, 110, 160, 210].map(y => `<line x1="42" y1="${y}" x2="718" y2="${y}" class="revenue-grid-line"/>`).join('')}
      <polyline points="${coords.map(p => `${p.x},${p.y}`).join(' ')}" class="revenue-line"/>
      ${coords.map(p => `<g><title>${esc(p.label)}: ${money(p.value)}</title>${p.y < 189 ? `<line x1="${p.x}" y1="${p.y + 21}" x2="${p.x}" y2="210" class="revenue-guide"/>` : ''}<circle cx="${p.x}" cy="${p.y}" r="21" class="revenue-point"/><text x="${p.x}" y="${p.y + 5}" class="revenue-value">${compact(p.value)}</text><text x="${p.x}" y="247" class="revenue-label">${esc(p.label)}</text></g>`).join('')}
    </svg>
  </div><p class="revenue-total">Tổng doanh thu kỳ này: <strong>${money(points.reduce((sum, p) => sum + p.value, 0))}</strong></p>`;
}

function renderMiniProgress(status) {
  if (status === 'cancelled') {
    return `<div class="mini-progress"><span class="badge cancelled">✕ Đã hủy</span></div>`;
  }
  const steps = [
    { key: 'new', label: 'Đã đặt' },
    { key: 'preparing', label: 'Chuẩn bị' },
    { key: 'shipping', label: 'Đang giao' },
    { key: 'complete', label: 'Hoàn tất' }
  ];
  const idx = steps.findIndex(s => s.key === status);
  return `<div class="mini-progress" aria-label="Tiến độ: ${esc(statusName[status] || status)}">
    ${steps.map((s, i) => `
      <div class="mini-step ${i <= idx ? 'done' : ''} ${i === idx ? 'current' : ''}">
        <span class="mini-dot">${i <= idx ? '✓' : ''}</span>
        <small>${esc(s.label)}</small>
      </div>
    `).join('')}
  </div>`;
}

function renderOverview() {
  const d = data.dashboard || {};
  const counts = (data.stats && data.stats.counts) || d.counts || {};
  const newCount = d.new_orders ?? (counts.new || 0);
  const activeShipCount = d.preparing_shipping_orders ?? ((counts.preparing || 0) + (counts.shipping || 0));
  const completeCount = d.completed_orders ?? (counts.complete || 0);
  const totalRevenue = d.revenue ?? (data.stats ? data.stats.revenue : 0);
  const todayRevenue = d.today_revenue ?? 0;

  $('#stats').innerHTML = [
    ['Đơn mới', `${newCount}`, 'Cần xác nhận'],
    ['Đang chuẩn bị / giao', `${activeShipCount}`, `${counts.preparing || 0} chuẩn bị • ${counts.shipping || 0} đang giao`],
    ['Hoàn tất', `${completeCount}`, 'Đơn giao thành công'],
    ['Doanh thu thực', money(totalRevenue), `Hôm nay: ${money(todayRevenue)}`]
  ].map(x => `<div class="stat"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong><small>${esc(x[2])}</small></div>`).join('');

  const pendingOrders = data.orders.filter(o => ['new', 'preparing', 'shipping'].includes(o.status)).slice(0, 6);
  $('#recent-orders').innerHTML = pendingOrders.length
    ? pendingOrders.map(o => {
        const nextPrimary = o.status === 'new' ? 'preparing' : (o.status === 'preparing' ? 'shipping' : 'complete');
        const btnLabel = primaryActionLabel[o.status] || statusName[nextPrimary];
        return `<article class="overview-order-row">
          <div class="overview-order-meta">
            <strong>${esc(o.code)}</strong>
            <span class="badge ${esc(o.status)}">${esc(statusName[o.status])}</span>
          </div>
          <div class="overview-order-customer">
            <span>👤 ${esc(o.name)}</span>
            <strong>${money(o.total)}</strong>
          </div>
          ${renderMiniProgress(o.status)}
          <div class="overview-order-action">
            <button type="button" class="button red small-btn" data-order="${esc(o.code)}" data-status="${esc(nextPrimary)}">${esc(btnLabel)}</button>
          </div>
        </article>`;
      }).join('')
    : '<p class="empty-note">Hiện không có đơn hàng nào đang chờ xử lý.</p>';

  const low = d.low_stock_products || data.products.filter(p => p.stock < 5);
  $('#tasks').innerHTML = `
    <div class="task-card" data-goto="orders">
      <div class="task-icon">📦</div>
      <div>
        <strong>${newCount} đơn mới</strong>
        <p>Cần kiểm tra và xác nhận đơn hàng.</p>
      </div>
    </div>
    <div class="task-card ${low.length ? 'warning' : ''}" data-goto="products">
      <div class="task-icon">⚠️</div>
      <div>
        <strong>${low.length} sản phẩm còn dưới 5</strong>
        <p>Cần kiểm tra tồn kho và nhập thêm.</p>
      </div>
    </div>
    ${low.length ? `
      <div class="low-stock-box">
        <strong>Sản phẩm sắp hết hàng:</strong>
        <ul>
          ${low.map(p => `<li><span>${esc(p.name)}</span> <strong>còn ${p.stock}</strong></li>`).join('')}
        </ul>
      </div>
    ` : ''}
    <div class="task-card" data-goto="settings">
      <div class="task-icon">🏪</div>
      <div>
        <strong>Nhận đơn: ${data.settings.accepting_orders === '1' ? 'Đang bật' : 'Đang tắt'}</strong>
        <p>${data.settings.accepting_orders === '1' ? `Khu vực: ${esc(data.settings.shipping_area || 'Đã cấu hình')}` : 'Mở mục Cửa hàng để bật nhận đơn.'}</p>
      </div>
    </div>
  `;

  const days = d.orders_by_day || [];
  const total7d = days.reduce((s, x) => s + Number(x.count || 0), 0);
  if ($('#overview-7d-total')) $('#overview-7d-total').textContent = `7 ngày: ${total7d} đơn`;
  if ($('#overview-chart')) $('#overview-chart').innerHTML = renderDailyBarChart(days);
}

function orderHTML(o) {
  const actions = nextStatus[o.status].map(s =>
    `<button type="button" class="${s === 'cancelled' ? 'btn-cancel-order' : 'primary'}" data-order="${esc(o.code)}" data-status="${esc(s)}">${s === 'cancelled' ? 'Hủy đơn' : esc(primaryActionLabel[o.status] || statusName[s])}</button>`
  ).join('');
  const historyList = (o.status_history || []).map(h =>
    `<span class="history-chip">${esc(statusName[h.status] || h.status)}: ${esc(formatDateTime(h.at))}</span>`
  ).join('');
  const progress = o.status === 'cancelled' ? '<span class="badge cancelled">✕ Đã hủy</span>' : `<div class="table-progress" aria-label="Tiến độ: ${esc(statusName[o.status])}">
    ${[['preparing', 'Chuẩn bị'], ['shipping', 'Đang giao'], ['complete', 'Hoàn tất']].map(([key, label], i) => {
      const done = ['preparing', 'shipping', 'complete'].indexOf(o.status) >= i;
      const linked = ['preparing', 'shipping', 'complete'].indexOf(o.status) > i;
      return `<span class="table-step ${done ? 'done' : ''} ${linked ? 'linked' : ''}"><i aria-hidden="true">${done ? '✓' : ''}</i><small>${label}</small></span>`;
    }).join('')}
  </div>`;

  return `<tr class="order-table-row">
    <td data-label="Mã đơn hàng"><strong class="order-table-code">${esc(o.code)}</strong></td>
    <td data-label="Ngày đặt">${esc(formatDateTime(o.created_at))}</td>
    <td data-label="Khách hàng">${esc(o.name)}</td>
    <td data-label="Tổng tiền"><strong class="price-text">${money(o.total)}</strong></td>
    <td data-label="Thanh toán"><span class="badge ${o.payment_paid ? 'complete' : 'preparing'}">${o.payment_paid ? '✓ Đã thanh toán' : '◷ Chưa thanh toán'}</span></td>
    <td data-label="Tiến độ giao hàng">${progress}</td>
    <td><button type="button" class="order-detail-toggle" data-detail="${esc(o.code)}" aria-expanded="false" aria-controls="detail-${esc(o.code)}">◉ Xem chi tiết</button></td>
  </tr>
  <tr class="order-detail-row" id="detail-${esc(o.code)}" hidden><td colspan="7">
    <div class="order-detail-content">
      <div>
        <p><strong>Khách nhận:</strong> ${esc(o.name)} • ${esc(o.phone)}</p>
        <p><strong>Địa chỉ:</strong> ${esc(o.address)}${o.note ? ` • Ghi chú: ${esc(o.note)}` : ''}</p>
        <p><strong>Thanh toán:</strong> ${o.payment === 'cod' ? 'COD' : 'Chuyển khoản VietQR'} • Tạm tính ${money(o.subtotal)} + Phí giao ${money(o.shipping_fee)}</p>
      </div>
      <div class="admin-order-items">
        ${o.items.map(i => `<div class="admin-order-line"><span>${esc(i.name)} ${i.weight ? `(${esc(i.weight)})` : ''} × <strong>${i.qty}</strong></span><strong>${money(i.line_total ?? i.price * i.qty)}</strong></div>`).join('')}
      </div>
      ${historyList ? `<div class="history-chips-row"><strong>Lịch sử trạng thái:</strong> ${historyList}</div>` : ''}
      <div class="order-actions">${actions}<button type="button" data-order="${esc(o.code)}" data-paid="${o.payment_paid ? '0' : '1'}">${o.payment_paid ? 'Bỏ xác nhận thanh toán' : 'Xác nhận đã nhận tiền'}</button></div>
    </div>
  </td></tr>`;
}

function renderOrders() {
  const d = data.dashboard || {};
  const counts = (data.stats && data.stats.counts) || d.counts || {};
  const totalOrders = d.total_orders ?? data.orders.length;
  const newOrders = d.new_orders ?? (counts.new || 0);
  const preparingOrders = d.preparing_orders ?? (counts.preparing || 0);
  const shippingOrders = d.shipping_orders ?? (counts.shipping || 0);
  const completedOrders = d.completed_orders ?? (counts.complete || 0);
  const cancelledOrders = d.cancelled_orders ?? (counts.cancelled || 0);
  const revenue = d.revenue ?? 0;

  if ($('#orders-stats')) {
    $('#orders-stats').innerHTML = [
      ['Tổng đơn hàng', `${totalOrders}`, 'Tất cả trạng thái'],
      ['Đơn mới & Đang xử lý', `${newOrders + preparingOrders + shippingOrders}`, `${newOrders} mới • ${preparingOrders} chuẩn bị • ${shippingOrders} giao`],
      ['Hoàn tất', `${completedOrders}`, `Doanh thu: ${money(revenue)}`],
      ['Đã hủy', `${cancelledOrders}`, 'Không tính vào doanh thu']
    ].map(x => `<div class="stat"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong><small>${esc(x[2])}</small></div>`).join('');
  }

  if ($('#orders-daily-chart')) {
    const points = revenueSeries(revenuePeriod, data.orders);
    $('#orders-daily-chart').innerHTML = renderRevenueChart(points);
    $('#revenue-period-note').textContent = ({ week: '7 ngày gần nhất', month: 'Từng tuần trong tháng này', year: 'Từng tháng trong năm nay' })[revenuePeriod] + ' • Chỉ tính đơn đã hoàn tất';
    document.querySelectorAll('[data-revenue-period]').forEach(button => {
      const active = button.dataset.revenuePeriod === revenuePeriod;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  if ($('#orders-status-breakdown')) {
    const pct = n => totalOrders > 0 ? Math.round((n / totalOrders) * 100) : 0;
    $('#orders-status-breakdown').innerHTML = `
      <div class="status-breakdown-box">
        <div class="status-total-circle" style="background:${totalOrders ? `conic-gradient(#256c17 0 ${pct(completedOrders)}%, #2469a0 ${pct(completedOrders)}% ${pct(completedOrders + shippingOrders)}%, #e2a920 ${pct(completedOrders + shippingOrders)}% ${pct(completedOrders + shippingOrders + preparingOrders)}%, #ffb21e ${pct(completedOrders + shippingOrders + preparingOrders)}% ${pct(completedOrders + shippingOrders + preparingOrders + newOrders)}%, #b32222 ${pct(completedOrders + shippingOrders + preparingOrders + newOrders)}% 100%)` : '#ddd'}">
          <strong>${totalOrders}</strong>
          <span>Tổng đơn</span>
        </div>
        <ul class="status-legend-list">
          <li><span class="dot complete"></span> <span>Hoàn tất</span> <strong>${completedOrders} (${pct(completedOrders)}%)</strong></li>
          <li><span class="dot shipping"></span> <span>Đang giao</span> <strong>${shippingOrders} (${pct(shippingOrders)}%)</strong></li>
          <li><span class="dot preparing"></span> <span>Đang chuẩn bị</span> <strong>${preparingOrders} (${pct(preparingOrders)}%)</strong></li>
          <li><span class="dot new"></span> <span>Đơn mới</span> <strong>${newOrders} (${pct(newOrders)}%)</strong></li>
          <li><span class="dot cancelled"></span> <span>Đã hủy</span> <strong>${cancelledOrders} (${pct(cancelledOrders)}%)</strong></li>
        </ul>
      </div>
    `;
  }

  const filter = orderFilter;
  if ($('#order-filter-pills')) {
    const pills = [
      ['all', `Tất cả (${totalOrders})`],
      ['new', `Đơn mới (${newOrders})`],
      ['preparing', `Đang chuẩn bị (${preparingOrders})`],
      ['shipping', `Đang giao (${shippingOrders})`],
      ['complete', `Hoàn tất (${completedOrders})`],
      ['cancelled', `Đã hủy (${cancelledOrders})`]
    ];
    $('#order-filter-pills').innerHTML = pills.map(([val, label]) =>
      `<button type="button" class="filter-pill ${filter === val ? 'active' : ''}" data-order-filter-pill="${val}">${esc(label)}</button>`
    ).join('');
  }

  const q = orderSearchQuery.toLocaleLowerCase('vi');
  const filtered = data.orders.filter(o => {
    if (filter !== 'all' && o.status !== filter) return false;
    if (!q) return true;
    return (
      (o.code || '').toLowerCase().includes(q) ||
      (o.name || '').toLocaleLowerCase('vi').includes(q) ||
      (o.phone || '').includes(q)
    );
  });

  $('#orders-list').innerHTML = filtered.length
    ? `<div class="orders-table-wrap"><table class="orders-table"><thead><tr><th scope="col">Mã đơn hàng</th><th scope="col">Ngày đặt</th><th scope="col">Khách hàng</th><th scope="col">Tổng tiền</th><th scope="col">Thanh toán</th><th scope="col">Tiến độ giao hàng</th><th scope="col">Thao tác</th></tr></thead><tbody>${filtered.map(orderHTML).join('')}</tbody></table></div>`
    : '<p class="empty-note">Không có đơn hàng nào khớp bộ lọc hiện tại.</p>';
  if (expandedOrderCode) {
    const row = document.getElementById('detail-' + expandedOrderCode);
    const button = document.querySelector(`[data-detail="${expandedOrderCode}"]`);
    if (row && button) { row.hidden = false; button.setAttribute('aria-expanded', 'true'); }
  }
}

function renderCustomers() {
  const summary = data.customer_summary || {};
  const list = data.customers || [];

  if ($('#customers-stats')) {
    const top = summary.top_customer;
    $('#customers-stats').innerHTML = `
      <div class="stat">
        <span>Khách đã đăng ký</span>
        <strong>${summary.total_registered ?? list.length}</strong>
        <small>${summary.returning_customers || 0} khách quay lại (≥ 2 đơn)</small>
      </div>
      <div class="stat">
        <span>Khách mua nhiều nhất</span>
        <strong>${top ? esc(top.name || top.email) : 'Chưa có'}</strong>
        <small>${top ? `${top.order_count} đơn • Chi tiêu: ${money(top.total_spent)}` : 'Chưa có đơn từ tài khoản'}</small>
      </div>
      <div class="stat">
        <span>Đơn khách vãng lai</span>
        <strong>${summary.guest_order_count || 0} đơn</strong>
        <small>Quản lý tại mục Đơn hàng (không tự gộp theo SĐT)</small>
      </div>
    `;
  }

  if (!list.length) {
    $('#customers-list').innerHTML = '<p class="empty-note">Chưa có khách hàng đăng ký phù hợp.</p>';
    return;
  }
  $('#customers-list').innerHTML = `<div class="customer-table-wrap"><table class="customer-table">
    <thead>
      <tr>
        <th>Khách hàng</th>
        <th>Email</th>
        <th>Số điện thoại</th>
        <th>Ngày đăng ký</th>
        <th>Số đơn</th>
        <th>Tổng chi tiêu</th>
        <th>Đơn gần nhất</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${list.map(c => {
        const latest = c.latest_order
          ? `<strong>${esc(c.latest_order.code)}</strong><br><small>${new Date(c.latest_order.created_at).toLocaleDateString('vi-VN')} • ${money(c.latest_order.total)}</small>`
          : '<span class="muted">Chưa có đơn</span>';
        return `<tr class="${selectedCustomerId === c.id ? 'active-row' : ''}">
          <td data-label="Khách hàng"><strong>${esc(c.name || 'Chưa cập nhật')}</strong></td>
          <td data-label="Email">${esc(c.email)}</td>
          <td data-label="Số điện thoại"><code>${esc(c.phone_masked || c.phone || 'Chưa cập nhật')}</code></td>
          <td data-label="Ngày đăng ký">${new Date(c.created_at).toLocaleDateString('vi-VN')}</td>
          <td data-label="Số đơn"><strong>${c.order_count}</strong></td>
          <td data-label="Tổng chi tiêu"><strong class="price-text">${money(c.total_spent || 0)}</strong></td>
          <td data-label="Đơn gần nhất">${latest}</td>
          <td><button type="button" class="small-button" data-customer="${c.id}">Chi tiết</button></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>`;
}

async function loadCustomerDetail(id) {
  selectedCustomerId = Number(id);
  renderCustomers();
  try {
    customerDetail = await api('/api/admin/customers/' + selectedCustomerId);
    renderCustomerDetail();
  } catch (err) {
    message(err.message);
  }
}

function renderCustomerDetail() {
  const wrap = $('#customer-detail-content');
  if (!customerDetail || !customerDetail.customer) {
    wrap.innerHTML = '<p class="empty-note">Chọn một khách hàng ở danh sách để xem thông tin chi tiết và lịch sử đơn hàng.</p>';
    return;
  }
  clearTimeout(revealExpiryTimer);
  const { customer: c, orders, sensitive_unlocked, sensitive_expires_at } = customerDetail;
  if (sensitive_unlocked && sensitive_expires_at) {
    const remaining = Math.max(500, sensitive_expires_at - Date.now() + 100);
    revealExpiryTimer = setTimeout(() => {
      if (selectedCustomerId === c.id) loadCustomerDetail(c.id);
    }, remaining);
  }
  const ordersMarkup = orders && orders.length
    ? orders.map(o => `<article class="order-card">
        <div class="order-header">
          <strong>${esc(o.code)} • ${money(o.total)}</strong>
          <span class="badge ${esc(o.status)}">${esc(statusName[o.status] || o.status)}</span>
        </div>
        <p>${formatDateTime(o.created_at)} • Thanh toán: ${o.payment === 'cod' ? 'COD' : 'Chuyển khoản VietQR'}</p>
        <p>Người nhận: ${esc(o.name)} • SĐT: ${esc(o.phone)} • Địa chỉ: ${esc(o.address)}</p>
        <p>Món: ${o.items.map(i => `${esc(i.name)} × ${i.qty}`).join(', ')}</p>
      </article>`).join('')
    : '<p class="empty-note">Khách hàng này chưa có đơn đặt bằng tài khoản.</p>';

  wrap.innerHTML = `
    <div class="customer-detail-box">
      <div class="customer-mini-stats">
        <div class="mini-stat-box"><span>Tổng số đơn</span><strong>${c.order_count ?? (orders ? orders.length : 0)}</strong></div>
        <div class="mini-stat-box"><span>Tổng chi tiêu</span><strong>${money(c.total_spent || 0)}</strong></div>
      </div>
      <div class="detail-field"><span>Họ và tên:</span> <strong>${esc(c.name || 'Chưa cập nhật')}</strong></div>
      <div class="detail-field"><span>Email:</span> <strong>${esc(c.email)}</strong></div>
      <div class="detail-field"><span>Ngày đăng ký:</span> <strong>${formatDateTime(c.created_at)}</strong></div>
      <div class="detail-field">
        <span>Số điện thoại:</span>
        <strong>${esc(c.phone || 'Chưa cập nhật')}</strong>
        <span class="badge ${sensitive_unlocked ? 'complete' : ''}">${sensitive_unlocked ? 'Đầy đủ' : 'Đã che'}</span>
      </div>
      <div class="detail-field">
        <span>Địa chỉ đã lưu:</span>
        <strong>${esc(c.address || 'Chưa cập nhật')}</strong>
      </div>
      ${!sensitive_unlocked ? `
        <form id="reveal-sensitive-form" class="reveal-form" data-customer-id="${c.id}">
          <p>🔒 Thông tin liên hệ đang được bảo mật. Nhập lại mật khẩu admin để hiển thị đầy đủ SĐT và địa chỉ (chỉ mở trong thời gian ngắn):</p>
          <div class="reveal-row">
            <input name="password" type="password" required autocomplete="current-password" placeholder="Mật khẩu admin">
            <button type="submit" class="button red">Mở khóa thông tin</button>
          </div>
        </form>
      ` : `<p class="unlocked-note">🔓 Đã xác thực mật khẩu admin. Thông tin đầy đủ sẽ tự động ẩn lại khi hết hạn ngắn hạn.</p>`}
    </div>
    <h3 class="detail-subhead">Lịch sử mua hàng (${orders ? orders.length : 0})</h3>
    <div class="customer-orders-history">${ordersMarkup}</div>
  `;
}

function productForm(p) {
  return `<form class="product-form edit-product" data-id="${p.id}" hidden>
    <h3>Chỉnh sửa sản phẩm</h3>
    <label>Tên <input name="name" value="${esc(p.name)}" required maxlength="100"></label>
    <label>Danh mục <select name="category">${['Bánh tráng', 'Cơm cháy', 'Kẹo', 'Combo', 'Khác'].map(c => `<option ${p.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label>Quy cách <input name="weight" value="${esc(p.weight)}" required maxlength="40"></label>
    <label>Giá (₫) <input name="price" type="number" min="0" step="1000" value="${p.price}" required></label>
    <label>Tồn kho <input name="stock" type="number" min="0" step="1" value="${p.stock}" required></label>
    <label>Mô tả <textarea name="description" maxlength="1000">${esc(p.description)}</textarea></label>
    <label>Thay ảnh (nếu cần) <input name="photo" type="file" accept="image/jpeg,image/png"></label>
    <label class="radio"><input name="active" type="checkbox" ${p.active ? 'checked' : ''}> Hiển thị sản phẩm</label>
    <button class="button red" type="submit">Lưu thay đổi</button>
    <button class="btn-delete-product" type="button" data-delete-product="${p.id}">Xóa sản phẩm</button>
  </form>`;
}

function renderProducts() {
  const analytics = (data.dashboard && data.dashboard.product_analytics) || { stats_started_at: null, most_viewed: [], most_cart_added: [] };
  if ($('#analytics-since-note')) {
    $('#analytics-since-note').textContent = analytics.stats_started_at
      ? `Ghi nhận thực tế từ thời điểm triển khai (${formatDateTime(analytics.stats_started_at)}). Có chống lặp cơ bản, không tạo dữ liệu lịch sử giả.`
      : 'Chỉ ghi nhận lượt xem và thêm vào giỏ thực tế từ thời điểm triển khai.';
  }
  if ($('#product-analytics')) {
    const viewedList = (analytics.most_viewed || []).filter(p => Number(p.views || 0) > 0).slice(0, 3);
    const cartAddedList = (analytics.most_cart_added || []).filter(p => Number(p.cart_adds || 0) > 0).slice(0, 3);
    $('#product-analytics').innerHTML = `
      <div class="analytics-col">
        <h3>👁️ Sản phẩm được xem nhiều nhất</h3>
        ${viewedList.length ? `<ol class="analytics-rank-list">
          ${viewedList.map(p => `<li>
            <img src="${esc(photo(p))}" alt="">
            <div>
              <strong>${esc(p.name)}</strong>
              <small>${esc(p.category)} • ${money(p.price)}</small>
            </div>
            <span class="badge complete">${p.views} lượt xem</span>
          </li>`).join('')}
        </ol>` : '<p class="empty-note">Chưa có lượt xem trang chi tiết sản phẩm nào từ khi triển khai.</p>'}
      </div>
      <div class="analytics-col">
        <h3>🛒 Sản phẩm được thêm vào giỏ nhiều nhất</h3>
        ${cartAddedList.length ? `<ol class="analytics-rank-list">
          ${cartAddedList.map(p => `<li class="analytics-clickable">
            ${p.active ? `<a class="analytics-product-link" href="${esc(p.url)}" target="_blank" rel="noopener" aria-label="Xem ${esc(p.name)} để mua">` : '<div class="analytics-product-link">'}
              <img src="${esc(photo(p))}" alt="">
              <span><strong>${esc(p.name)}</strong><small>${esc(p.category)} • ${money(p.price)}</small></span>
            ${p.active ? '</a>' : '</div>'}
            <span class="badge preparing">${p.cart_adds} lần thêm</span>
          </li>`).join('')}
        </ol>` : '<p class="empty-note">Chưa có lượt thêm vào giỏ nào từ khi triển khai.</p>'}
      </div>
    `;
  }

  const q = productSearchQuery.toLocaleLowerCase('vi');
  const filtered = data.products.filter(p => !q || (p.name || '').toLocaleLowerCase('vi').includes(q) || (p.category || '').toLocaleLowerCase('vi').includes(q))
    .sort((a, b) => (a.stock === 0 ? 0 : a.stock < 5 ? 1 : 2) - (b.stock === 0 ? 0 : b.stock < 5 ? 1 : 2));
  $('#products-list').innerHTML = filtered.map(p => `
    <div class="product-admin-card ${p.stock === 0 ? 'stock-out' : p.stock < 5 ? 'stock-low' : ''}">
      <img src="${esc(photo(p))}" alt="">
      <div>
        <h3>${esc(p.name)} ${p.stock === 0 ? '<span class="badge stock-out">Hết hàng</span>' : p.stock < 5 ? `<span class="badge stock-low">Sắp hết (${p.stock})</span>` : ''}</h3>
        <p>${esc(p.category)} • ${esc(p.weight)} • <strong>${money(p.price)}</strong> • Tồn kho: <strong>${p.stock}</strong> • ${p.active ? 'Đang hiện' : 'Đã ẩn'}</p>
        <small class="muted">Lượt xem: ${Number(p.views || 0)} • Thêm vào giỏ: ${Number(p.cart_adds || 0)}</small>
      </div>
      <button class="small-button" type="button" data-edit="${p.id}">Chỉnh sửa</button>
    </div>
    ${productForm(p)}
  `).join('');
}

function renderSettings() {
  const s = data.settings || {};
  const f = $('#settings-form');
  if (!f) return;
  for (const name of ['shipping_area', 'shipping_fee', 'bank_details', 'bank_name', 'bank_bin', 'bank_account_no', 'bank_account_name', 'phone', 'email', 'hero_title', 'hero_text', 'about_text', 'shipping_policy', 'return_policy']) {
    if (f.elements[name]) {
      if (name === 'bank_name') f.elements[name].value = s[name] || 'VIB';
      else if (name === 'bank_bin') f.elements[name].value = s[name] || '970441';
      else if (name === 'bank_account_no') f.elements[name].value = s[name] || '937799180';
      else if (name === 'email') f.elements[name].value = s[name] || 'Anvathouse@gmail.com';
      else f.elements[name].value = s[name] || '';
    }
  }
  if (f.elements.accepting_orders) f.elements.accepting_orders.checked = s.accepting_orders === '1';
  if (f.elements.cod_enabled) f.elements.cod_enabled.checked = s.cod_enabled !== '0';
  if (f.elements.bank_enabled) f.elements.bank_enabled.checked = s.bank_enabled !== '0';
}

async function upload(file) {
  if (!file) return null;
  if (file.size > 4000000 || !['image/jpeg', 'image/png'].includes(file.type)) {
    throw new Error('Ảnh phải là JPG hoặc PNG, tối đa 4 MB.');
  }
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return (await api('/api/admin/upload', { method: 'POST', body: JSON.stringify({ type: file.type, data: base64 }) })).image;
}

function productBody(form) {
  const f = new FormData(form);
  return {
    name: f.get('name'),
    category: f.get('category'),
    weight: f.get('weight'),
    price: Number(f.get('price')),
    stock: Number(f.get('stock')),
    description: f.get('description'),
    active: form.classList.contains('edit-product') ? f.has('active') : true
  };
}

$('#login-form').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username: f.get('username'), password: f.get('password') })
    });
    e.target.reset();
    e.target.elements.username.value = 'anvathouse@gmail.com';
    $('#login-error').textContent = '';
    await load();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
};

$('#logout').onclick = async () => {
  await api('/api/admin/logout', { method: 'POST' });
  clearTimeout(revealExpiryTimer);
  selectedCustomerId = null;
  customerDetail = null;
  $('#admin-view').hidden = true;
  $('#login-view').hidden = false;
};

document.addEventListener('click', async e => {
  const period = e.target.closest('[data-revenue-period]');
  if (period) { revenuePeriod = period.dataset.revenuePeriod; renderOrders(); return; }
  const t = e.target.closest('[data-tab]');
  if (t) { showTab(t.dataset.tab); return; }
  const g = e.target.closest('[data-goto]');
  if (g) { showTab(g.dataset.goto); return; }
  const pill = e.target.closest('[data-order-filter-pill]');
  if (pill) {
    orderFilter = pill.dataset.orderFilterPill;
    renderOrders();
    return;
  }
  const detail = e.target.closest('[data-detail]');
  if (detail) {
    expandedOrderCode = expandedOrderCode === detail.dataset.detail ? null : detail.dataset.detail;
    renderOrders();
    return;
  }
  const custBtn = e.target.closest('[data-customer]');
  if (custBtn) { await loadCustomerDetail(custBtn.dataset.customer); return; }
  const edit = e.target.closest('[data-edit]');
  if (edit) {
    const f = document.querySelector(`.edit-product[data-id="${edit.dataset.edit}"]`);
    if (f) {
      f.hidden = !f.hidden;
      if (!f.hidden) f.scrollIntoView({ block: 'center' });
    }
    return;
  }
  const deleteProduct = e.target.closest('[data-delete-product]');
  if (deleteProduct) {
    const product = data.products.find(p => p.id === Number(deleteProduct.dataset.deleteProduct));
    if (!product || !confirm(`Xóa sản phẩm “${product.name}” khỏi cửa hàng?`)) return;
    deleteProduct.disabled = true;
    try {
      await api('/api/admin/products/' + product.id, { method: 'DELETE' });
      await load();
      message('Đã xóa sản phẩm khỏi cửa hàng.');
    } catch (err) { deleteProduct.disabled = false; message(err.message); }
    return;
  }
  const action = e.target.closest('[data-order]');
  if (action) {
    try {
      const body = action.dataset.status ? { status: action.dataset.status } : { payment_paid: action.dataset.paid === '1' };
      await api('/api/admin/orders/' + action.dataset.order, { method: 'PATCH', body: JSON.stringify(body) });
      await load();
      message('Đã cập nhật đơn hàng.');
    } catch (err) {
      message(err.message);
    }
  }
});

if ($('#customer-search')) {
  $('#customer-search').addEventListener('input', e => {
    const q = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      try {
        const res = await api('/api/admin/customers?' + new URLSearchParams({ q }));
        data.customers = res.customers;
        if (res.summary) data.customer_summary = res.summary;
        renderCustomers();
      } catch (err) {
        message(err.message);
      }
    }, 200);
  });
}

if ($('#order-search')) {
  $('#order-search').addEventListener('input', e => {
    orderSearchQuery = e.target.value.trim();
    renderOrders();
  });
}

if ($('#product-admin-search')) {
  $('#product-admin-search').addEventListener('input', e => {
    productSearchQuery = e.target.value.trim();
    renderProducts();
  });
}

$('#new-product-toggle').onclick = () => { $('#new-product').hidden = !$('#new-product').hidden; };
$('#new-product').onsubmit = async e => {
  e.preventDefault();
  const button = e.target.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const body = productBody(e.target);
    body.image = await upload(e.target.elements.photo.files[0]);
    await api('/api/admin/products', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset();
    e.target.hidden = true;
    await load();
    message('Đã thêm sản phẩm.');
  } catch (err) {
    message(err.message);
  } finally {
    button.disabled = false;
  }
};

document.addEventListener('submit', async e => {
  if (e.target.id === 'reveal-sensitive-form') {
    e.preventDefault();
    const form = e.target;
    const customerId = form.dataset.customerId;
    const f = new FormData(form);
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      customerDetail = await api(`/api/admin/customers/${customerId}/reveal`, {
        method: 'POST',
        body: JSON.stringify({ password: f.get('password') })
      });
      form.reset();
      renderCustomerDetail();
      message('Đã xác thực mật khẩu và mở khóa thông tin khách hàng.');
    } catch (err) {
      message(err.message);
    } finally {
      btn.disabled = false;
    }
    return;
  }
  if (!e.target.classList.contains('edit-product')) return;
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const body = productBody(form);
    const image = await upload(form.elements.photo.files[0]);
    if (image) body.image = image;
    await api('/api/admin/products/' + form.dataset.id, { method: 'PATCH', body: JSON.stringify(body) });
    await load();
    message('Đã cập nhật sản phẩm.');
  } catch (err) {
    message(err.message);
  } finally {
    button.disabled = false;
  }
});

$('#settings-form').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = {
    accepting_orders: f.has('accepting_orders'),
    shipping_area: f.get('shipping_area') || '',
    shipping_fee: Number(f.get('shipping_fee') || 0),
    cod_enabled: f.has('cod_enabled'),
    bank_enabled: f.has('bank_enabled'),
    bank_name: f.get('bank_name') || 'VIB',
    bank_bin: f.get('bank_bin') || '970441',
    bank_account_no: f.get('bank_account_no') || '937799180',
    bank_account_name: f.get('bank_account_name') || '',
    bank_details: f.get('bank_details') || '',
    phone: f.get('phone') || '',
    email: f.get('email') || 'Anvathouse@gmail.com',
    hero_title: f.get('hero_title') || '',
    hero_text: f.get('hero_text') || '',
    hero_image: data.settings.hero_image || '',
    about_text: f.get('about_text') || '',
    shipping_policy: f.get('shipping_policy') || '',
    return_policy: f.get('return_policy') || ''
  };
  try {
    body.hero_image = await upload(e.target.elements.hero_photo.files[0]) || body.hero_image;
    await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(body) });
    await load();
    message('Đã lưu cài đặt cửa hàng.');
  } catch (err) {
    message(err.message);
  }
};

load();
