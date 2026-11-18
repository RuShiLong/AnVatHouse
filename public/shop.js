const money = n => new Intl.NumberFormat('vi-VN').format(n) + '₫';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const photo = p => p.image.startsWith('/uploads/') ? p.image : '/assets/products/' + p.image;
const slugify = text => String(text || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/Đ/g, 'D')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');
const productSlug = p => p.slug || `${p.id}-${slugify(p.name) || 'san-pham'}`;
const productUrl = p => p.url || `/san-pham/${productSlug(p)}`;
const cartIconSVG = () => '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M3 4h2l2.2 9.5a2 2 0 0 0 2 1.5h7.8a2 2 0 0 0 1.9-1.4L21 7H6.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="19" r="1.6" fill="currentColor"/><circle cx="17" cy="19" r="1.6" fill="currentColor"/><path d="M12 8v5M9.5 10.5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

const statusLabels = {
  new: 'Đơn mới',
  preparing: 'Đang chuẩn bị',
  shipping: 'Đang giao',
  complete: 'Hoàn tất',
  cancelled: 'Đã hủy'
};

let products = [], settings = {}, category = 'Tất cả', query = '';
let cart = {};
let checkoutMode = 'cart'; // 'cart' | 'buy-now'
let buyNowItems = null; // [{ id, qty }]
let auth = { role: 'guest', authenticated: false, customer: null };
let customerOrders = [];
const knownOrders = new Map();

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function recordProductEvent(productId, type) {
  if (!productId || !['view', 'cart_add'].includes(type)) return;
  fetch(`/api/products/${encodeURIComponent(productId)}/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type })
  }).catch(() => {});
}

try {
  cart = Object.fromEntries(
    Object.entries(JSON.parse(localStorage.getItem('avh_cart') || '{}'))
      .filter(([, qty]) => Number.isInteger(qty) && qty > 0 && qty <= 99)
  );
} catch {
  localStorage.removeItem('avh_cart');
}

const $ = s => document.querySelector(s);
const toast = message => {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
};
const saveCart = () => {
  localStorage.setItem('avh_cart', JSON.stringify(cart));
  renderCart();
};

function canAcceptOrders() {
  return Boolean(settings.accepting_orders && settings.shipping_fee !== null && settings.shipping_area);
}
function saleStatus(p) {
  const stockCount = p ? p.stock : 0;
  const stockLabel = stockCount > 0 ? `Tồn kho: ${stockCount} sản phẩm` : 'Tạm hết hàng (0)';
  if (!canAcceptOrders()) {
    return {
      canBuy: false,
      stockLabel,
      cardLabel: 'Cửa hàng tạm ngừng nhận đơn',
      detailReason: `Cửa hàng đang tạm ngừng nhận đơn trực tuyến (${stockLabel}).`
    };
  }
  if (!p || stockCount <= 0) {
    return {
      canBuy: false,
      stockLabel,
      cardLabel: 'Tạm hết hàng',
      detailReason: 'Tạm hết hàng'
    };
  }
  return {
    canBuy: true,
    stockLabel,
    cardLabel: `Còn ${stockCount} sản phẩm`,
    detailReason: `Đang bán • Còn ${stockCount} sản phẩm`
  };
}
function findProductByParam(param) {
  const clean = decodeURIComponent(String(param || '').trim()).toLowerCase();
  if (!clean) return null;
  if (/^\d+$/.test(clean)) return products.find(p => p.id === Number(clean)) || null;
  const idMatch = clean.match(/^(\d+)-(.+)$/);
  if (idMatch) {
    const byId = products.find(p => p.id === Number(idMatch[1]));
    if (byId && slugify(byId.name) === idMatch[2]) return byId;
  }
  return products.find(p => slugify(p.name) === clean || productSlug(p) === clean) || null;
}

async function load() {
  try {
    const r = await fetch('/api/products');
    if (!r.ok) throw new Error('Không tải được sản phẩm.');
    ({ products, settings } = await r.json());
    if ($('#shipping-info')) {
      $('#shipping-info').textContent = settings.shipping_area
        ? `${settings.shipping_area} • Phí giao ${money(settings.shipping_fee || 0)}`
        : 'Shop sẽ cập nhật khu vực và phí giao trước khi nhận đơn.';
    }
    if ($('#shipping-policy')) $('#shipping-policy').textContent = settings.shipping_policy || '';
    if ($('#return-policy-card')) $('#return-policy-card').hidden = !settings.return_policy;
    if ($('#return-policy')) $('#return-policy').textContent = settings.return_policy || '';
    if ($('#contact-phone')) $('#contact-phone').textContent = settings.phone || '';
    if ($('#contact-email') && settings.email) {
      $('#contact-email').textContent = settings.email;
      $('#contact-email').href = 'mailto:' + settings.email;
    }
    if (settings.hero_title) $('#hero-title').textContent = settings.hero_title;
    if (settings.hero_text) $('#hero-text').textContent = settings.hero_text;
    if (settings.about_text) $('#about-text').textContent = settings.about_text;
    if (settings.hero_image) {
      $('.hero-slide:first-child img').src = settings.hero_image;
      $('.hero-slide:first-child source').srcset = settings.hero_image;
    }
    $('#bank-option').hidden = !settings.bank_available;
    if (!settings.bank_available) $('#checkout-form').elements.payment.value = 'cod';
    renderFilters();
    renderProducts();
    renderCart();
    syncRoute();
  } catch (e) {
    $('#products').textContent = e.message;
  }
}

async function loadAuth() {
  try {
    const r = await fetch('/api/customer/me');
    if (r.ok) auth = await r.json();
  } catch {
    auth = { role: 'guest', authenticated: false, customer: null };
  }
  renderAuth();
  if (auth.role === 'customer') {
    await loadCustomerOrders();
  }
  if (location.pathname.startsWith('/don-hang/')) {
    syncRoute();
  }
}

async function loadCustomerOrders() {
  try {
    const r = await fetch('/api/customer/orders');
    if (!r.ok) return;
    const d = await r.json();
    customerOrders = d.orders || [];
    for (const o of customerOrders) knownOrders.set(o.code, o);
    renderCustomerOrders();
  } catch {
    customerOrders = [];
  }
}

function renderAuth() {
  const label = $('#account-label');
  const guestView = $('#account-guest-view');
  const userView = $('#account-user-view');
  const ownerView = $('#account-owner-view');
  const forgotToggle = $('#forgot-password-toggle');
  if (forgotToggle) {
    forgotToggle.hidden = !Boolean(auth.password_reset_enabled || settings.password_reset_enabled);
  }
  const urlParams = new URLSearchParams(location.search || '');
  const resetToken = urlParams.get('reset_token');
  if (resetToken && (auth.password_reset_enabled || settings.password_reset_enabled) && $('#customer-reset-form')) {
    $('#customer-login-form').hidden = true;
    $('#customer-register-form').hidden = true;
    if ($('#customer-forgot-form')) $('#customer-forgot-form').hidden = true;
    $('#customer-reset-form').hidden = false;
    $('#customer-reset-form').elements.token.value = resetToken;
    showAccount(true, false);
  }
  if (auth.role === 'customer' && auth.customer) {
    label.textContent = auth.customer.name || auth.customer.email;
    guestView.hidden = true;
    ownerView.hidden = true;
    userView.hidden = false;
    $('#account-user-email').textContent = auth.customer.email;
    const f = $('#customer-profile-form');
    f.elements.email.value = auth.customer.email || '';
    f.elements.name.value = auth.customer.name || '';
    f.elements.phone.value = auth.customer.phone || '';
    f.elements.address.value = auth.customer.address || '';
  } else if (auth.role === 'owner') {
    label.textContent = 'Chủ shop';
    guestView.hidden = true;
    userView.hidden = true;
    ownerView.hidden = false;
  } else {
    label.textContent = 'Tài khoản';
    guestView.hidden = false;
    userView.hidden = true;
    ownerView.hidden = true;
  }
}

function renderCustomerOrders() {
  const wrap = $('#customer-orders-list');
  if (!wrap) return;
  if (!customerOrders.length) {
    wrap.innerHTML = '<p class="empty-note">Chưa có đơn hàng nào được đặt bằng tài khoản này.</p>';
    return;
  }
  wrap.innerHTML = customerOrders.map(o => `
    <article class="customer-order-card">
      <div class="order-header">
        <strong>${esc(o.code)}</strong>
        <span class="badge ${esc(o.status)}">${esc(statusLabels[o.status] || o.status)}</span>
      </div>
      <p>${formatDateTime(o.created_at)} • Tổng: <strong>${money(o.total)}</strong></p>
      <p>${o.items.map(i => `${esc(i.name)} × ${i.qty}`).join(', ')}</p>
      <small>Người nhận: ${esc(o.name)} (${esc(o.phone)}) – ${esc(o.address)}</small>
      <div class="customer-order-actions">
        <a href="/don-hang/${esc(o.code)}" data-order-link="${esc(o.code)}" class="text-button">Xem chi tiết đơn →</a>
        ${['new', 'preparing'].includes(o.status) ? `<button type="button" class="btn-cancel-order" data-cancel-order="${esc(o.code)}">Hủy đơn</button>` : ''}
      </div>
    </article>
  `).join('');
}

const progressSteps = [
  { key: 'new', label: 'Đã đặt' },
  { key: 'preparing', label: 'Đang chuẩn bị' },
  { key: 'shipping', label: 'Đang giao' },
  { key: 'complete', label: 'Hoàn tất' }
];

function renderOrderProgressBar(order) {
  const historyMap = {};
  for (const h of (order.status_history || [])) {
    if (h && h.status && h.at) historyMap[h.status] = h.at;
  }
  if (!historyMap.new && order.created_at) historyMap.new = order.created_at;

  if (order.status === 'cancelled') {
    return `<div class="order-cancelled-banner" role="region" aria-label="Trạng thái đơn hàng">
      <div class="cancelled-badge-row">
        <span class="badge cancelled">Đơn hàng đã hủy</span>
        ${historyMap.cancelled ? `<small>Hủy lúc: ${esc(formatDateTime(historyMap.cancelled))}</small>` : ''}
      </div>
      <p>Đặt lúc: ${esc(formatDateTime(historyMap.new || order.created_at))} • Đơn hàng này đã dừng xử lý.</p>
    </div>`;
  }

  const currentIdx = progressSteps.findIndex(s => s.key === order.status);
  return `<div class="order-progress" role="list" aria-label="Tiến trình giao hàng">
    ${progressSteps.map((step, idx) => {
      const done = idx <= currentIdx;
      const current = idx === currentIdx;
      const stepTime = historyMap[step.key];
      return `<div class="progress-step ${done ? 'done' : ''} ${current ? 'current' : ''}" role="listitem">
        <div class="progress-node" aria-hidden="true">${done ? '✓' : (idx + 1)}</div>
        <strong class="progress-label">${esc(step.label)}</strong>
        ${stepTime ? `<small class="progress-time">${esc(formatDateTime(stepTime))}</small>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

function renderVietQrCard(order) {
  if (!order || order.payment !== 'bank') return '';
  const qr = order.vietqr || {
    bank_name: settings.bank_name || 'VIB',
    bin: settings.bank_bin || '970441',
    account_no: settings.bank_account_no || '937799180',
    account_name: settings.bank_account_name || null,
    amount: order.total,
    content: order.code,
    qr_url: `https://img.vietqr.io/image/970441-937799180-compact2.png?amount=${encodeURIComponent(order.total)}&addInfo=${encodeURIComponent(order.code)}`
  };
  const paid = Boolean(order.payment_paid);
  return `<aside class="vietqr-card" aria-label="Thanh toán qua VietQR">
    <div class="vietqr-head">
      <div class="vietqr-icon" aria-hidden="true">QR</div>
      <div>
        <h3>Thanh toán qua VietQR</h3>
        <p>Quét mã hoặc chuyển khoản đúng số tiền và nội dung bên dưới.</p>
      </div>
    </div>
    <div class="vietqr-frame">
      <img src="${esc(qr.qr_url)}" alt="Mã VietQR ngân hàng ${esc(qr.bank_name)} cho đơn ${esc(order.code)}" class="vietqr-image" loading="lazy">
    </div>
    <dl class="vietqr-details">
      <div class="vietqr-row">
        <dt>Ngân hàng</dt>
        <dd><strong>${esc(qr.bank_name)}</strong> <small>(BIN ${esc(qr.bin)})</small></dd>
      </div>
      <div class="vietqr-row">
        <dt>Số tài khoản</dt>
        <dd>
          <strong class="mono">${esc(qr.account_no)}</strong>
          <button type="button" class="copy-btn" data-copy="${esc(qr.account_no)}" aria-label="Sao chép số tài khoản">Sao chép</button>
        </dd>
      </div>
      ${qr.account_name ? `<div class="vietqr-row"><dt>Chủ tài khoản</dt><dd><strong>${esc(qr.account_name)}</strong></dd></div>` : ''}
      <div class="vietqr-row">
        <dt>Số tiền chuyển</dt>
        <dd>
          <strong class="price-highlight">${money(qr.amount)}</strong>
          <button type="button" class="copy-btn" data-copy="${esc(String(qr.amount))}" aria-label="Sao chép số tiền">Sao chép</button>
        </dd>
      </div>
      <div class="vietqr-row">
        <dt>Nội dung chuyển khoản</dt>
        <dd>
          <strong class="mono">${esc(qr.content)}</strong>
          <button type="button" class="copy-btn" data-copy="${esc(qr.content)}" aria-label="Sao chép nội dung chuyển khoản">Sao chép</button>
        </dd>
      </div>
    </dl>
    <div class="vietqr-status-bar ${paid ? 'is-paid' : 'is-pending'}" role="status">
      <span>${paid ? '✓ Đã xác nhận thanh toán' : '⏳ Chờ cửa hàng xác nhận thanh toán'}</span>
    </div>
  </aside>`;
}

function itemPhotoUrl(item) {
  if (item.image_url) return item.image_url;
  if (item.image) return item.image.startsWith('/uploads/') || item.image.startsWith('/assets/') ? item.image : '/assets/products/' + item.image;
  const matched = products.find(p => p.id === Number(item.id));
  return matched ? photo(matched) : '/assets/brand/avatar.png';
}

function renderOrderFullCard(order, opts = {}) {
  const shopPhone = settings.phone || '0937 799 180';
  const cleanShopPhone = shopPhone.replace(/\s+/g, '');
  const shopEmail = settings.email || 'Anvathouse@gmail.com';
  const paymentMethodLabel = order.payment === 'bank' ? 'Chuyển khoản ngân hàng (VietQR VIB)' : 'Thanh toán khi nhận hàng (COD)';
  const paymentStatusText = order.payment_status_label || (order.payment_paid ? 'Đã thanh toán' : (order.payment === 'bank' ? 'Chờ xác nhận thanh toán' : 'Thanh toán khi nhận hàng'));

  return `<article class="order-result-card" data-order-code="${esc(order.code)}">
    <div class="order-result-top">
      <div>
        <div class="order-code-line">
          <h3>Đơn ${esc(order.code)}</h3>
          <button type="button" class="copy-btn" data-copy="${esc(order.code)}">Sao chép mã</button>
        </div>
        <p class="order-date-meta">Đặt lúc ${esc(formatDateTime(order.created_at))}</p>
      </div>
      <span class="badge ${esc(order.status)}">${esc(statusLabels[order.status] || order.status)}</span>
    </div>

    ${renderOrderProgressBar(order)}
    ${auth.role === 'customer' && auth.customer && order.customer_id === auth.customer.id && ['new', 'preparing'].includes(order.status) ? `<button type="button" class="btn-cancel-order" data-cancel-order="${esc(order.code)}">Hủy đơn hàng</button>` : ''}

    <div class="order-result-grid ${order.payment === 'bank' ? 'with-qr' : ''}">
      <div class="order-main-col">
        <div class="order-items-box">
          <h4>Danh sách món</h4>
          <div class="order-item-list">
            ${(order.items || []).map(item => {
              const lineTotal = item.line_total ?? (Number(item.price) * Number(item.qty));
              return `<div class="order-line-item">
                <img src="${esc(itemPhotoUrl(item))}" alt="${esc(item.name)}" loading="lazy">
                <div class="order-line-info">
                  <strong>${esc(item.name)}</strong>
                  <small>${item.weight ? `${esc(item.weight)} • ` : ''}${item.qty} × ${money(item.price)}</small>
                </div>
                <strong class="order-line-total">${money(lineTotal)}</strong>
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="order-totals-box">
          <div class="total-line"><span>Tạm tính</span><strong>${money(order.subtotal)}</strong></div>
          <div class="total-line"><span>Phí giao hàng</span><strong>${money(order.shipping_fee)}</strong></div>
          <div class="total-line grand"><span>Tổng thanh toán</span><strong>${money(order.total)}</strong></div>
          <div class="payment-meta-rows">
            <div><span>Phương thức:</span> <strong>${esc(paymentMethodLabel)}</strong></div>
            <div><span>Trạng thái thanh toán:</span> <strong class="payment-badge ${order.payment_paid ? 'paid' : 'unpaid'}">${esc(paymentStatusText)}</strong></div>
          </div>
        </div>

        ${(order.name || order.address || order.phone) ? `
          <div class="order-recipient-box">
            <h4>Thông tin nhận hàng</h4>
            ${order.name ? `<p>Người nhận: <strong>${esc(order.name)}</strong></p>` : ''}
            ${order.phone ? `<p>Số điện thoại: <strong>${esc(order.phone)}</strong></p>` : ''}
            ${order.address ? `<p>Địa chỉ: <strong>${esc(order.address)}</strong></p>` : ''}
            ${order.note ? `<p>Ghi chú: <span>${esc(order.note)}</span></p>` : ''}
          </div>
        ` : ''}

        <div class="order-contact-box">
          <div>
            <strong>Liên hệ & Phản hồi cửa hàng</strong>
            <p>Cần hỗ trợ về đơn hàng ${esc(order.code)}? Hãy liên hệ ngay với Ăn Vặt House.</p>
          </div>
          <div class="order-contact-actions">
            <a class="button yellow small-btn" href="tel:${esc(cleanShopPhone)}">Gọi ${esc(shopPhone)}</a>
            <a class="button outline-red small-btn" href="mailto:${esc(shopEmail)}?subject=${encodeURIComponent('Phản hồi đơn hàng ' + order.code)}">Email cửa hàng</a>
          </div>
        </div>

        ${opts.showDetailLink ? `
          <div class="order-detail-cta">
            <a class="button red full" href="/don-hang/${esc(order.code)}" data-order-link="${esc(order.code)}">Xem chi tiết đơn →</a>
          </div>
        ` : ''}
      </div>

      ${order.payment === 'bank' ? `<div class="order-qr-col">${renderVietQrCard(order)}</div>` : ''}
    </div>
  </article>`;
}

function renderOrderConfirmationView(order) {
  return `<div class="order-confirm-banner">
    <div class="confirm-head">
      <span class="confirm-check" aria-hidden="true">✓</span>
      <div>
        <h3>ĐẶT HÀNG THÀNH CÔNG!</h3>
        <p>Cảm ơn bạn đã đặt hàng tại Ăn Vặt House! Chúng tôi đã ghi nhận đơn hàng <strong>${esc(order.code)}</strong> và sẽ sớm chuẩn bị để giao đến bạn.</p>
      </div>
    </div>
    ${renderOrderFullCard(order, { showDetailLink: true })}
  </div>`;
}

async function renderOrderDetailPage(code) {
  const container = $('#order-detail-page');
  if (!container) return;
  const cleanCode = String(code || '').trim().toUpperCase();
  let order = knownOrders.get(cleanCode) || customerOrders.find(o => o.code === cleanCode) || null;

  if (!order && (auth.role === 'customer' || auth.role === 'owner')) {
    try {
      const r = await fetch('/api/orders/' + encodeURIComponent(cleanCode));
      if (r.ok) {
        const d = await r.json();
        order = d.order;
        if (order) knownOrders.set(order.code, order);
      }
    } catch {}
  }

  if (order) {
    container.innerHTML = `<div class="wrap detail-wrap">
      <nav class="breadcrumb" aria-label="Đường dẫn">
        <a href="/" data-home-link>← Quay lại cửa hàng</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Chi tiết đơn ${esc(order.code)}</span>
      </nav>
      ${renderOrderFullCard(order, { showDetailLink: false })}
    </div>`;
    return;
  }

  container.innerHTML = `<div class="wrap detail-wrap">
    <nav class="breadcrumb" aria-label="Đường dẫn">
      <a href="/" data-home-link>← Quay lại cửa hàng</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">Tra cứu đơn ${esc(cleanCode)}</span>
    </nav>
    <div class="lookup-card-shell">
      <h2>Xem chi tiết đơn ${esc(cleanCode)}</h2>
      <p>Vui lòng nhập số điện thoại đã dùng khi đặt đơn này để xác thực và xem chi tiết.</p>
      <form id="order-page-lookup-form" class="lookup-bar">
        <label class="lookup-field">
          <span>Mã đơn hàng</span>
          <input name="code" value="${esc(cleanCode)}" required readonly>
        </label>
        <label class="lookup-field">
          <span>Số điện thoại</span>
          <input name="phone" required inputmode="tel" placeholder="Số điện thoại đặt hàng" autocomplete="tel">
        </label>
        <button class="button red lookup-submit-btn" type="submit">Xem đơn hàng</button>
      </form>
      <p id="order-page-lookup-error" class="auth-message" role="alert" hidden></p>
    </div>
  </div>`;
  const form = $('#order-page-lookup-form');
  if (form) {
    form.onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(form);
      const errEl = $('#order-page-lookup-error');
      errEl.hidden = true;
      const r = await fetch('/api/order?' + new URLSearchParams({ code: f.get('code'), phone: f.get('phone') }));
      const data = await r.json();
      if (!r.ok) {
        errEl.textContent = data.error || 'Không tìm thấy đơn hàng.';
        errEl.hidden = false;
        return;
      }
      knownOrders.set(data.order.code, data.order);
      renderOrderDetailPage(data.order.code);
    };
  }
}

function renderFilters() {
  const cats = ['Tất cả', ...new Set(products.map(p => p.category))];
  $('#filters').innerHTML = cats.map(c => `<button type="button" data-category="${esc(c)}" class="${category === c ? 'active' : ''}">${esc(c)}</button>`).join('');
}

function renderProducts() {
  const matches = products.filter(p => (category === 'Tất cả' || p.category === category) && p.name.toLocaleLowerCase('vi').includes(query));
  $('#products').innerHTML = matches.length ? matches.map(p => {
    const st = saleStatus(p);
    const url = productUrl(p);
    return `<article class="product-card" data-product-id="${p.id}">
      <a class="product-card-link product-image-link" href="${esc(url)}" data-product-link="${p.id}">
        <img src="${esc(photo(p))}" alt="${esc(p.name)}" loading="lazy">
      </a>
      <div class="product-info">
        <small>${esc(p.category)}</small>
        <h3><a class="product-card-link product-title-link" href="${esc(url)}" data-product-link="${p.id}">${esc(p.name)}</a></h3>
        <div class="product-meta-row">
          <p class="product-meta">Quy cách: ${esc(p.weight)}</p>
          <span class="stock-pill ${p.stock > 0 ? 'has-stock' : 'no-stock'}">${esc(st.stockLabel)}</span>
        </div>
        ${p.description ? `<div class="product-detail">${esc(p.description)}</div>` : ''}
        <div class="product-price-row">
          <strong>${money(p.price)}</strong>
          ${!canAcceptOrders() ? `<span class="sale-status unavailable">${esc(st.cardLabel)}</span>` : ''}
        </div>
        <div class="product-actions">
          <button type="button" class="btn-cart-icon" data-add="${p.id}" aria-label="Thêm ${esc(p.name)} vào giỏ" title="Thêm ${esc(p.name)} vào giỏ" ${st.canBuy ? '' : 'disabled'}>${cartIconSVG()}</button>
          <button type="button" class="btn-buy-now" data-buy-now="${p.id}" ${st.canBuy ? '' : 'disabled'}>Mua ngay</button>
        </div>
      </div>
    </article>`;
  }).join('') : '<p>Không tìm thấy món phù hợp.</p>';
}

function renderDetailPage(p) {
  const container = $('#product-page');
  if (!p) {
    container.innerHTML = `<div class="wrap detail-wrap"><nav class="breadcrumb"><a href="/" data-home-link>← Quay lại danh sách sản phẩm</a></nav><div class="admin-card"><h1>Không tìm thấy sản phẩm</h1><p>Sản phẩm không tồn tại hoặc đã ngừng hiển thị.</p><a class="button red" href="/" data-home-link>Về trang chủ</a></div></div>`;
    return;
  }
  const existingQtyInput = $('#detail-qty-input');
  const prevId = Number(container.querySelector('[data-detail-product-id]')?.dataset.detailProductId || 0);
  const currentQty = prevId === p.id && existingQtyInput ? Math.max(1, Math.min(Number(existingQtyInput.value) || 1, Math.max(1, p.stock))) : 1;
  const st = saleStatus(p);
  container.innerHTML = `<div class="wrap detail-wrap">
    <nav class="breadcrumb" aria-label="Đường dẫn">
      <a href="/" data-home-link>Trang chủ</a>
      <span aria-hidden="true">/</span>
      <a href="/#san-pham" data-category-link="${esc(p.category)}">${esc(p.category)}</a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">${esc(p.name)}</span>
    </nav>
    <article class="detail-card" data-detail-product-id="${p.id}">
      <div class="detail-media">
        <img id="detail-image" src="${esc(photo(p))}" alt="${esc(p.name)}">
      </div>
      <div class="detail-body">
        <span class="detail-category">${esc(p.category)}</span>
        <h1 id="detail-title">${esc(p.name)}</h1>
        <p class="detail-weight">Quy cách: <strong>${esc(p.weight)}</strong></p>
        <div class="detail-price">${money(p.price)}</div>
        <p class="detail-status ${st.canBuy ? 'in-stock' : 'unavailable'}" role="status">${esc(st.detailReason)}</p>
        <div class="detail-qty-row">
          <label for="detail-qty-input">Số lượng:</label>
          <div class="qty-selector">
            <button type="button" id="detail-qty-minus" data-detail-qty-minus="${p.id}" aria-label="Giảm số lượng" ${st.canBuy ? '' : 'disabled'}>−</button>
            <input id="detail-qty-input" type="number" min="1" max="${Math.max(1, p.stock)}" value="${currentQty}" aria-label="Số lượng" ${st.canBuy ? '' : 'disabled'}>
            <button type="button" id="detail-qty-plus" data-detail-qty-plus="${p.id}" aria-label="Tăng số lượng" ${st.canBuy ? '' : 'disabled'}>+</button>
          </div>
        </div>
        ${p.description ? `<div class="detail-description"><h2>Mô tả sản phẩm</h2><p>${esc(p.description)}</p></div>` : ''}
        <div class="product-actions detail-actions">
          <button type="button" class="btn-cart-icon" id="detail-add-btn" data-detail-add="${p.id}" aria-label="Thêm ${esc(p.name)} vào giỏ" title="Thêm ${esc(p.name)} vào giỏ" ${st.canBuy ? '' : 'disabled'}>${cartIconSVG()}</button>
          <button type="button" class="btn-buy-now" id="detail-buy-btn" data-detail-buy="${p.id}" ${st.canBuy ? '' : 'disabled'}>Mua ngay</button>
        </div>
      </div>
    </article>
  </div>`;
}

function syncRoute() {
  const path = location.pathname;
  const orderDetailEl = $('#order-detail-page');
  if (path.startsWith('/san-pham/')) {
    const param = path.slice('/san-pham/'.length);
    const p = findProductByParam(param);
    renderDetailPage(p);
    $('#home-view').hidden = true;
    $('#product-page').hidden = false;
    if (orderDetailEl) orderDetailEl.hidden = true;
    if (p) recordProductEvent(p.id, 'view');
    document.title = p ? `${p.name} – Ăn Vặt House` : 'Không tìm thấy sản phẩm – Ăn Vặt House';
  } else if (path.startsWith('/don-hang/')) {
    const code = path.slice('/don-hang/'.length);
    $('#home-view').hidden = true;
    $('#product-page').hidden = true;
    if (orderDetailEl) {
      orderDetailEl.hidden = false;
      renderOrderDetailPage(code);
    }
    document.title = `Đơn hàng ${code} – Ăn Vặt House`;
  } else {
    $('#product-page').hidden = true;
    if (orderDetailEl) orderDetailEl.hidden = true;
    $('#home-view').hidden = false;
    document.title = 'Ăn Vặt House – Ăn gì cũng vui';
  }
}

function navigateTo(url, scrollTarget) {
  if (location.pathname !== url) {
    history.pushState({}, '', url);
  }
  syncRoute();
  if (scrollTarget) {
    const el = document.getElementById(scrollTarget);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function renderCart() {
  const lines = products.filter(p => cart[p.id] > 0);
  const totalCount = Object.entries(cart).reduce((n, [id, qty]) => {
    const exists = !products.length || products.some(p => p.id === Number(id));
    return exists ? n + qty : n;
  }, 0);
  $('#cart-count').textContent = totalCount;
  $('#cart-items').innerHTML = lines.length ? lines.map(p => {
    const qty = cart[p.id];
    const stockNote = p.stock <= 0 ? ' (Tạm hết hàng)' : (qty > p.stock ? ` (Chỉ còn ${p.stock})` : '');
    return `<div class="cart-item">
      <a href="${esc(productUrl(p))}" data-product-link="${p.id}" aria-label="Xem sản phẩm ${esc(p.name)}"><img src="${esc(photo(p))}" alt=""></a>
      <div>
        <a class="cart-product-link" href="${esc(productUrl(p))}" data-product-link="${p.id}"><strong>${esc(p.name)}${esc(stockNote)}</strong></a>
        <small>${money(p.price)} • ${esc(p.weight)}</small>
        <div class="quantity">
          <button type="button" data-qty="${p.id}" data-change="-1" aria-label="Giảm ${esc(p.name)}">−</button>
          <span>${qty}</span>
          <button type="button" data-qty="${p.id}" data-change="1" aria-label="Tăng ${esc(p.name)}">+</button>
        </div>
      </div>
      <button class="remove" type="button" data-remove="${p.id}" aria-label="Xóa ${esc(p.name)}">×</button>
    </div>`;
  }).join('') : '<p>Giỏ hàng đang trống. Chọn món bạn thích nhé!</p>';
  const subtotal = lines.reduce((n, p) => n + p.price * cart[p.id], 0);
  $('#cart-subtotal').textContent = money(subtotal);
  const allAvailable = lines.length > 0 && lines.every(p => p.stock >= cart[p.id]);
  $('#checkout-toggle').disabled = !allAvailable || !canAcceptOrders();
}

function updateScrim() {
  const cartOpen = $('#cart-panel').classList.contains('open');
  const accountOpen = $('#account-panel').classList.contains('open');
  $('#scrim').hidden = !(cartOpen || accountOpen);
}

function showCart(open) {
  if (open) showAccount(false, false);
  $('#cart-panel').classList.toggle('open', open);
  $('#cart-panel').inert = !open;
  $('#cart-panel').setAttribute('aria-hidden', String(!open));
  updateScrim();
  if (open) $('#cart-close').focus();
}

function showAccount(open, moveFocus = true) {
  if (open) showCart(false);
  $('#account-panel').classList.toggle('open', open);
  $('#account-panel').inert = !open;
  $('#account-panel').setAttribute('aria-hidden', String(!open));
  updateScrim();
  if (open && moveFocus) $('#account-close').focus();
}

function getActiveCheckoutLines() {
  if (checkoutMode === 'buy-now' && Array.isArray(buyNowItems) && buyNowItems.length) {
    return buyNowItems.map(item => {
      const p = products.find(x => x.id === Number(item.id));
      return p ? { product: p, qty: Number(item.qty) } : null;
    }).filter(Boolean);
  }
  return products.filter(p => cart[p.id] > 0).map(p => ({ product: p, qty: cart[p.id] }));
}

function showCheckout(open) {
  if (open && auth.role !== 'customer') {
    showCart(false);
    showAccount(true);
    toast('Vui lòng đăng nhập hoặc đăng ký để mua hàng.');
    return;
  }
  $('#checkout').hidden = !open;
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) {
    showCart(false);
    showAccount(false, false);
    $('#checkout-message').hidden = true;
    $('#checkout-message').innerHTML = '';
    const form = $('#checkout-form');
    form.hidden = false;
    $('.order-summary').hidden = false;
    if (auth.role === 'customer' && auth.customer) {
      form.elements.name.value = auth.customer.name || '';
      form.elements.phone.value = auth.customer.phone || '';
      form.elements.address.value = auth.customer.address || '';
    }
    renderSummary();
    $('#checkout-back').focus();
  }
}

function renderSummary() {
  const lines = getActiveCheckoutLines();
  const subtotal = lines.reduce((n, l) => n + l.product.price * l.qty, 0);
  const modeNote = $('#checkout-mode-note');
  if (modeNote) {
    if (checkoutMode === 'buy-now') {
      modeNote.hidden = false;
      modeNote.textContent = 'Chế độ Mua ngay: Chỉ thanh toán sản phẩm vừa chọn. Giỏ hàng hiện tại của bạn được giữ nguyên.';
    } else {
      modeNote.hidden = true;
      modeNote.textContent = '';
    }
  }
  $('#summary-items').innerHTML = lines.map(l => `<div class="summary-line"><span>${esc(l.product.name)} × ${l.qty}</span><strong>${money(l.product.price * l.qty)}</strong></div>`).join('');
  $('#summary-subtotal').textContent = money(subtotal);
  $('#summary-shipping').textContent = money(settings.shipping_fee || 0);
  $('#summary-total').textContent = money(subtotal + (settings.shipping_fee || 0));
  $('#summary-area').textContent = `Khu vực giao: ${settings.shipping_area || 'Chưa cập nhật'}`;
}

function getDetailSelectedQty(p) {
  const input = $('#detail-qty-input');
  if (!input) return 1;
  const val = Math.floor(Number(input.value) || 1);
  const clamped = Math.max(1, Math.min(val, Math.max(1, p ? p.stock : 99)));
  input.value = String(clamped);
  return clamped;
}

function handleAddToCart(productId, qty) {
  const p = products.find(x => x.id === Number(productId));
  const st = saleStatus(p);
  if (!st.canBuy) {
    toast(st.detailReason);
    return;
  }
  const currentInCart = cart[p.id] || 0;
  if (currentInCart + qty > p.stock) {
    toast('Không đủ hàng trong kho.');
    return;
  }
  cart[p.id] = currentInCart + qty;
  saveCart();
  recordProductEvent(p.id, 'cart_add');
  toast(`Đã thêm ${qty} ${p.name} vào giỏ.`);
}

function handleBuyNow(productId, qty) {
  const p = products.find(x => x.id === Number(productId));
  const st = saleStatus(p);
  if (!st.canBuy) {
    toast(st.detailReason);
    return;
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > p.stock) {
    toast('Không đủ hàng trong kho.');
    return;
  }
  checkoutMode = 'buy-now';
  buyNowItems = [{ id: p.id, qty }];
  showCheckout(true);
}

document.addEventListener('click', e => {
  const cancel = e.target.closest('[data-cancel-order]');
  if (cancel) {
    if (!confirm('Bạn muốn hủy đơn hàng này?')) return;
    cancel.disabled = true;
    fetch(`/api/customer/orders/${encodeURIComponent(cancel.dataset.cancelOrder)}/cancel`, { method: 'POST' })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); await loadCustomerOrders(); await load(); toast('Đã hủy đơn hàng.'); })
      .catch(err => { toast(err.message); cancel.disabled = false; });
    return;
  }
  const filter = e.target.closest('[data-category]');
  if (filter) {
    category = filter.dataset.category;
    renderFilters();
    renderProducts();
    return;
  }

  const addBtn = e.target.closest('[data-add]');
  if (addBtn) {
    e.preventDefault();
    e.stopPropagation();
    handleAddToCart(Number(addBtn.dataset.add), 1);
    return;
  }

  const buyNowBtn = e.target.closest('[data-buy-now]');
  if (buyNowBtn) {
    e.preventDefault();
    e.stopPropagation();
    handleBuyNow(Number(buyNowBtn.dataset.buyNow), 1);
    return;
  }

  const detailAddBtn = e.target.closest('[data-detail-add]');
  if (detailAddBtn) {
    e.preventDefault();
    const id = Number(detailAddBtn.dataset.detailAdd);
    const p = products.find(x => x.id === id);
    const qty = getDetailSelectedQty(p);
    handleAddToCart(id, qty);
    return;
  }

  const detailBuyBtn = e.target.closest('[data-detail-buy]');
  if (detailBuyBtn) {
    e.preventDefault();
    const id = Number(detailBuyBtn.dataset.detailBuy);
    const p = products.find(x => x.id === id);
    const qty = getDetailSelectedQty(p);
    handleBuyNow(id, qty);
    return;
  }

  const minusBtn = e.target.closest('#detail-qty-minus');
  if (minusBtn) {
    const id = Number(minusBtn.dataset?.detailQtyMinus || $('#product-page').querySelector('[data-detail-product-id]')?.dataset.detailProductId);
    const p = products.find(x => x.id === id);
    const input = $('#detail-qty-input');
    if (input && p) {
      const next = Math.max(1, (Number(input.value) || 1) - 1);
      input.value = String(next);
    }
    return;
  }

  const plusBtn = e.target.closest('#detail-qty-plus');
  if (plusBtn) {
    const id = Number(plusBtn.dataset?.detailQtyPlus || $('#product-page').querySelector('[data-detail-product-id]')?.dataset.detailProductId);
    const p = products.find(x => x.id === id);
    const input = $('#detail-qty-input');
    if (input && p) {
      const current = Number(input.value) || 1;
      if (current + 1 > p.stock) {
        toast('Không đủ hàng trong kho.');
      } else {
        input.value = String(current + 1);
      }
    }
    return;
  }

  const productLink = e.target.closest('[data-product-link]');
  if (productLink && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    const p = products.find(x => x.id === Number(productLink.dataset.productLink));
    if (p) { showCart(false); navigateTo(productUrl(p)); }
    return;
  }

  const homeLink = e.target.closest('[data-home-link]');
  if (homeLink && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    navigateTo('/');
    return;
  }

  const catLink = e.target.closest('[data-category-link]');
  if (catLink && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    category = catLink.dataset.categoryLink;
    renderFilters();
    renderProducts();
    navigateTo('/', 'san-pham');
    return;
  }

  const navSec = e.target.closest('[data-nav-section]');
  if (navSec && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
    if (location.pathname !== '/') {
      e.preventDefault();
      navigateTo('/', navSec.dataset.navSection);
      return;
    }
  }

  const authTab = e.target.closest('[data-auth-tab]');
  if (authTab) {
    const mode = authTab.dataset.authTab;
    document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.toggle('active', b.dataset.authTab === mode));
    $('#customer-login-form').hidden = mode !== 'login';
    $('#customer-register-form').hidden = mode !== 'register';
    if ($('#customer-forgot-form')) $('#customer-forgot-form').hidden = true;
    if ($('#customer-reset-form')) $('#customer-reset-form').hidden = true;
    $('#account-auth-message').hidden = true;
    return;
  }

  if (e.target.closest('#forgot-password-toggle')) {
    if ($('#customer-forgot-form')) {
      $('#customer-login-form').hidden = true;
      $('#customer-register-form').hidden = true;
      $('#customer-forgot-form').hidden = false;
      $('#account-auth-message').hidden = true;
    }
    return;
  }

  const change = e.target.closest('[data-qty]');
  if (change) {
    const id = Number(change.dataset.qty);
    const p = products.find(x => x.id === id);
    const next = (cart[id] || 0) + Number(change.dataset.change);
    if (p && next > p.stock) return toast('Không đủ hàng trong kho.');
    if (next <= 0) delete cart[id];
    else cart[id] = next;
    saveCart();
    return;
  }

  const remove = e.target.closest('[data-remove]');
  if (remove) {
    delete cart[remove.dataset.remove];
    saveCart();
    return;
  }

  const logoutBtn = e.target.closest('[data-logout]');
  if (logoutBtn) {
    e.preventDefault();
    handleAccountLogout();
    return;
  }

  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    e.preventDefault();
    const val = copyBtn.dataset.copy || '';
    if (val && typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(val).catch(() => {});
    }
    toast(`Đã sao chép: ${val}`);
    return;
  }

  const orderLink = e.target.closest('[data-order-link]');
  if (orderLink && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    const code = orderLink.dataset.orderLink;
    if (!$('#checkout').hidden) showCheckout(false);
    showAccount(false, false);
    navigateTo(`/don-hang/${code}`);
  }
});

window.addEventListener('popstate', () => {
  syncRoute();
});

document.addEventListener('change', e => {
  if (e.target && e.target.id === 'detail-qty-input') {
    const id = Number($('#product-page').querySelector('[data-detail-product-id]')?.dataset.detailProductId);
    const p = products.find(x => x.id === id);
    getDetailSelectedQty(p);
  }
});

$('#search').addEventListener('input', e => {
  query = e.target.value.trim().toLocaleLowerCase('vi');
  renderProducts();
});
$('#show-combos').onclick = () => {
  category = 'Combo';
  renderFilters();
  renderProducts();
  $('#san-pham').scrollIntoView({ behavior: 'smooth' });
};
$('#cart-toggle').onclick = () => showCart(true);
$('#cart-close').onclick = () => showCart(false);
$('#account-toggle').onclick = () => showAccount(true);
$('#account-close').onclick = () => showAccount(false);
$('#scrim').onclick = () => {
  showCart(false);
  showAccount(false);
};
$('#checkout-toggle').onclick = () => {
  checkoutMode = 'cart';
  buyNowItems = null;
  showCheckout(true);
};
$('#checkout-back').onclick = () => showCheckout(false);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    showCart(false);
    showAccount(false, false);
    if (!$('#checkout').hidden) showCheckout(false);
  }
});

$('#checkout-form').onsubmit = async e => {
  e.preventDefault();
  if (auth.role !== 'customer') return showCheckout(true);
  const form = e.target;
  const button = form.querySelector('button[type=submit]');
  const f = new FormData(form);
  const activeLines = getActiveCheckoutLines();
  if (!activeLines.length) {
    toast('Không có sản phẩm nào để đặt hàng.');
    return;
  }
  const body = {
    name: f.get('name'),
    phone: f.get('phone'),
    address: f.get('address'),
    note: f.get('note'),
    payment: f.get('payment'),
    items: activeLines.map(l => ({ id: l.product.id, qty: l.qty })),
    expected_total: activeLines.reduce((n, l) => n + l.product.price * l.qty, 0) + (settings.shipping_fee || 0)
  };
  button.disabled = true;
  try {
    const r = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    const order = data.order;
    if (checkoutMode === 'cart') {
      cart = {};
      saveCart();
    } else {
      buyNowItems = null;
      saveCart();
    }
    await load();
    if (auth.role === 'customer') await loadCustomerOrders();
    knownOrders.set(order.code, order);
    $('#checkout-message').hidden = false;
    $('#checkout-message').innerHTML = renderOrderConfirmationView(order);
    form.hidden = true;
    $('.order-summary').hidden = true;
    $('#checkout-message').scrollIntoView();
  } catch (err) {
    toast(err.message);
    await load();
    renderSummary();
  } finally {
    button.disabled = false;
  }
};

$('#customer-login-form').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const msg = $('#account-auth-message');
  msg.hidden = true;
  try {
    const r = await fetch('/api/customer/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: f.get('email'), password: f.get('password') })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (data.role === 'owner') {
      location.href = '/admin';
      return;
    }
    e.target.reset();
    await loadAuth();
    if (buyNowItems) showCheckout(true);
    toast('Đã đăng nhập thành công.');
  } catch (err) {
    msg.textContent = err.message;
    msg.hidden = false;
  }
};

$('#customer-register-form').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const msg = $('#account-auth-message');
  msg.hidden = true;
  try {
    const r = await fetch('/api/customer/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: f.get('email'),
        password: f.get('password'),
        name: f.get('name'),
        phone: f.get('phone'),
        address: f.get('address')
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    e.target.reset();
    await loadAuth();
    if (buyNowItems) showCheckout(true);
    toast('Đã tạo tài khoản và đăng nhập.');
  } catch (err) {
    msg.textContent = err.message;
    msg.hidden = false;
  }
};

$('#customer-profile-form').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const statusEl = $('#profile-message');
  statusEl.hidden = true;
  try {
    const r = await fetch('/api/customer/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: f.get('name'),
        phone: f.get('phone'),
        address: f.get('address')
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    auth.customer = data.customer;
    renderAuth();
    statusEl.textContent = 'Đã cập nhật thông tin cá nhân.';
    statusEl.hidden = false;
    toast('Đã lưu thông tin cá nhân.');
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.hidden = false;
  }
};

if ($('#customer-forgot-form')) {
  $('#customer-forgot-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = $('#account-auth-message');
    msg.hidden = true;
    try {
      const r = await fetch('/api/customer/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: f.get('email') })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      e.target.reset();
      toast(data.message || 'Đã gửi liên kết đặt lại mật khẩu.');
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    }
  };
}
if ($('#customer-reset-form')) {
  $('#customer-reset-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = $('#account-auth-message');
    msg.hidden = true;
    try {
      const r = await fetch('/api/customer/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: f.get('token'), password: f.get('password') })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      e.target.reset();
      $('#customer-reset-form').hidden = true;
      $('#customer-login-form').hidden = false;
      history.replaceState({}, '', '/');
      toast('Đã đặt lại mật khẩu. Vui lòng đăng nhập.');
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    }
  };
}

async function handleAccountLogout() {
  await fetch('/api/customer/logout', { method: 'POST' });
  auth = { role: 'guest', authenticated: false, customer: null };
  customerOrders = [];
  renderAuth();
  renderCustomerOrders();
  toast('Đã đăng xuất tài khoản.');
}
$('#customer-logout').onclick = handleAccountLogout;
if ($('#owner-logout')) $('#owner-logout').onclick = handleAccountLogout;

$('#lookup-form').onsubmit = async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const resBox = $('#lookup-result');
  resBox.innerHTML = '<p class="lookup-loading">Đang tra cứu đơn hàng...</p>';
  const r = await fetch('/api/order?' + new URLSearchParams({ code: f.get('code'), phone: f.get('phone') }));
  const data = await r.json();
  if (!r.ok) {
    resBox.innerHTML = `<p class="lookup-error">${esc(data.error || 'Không tìm thấy đơn hàng.')}</p>`;
    return;
  }
  knownOrders.set(data.order.code, data.order);
  resBox.innerHTML = renderOrderFullCard(data.order, { showDetailLink: true });
};

const hero = $('.hero');
if (hero?.querySelectorAll) {
const heroSlides = [...hero.querySelectorAll('.hero-slide')];
const heroDots = [...hero.querySelectorAll('.hero-dots button')];
let heroIndex = 0, heroTimer;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function showHero(index) {
  heroIndex = (index + heroSlides.length) % heroSlides.length;
  heroSlides.forEach((slide, i) => {
    slide.classList.toggle('active', i === heroIndex);
    slide.setAttribute('aria-hidden', i !== heroIndex);
    heroDots[i].classList.toggle('active', i === heroIndex);
    if (i === heroIndex) heroDots[i].setAttribute('aria-current', 'true');
    else heroDots[i].removeAttribute('aria-current');
  });
  hero.dataset.theme = heroSlides[heroIndex].dataset.theme;
}

function startHero() {
  clearInterval(heroTimer);
  if (!reducedMotion.matches && !document.hidden && !hero.matches(':hover') && !hero.contains(document.activeElement)) heroTimer = setInterval(() => showHero(heroIndex + 1), 7000);
}

hero.querySelector('[data-hero-prev]').onclick = () => { showHero(heroIndex - 1); startHero(); };
hero.querySelector('[data-hero-next]').onclick = () => { showHero(heroIndex + 1); startHero(); };
heroDots.forEach((dot, i) => dot.onclick = () => { showHero(i); startHero(); });
hero.addEventListener('mouseenter', () => clearInterval(heroTimer));
hero.addEventListener('mouseleave', startHero);
hero.addEventListener('focusin', () => clearInterval(heroTimer));
hero.addEventListener('focusout', e => { if (!hero.contains(e.relatedTarget)) startHero(); });
document.addEventListener('visibilitychange', startHero);
reducedMotion.addEventListener('change', startHero);
showHero(0);
startHero();
}

load();
loadAuth();
