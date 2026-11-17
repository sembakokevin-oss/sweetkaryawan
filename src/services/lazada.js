const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Lazada Open Platform (resmi) - https://open.lazada.com
// Region Indonesia: https://api.lazada.co.id/rest | OAuth: https://auth.lazada.com
// Tanda tangan: HMAC-SHA256( path + parameter terurut key+value ) -> HEX huruf besar.
// Tanpa app key/secret/token -> MODE SIMULASI (data contoh).

const API = process.env.LAZADA_API_URL || 'https://api.lazada.co.id/rest';
const AUTH = 'https://auth.lazada.com';
const TOKEN_FILE = path.join(process.env.SWEET_DATA_DIR || path.join(__dirname, '../../data'), 'lazada_token.json');

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const SIM_PRODUCTS = [
  { item_id: 1001, sku: 'KOPI-250', name: 'Kopi Arabika 250g', price: 65000, qty: 40 },
  { item_id: 1002, sku: 'GELAS-01', name: 'Gelas Keramik Polos', price: 28000, qty: 4 },
  { item_id: 1003, sku: 'TUMB-500', name: 'Tumbler Stainless 500ml', price: 89000, qty: 18 },
  { item_id: 1004, sku: 'KAOS-PRM', name: 'Kaos Polos Premium', price: 75000, qty: 3 },
  { item_id: 1005, sku: 'TOTE-CNV', name: 'Tote Bag Kanvas', price: 45000, qty: 26 }
];

const jakartaISO = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 19) + '+07:00';

class LazadaService {
  constructor() {
    this.tok = null;
    try { this.tok = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch (_) {}
  }

  get cfg() {
    return {
      appKey: process.env.LAZADA_APP_KEY,
      appSecret: process.env.LAZADA_APP_SECRET,
      redirect: process.env.LAZADA_REDIRECT_URI || `${(process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/+$/, '')}/callback`
    };
  }

  get hasApp() { return !!(this.cfg.appKey && this.cfg.appSecret); }
  get hasToken() {
    return !!((this.tok && this.tok.access_token) || process.env.LAZADA_ACCESS_TOKEN);
  }
  get live() { return this.hasApp && this.hasToken; }
  get mode() { return this.live ? 'live' : this.hasApp ? 'perlu-otorisasi' : 'simulasi'; }

  _sign(apiPath, params) {
    const base = apiPath + Object.keys(params).sort().map((k) => k + params[k]).join('');
    return crypto.createHmac('sha256', this.cfg.appSecret).update(base).digest('hex').toUpperCase();
  }

  _saveToken(d) {
    this.tok = {
      access_token: d.access_token, refresh_token: d.refresh_token,
      expires_at: Date.now() + (d.expires_in || 604800) * 1000,
      refresh_expires_at: Date.now() + (d.refresh_expires_in || 2592000) * 1000,
      country: d.country, account: d.account
    };
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(this.tok, null, 2));
  }

  // ---------- OAuth ----------
  authUrl() {
    const { appKey, redirect } = this.cfg;
    return `${AUTH}/oauth/authorize?response_type=code&force_auth=true&redirect_uri=${encodeURIComponent(redirect)}&client_id=${appKey}`;
  }

  async _authCall(apiPath, extra) {
    const params = { app_key: this.cfg.appKey, timestamp: Date.now(), sign_method: 'sha256', ...extra };
    params.sign = this._sign(apiPath, params);
    let res;
    try {
      res = await axios.post(`${AUTH}/rest${apiPath}`, new URLSearchParams(params).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 });
    } catch (e) {
      const d = e.response && e.response.data;
      throw new Error(`Lazada auth gagal (${e.response ? 'HTTP ' + e.response.status : 'jaringan'}): ${(d && (d.message || d.code)) || e.message}`);
    }
    if (!res.data.access_token) throw new Error(`Lazada auth gagal: ${res.data.code || ''} ${res.data.message || 'tidak diketahui'}`.trim());
    this._saveToken(res.data);
    return res.data;
  }

  exchangeCode(code) { return this._authCall('/auth/token/create', { code }); }
  tokenInfo() { return this.tok ? { account: this.tok.account, country: this.tok.country, expires_at: this.tok.expires_at, refresh_expires_at: this.tok.refresh_expires_at } : null; }
  disconnect() { this.tok = null; try { fs.unlinkSync(TOKEN_FILE); } catch (_) {} }

  async _accessToken() {
    if (this.tok && this.tok.access_token) {
      if (Date.now() > this.tok.expires_at - 3600e3 && this.tok.refresh_token) {
        try { await this._authCall('/auth/token/refresh', { refresh_token: this.tok.refresh_token }); }
        catch (e) { console.warn('[Lazada] refresh token gagal:', e.message); }
      }
      return this.tok.access_token;
    }
    return process.env.LAZADA_ACCESS_TOKEN;
  }

  // ---------- Request ----------
  async _req(method, apiPath, params = {}, retry = true) {
    const sys = { app_key: this.cfg.appKey, timestamp: Date.now(), sign_method: 'sha256', access_token: await this._accessToken() };
    const all = { ...sys, ...params };
    sys.sign = this._sign(apiPath, all);
    const qs = new URLSearchParams(method === 'get' ? { ...all, sign: sys.sign } : sys).toString();
    let res;
    try {
      res = await axios({
        method, url: `${API}${apiPath}?${qs}`, timeout: 30000,
        data: method === 'post' ? new URLSearchParams(params).toString() : undefined,
        headers: method === 'post' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined
      });
    } catch (e) {
      throw new Error(`Lazada API error (${e.response ? e.response.status : 'network'}): ${e.message}`);
    }
    const d = res.data;
    if (d.code && d.code !== '0') {
      if (retry && /IllegalAccessToken|AccessToken/i.test(d.code) && this.tok && this.tok.refresh_token) {
        await this._authCall('/auth/token/refresh', { refresh_token: this.tok.refresh_token });
        return this._req(method, apiPath, params, false);
      }
      throw new Error(`Lazada: ${d.code} - ${d.message || ''}`);
    }
    return d;
  }

  _sim(data) { return { simulasi: true, catatan: 'Mode simulasi: isi LAZADA_APP_KEY/SECRET lalu otorisasi toko untuk data asli.', data }; }

  // ---------- Toko ----------
  async sellerInfo() {
    if (!this.live) return this._sim({ name: 'Toko Contoh SweetOffice', seller_id: 0 });
    return this._req('get', '/seller/get');
  }

  // ---------- Produk ----------
  async listProducts(filter = 'all', offset = 0, limit = 20) {
    if (!this.live) return this._sim(SIM_PRODUCTS.map((p) => ({ item_id: p.item_id, name: p.name, status: 'active', skus: [{ SellerSku: p.sku, price: p.price, quantity: p.qty, special_price: p.sale || undefined }] })));
    return this._req('get', '/products/get', { filter, offset, limit });
  }

  async getProduct(itemId) {
    if (!this.live) return this._sim({ item_id: itemId });
    return this._req('get', '/product/item/get', { item_id: itemId });
  }

  async updatePriceQuantity(sellerSku, { price, quantity, salePrice, saleStart, saleEnd }) {
    if (!this.live) return this._sim({ seller_sku: sellerSku, price, quantity, salePrice });
    const payload = `<Request><Product><Skus><Sku><SellerSku>${esc(sellerSku)}</SellerSku>` +
      (quantity !== undefined ? `<Quantity>${Number(quantity)}</Quantity>` : '') +
      (price !== undefined ? `<Price>${Number(price)}</Price>` : '') +
      (salePrice !== undefined ? `<SalePrice>${Number(salePrice)}</SalePrice><SaleStartDate>${esc(saleStart)}</SaleStartDate><SaleEndDate>${esc(saleEnd)}</SaleEndDate>` : '') +
      '</Sku></Skus></Product></Request>';
    return this._req('post', '/product/price_quantity/update', { payload });
  }

  async createProduct(p) {
    if (!this.live) return this._sim({ name: p.name, item_id: Math.floor(Math.random() * 1e6) });
    const images = (p.image_urls || []).map((u) => `<Image>${esc(u)}</Image>`).join('');
    const payload = `<Request><Product><PrimaryCategory>${Number(p.category_id)}</PrimaryCategory>` +
      `<Attributes><name>${esc(p.name)}</name><description>${esc(p.description || p.name)}</description>` +
      `<brand>${esc(p.brand || 'No Brand')}</brand></Attributes><Skus><Sku>` +
      `<SellerSku>${esc(p.seller_sku || `SW-${Date.now()}`)}</SellerSku><quantity>${Number(p.quantity || 1)}</quantity>` +
      `<price>${Number(p.price)}</price><package_length>${Number(p.length || 10)}</package_length>` +
      `<package_height>${Number(p.height || 10)}</package_height><package_width>${Number(p.width || 10)}</package_width>` +
      `<package_weight>${Number(p.weight_kg || 0.5)}</package_weight><Images>${images}</Images></Sku></Skus></Product></Request>`;
    return this._req('post', '/product/create', { payload });
  }

  // ---------- Pesanan ----------
  async listOrders(days = 2, status = '', offset = 0, limit = 20) {
    if (!this.live) return this._sim([
      { order_id: 900001, buyer: 'Budi', price: 150000, statuses: ['pending'] },
      { order_id: 900002, buyer: 'Siti', price: 250000, statuses: ['pending'] }
    ]);
    const params = { created_after: jakartaISO(Date.now() - Math.max(1, days) * 86400e3), sort_by: 'created_at', sort_direction: 'DESC', offset, limit };
    if (status) params.status = status; // pending, ready_to_ship, shipped, delivered, canceled, ...
    return this._req('get', '/orders/get', params);
  }

  async getOrder(orderId) {
    if (!this.live) return this._sim({ order_id: orderId, statuses: ['pending'] });
    return this._req('get', '/order/get', { order_id: orderId });
  }

  async getOrderItems(orderId) {
    if (!this.live) return this._sim([{ order_item_id: orderId * 10 + 1, name: 'Kopi Arabika 250g', status: 'pending' }]);
    return this._req('get', '/order/items/get', { order_id: orderId });
  }

  async packOrder(orderItemIds, shippingProvider) {
    if (!this.live) return this._sim({ packed: orderItemIds });
    const params = { delivery_type: 'dropship', order_item_ids: JSON.stringify(orderItemIds) };
    if (shippingProvider) params.shipping_provider = shippingProvider;
    return this._req('post', '/order/pack', params);
  }

  async readyToShip(orderItemIds, trackingNumber, shipmentProvider) {
    if (!this.live) return this._sim({ rts: orderItemIds });
    const params = { delivery_type: 'dropship', order_item_ids: JSON.stringify(orderItemIds) };
    if (trackingNumber) params.tracking_number = trackingNumber;
    if (shipmentProvider) params.shipment_provider = shipmentProvider;
    return this._req('post', '/order/rts', params);
  }

  // Dokumen pengiriman (label resi / invoice). doc_type: shippingLabel | invoice | carrierManifest
  async getDocument(orderItemIds, docType = 'shippingLabel') {
    if (!this.live) return this._sim({ document: { mime_type: 'text/html', file: Buffer.from('<h2>Label resi (simulasi)</h2><p>Item: ' + orderItemIds.join(', ') + '</p>').toString('base64') } });
    return this._req('get', '/order/document/get', { doc_type: docType, order_item_ids: JSON.stringify(orderItemIds) });
  }

  // ---------- Chat pembeli (Lazada IM) ----------
  async listChats(pageSize = 10) {
    if (!this.live) return this._sim([{ session_id: 'sim-1', buyer: 'Andi', last_message: 'Barang ready kak?', unread: 1 }]);
    return this._req('get', '/im/session/list', { start_time: Date.now() - 7 * 86400e3, last_session_id: '', page_size: pageSize });
  }

  async readChat(sessionId, pageSize = 15) {
    if (!this.live) return this._sim([{ session_id: sessionId, from: 'buyer', text: 'Barang ready kak?' }]);
    return this._req('get', '/im/message/list', { session_id: sessionId, start_time: Date.now(), last_message_id: '', page_size: pageSize });
  }

  async replyChat(sessionId, text) {
    if (!this.live) return this._sim({ session_id: sessionId, sent: text });
    return this._req('post', '/im/message/send', { session_id: sessionId, template_id: 1, txt: text });
  }
}

const svc = new LazadaService();
svc.SIM_PRODUCTS = SIM_PRODUCTS;
module.exports = svc;
