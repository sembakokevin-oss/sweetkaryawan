# SWEET AI Agent Office — jembatan MetaTrader 5 (khusus Windows).
# Menghubungkan server SWEET (Node.js) ke terminal MetaTrader 5 HFM lewat paket resmi "MetaTrader5".
# Server lokal hanya di 127.0.0.1, setiap permintaan wajib membawa header X-Key = MT5_BRIDGE_KEY.
#
# Dijalankan otomatis oleh server SWEET (MT5_AUTOSTART=true) atau manual: scripts\mt5-start.bat
# Syarat: Windows, Python 3 64-bit, "pip install MetaTrader5", dan terminal MetaTrader 5 HFM terpasang.
import json, os, sys, time, threading, traceback
from datetime import datetime, timezone, timedelta
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_env():
    """Baca .env bila variabel belum diberikan (mis. saat dijalankan manual)."""
    p = os.path.join(ROOT, '.env')
    if not os.path.exists(p):
        return
    with open(p, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            k, v = k.strip(), v.strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in '"\'':
                v = v[1:-1]
            if k and not os.environ.get(k):
                os.environ[k] = v


load_env()
LOGIN = int(os.environ.get('MT5_LOGIN') or 0)
PASSWORD = os.environ.get('MT5_PASSWORD', '')
SERVER = os.environ.get('MT5_SERVER', '')
PATH = os.environ.get('MT5_PATH', '').strip() or None
PORT = int(os.environ.get('MT5_BRIDGE_PORT') or 8765)
KEY = os.environ.get('MT5_BRIDGE_KEY', '')
WANT_SYMBOL = os.environ.get('MT5_SYMBOL', '').strip()
MAGIC = int(os.environ.get('MT5_MAGIC') or 160016)

try:
    import MetaTrader5 as mt5
except Exception as e:  # paket belum terpasang
    print('ERROR: paket MetaTrader5 belum terpasang. Jalankan scripts\\mt5-install.bat (' + str(e) + ')', flush=True)
    sys.exit(3)

LOCK = threading.Lock()
STATE = {'connected': False, 'error': None, 'symbol': None, 'offset': None, 'since': None}


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def asdict(x):
    if x is None:
        return None
    if hasattr(x, '_asdict'):
        return {k: (v.item() if hasattr(v, 'item') else v) for k, v in x._asdict().items()}
    return x


def connect(force=False):
    if STATE['connected'] and not force:
        info = mt5.account_info()
        if info is not None and info.login == LOGIN:
            return True
    if not LOGIN or not PASSWORD or not SERVER:
        STATE['error'] = 'MT5_LOGIN / MT5_PASSWORD / MT5_SERVER belum diisi di .env'
        return False
    try:
        mt5.shutdown()
    except Exception:
        pass
    kw = dict(login=LOGIN, password=PASSWORD, server=SERVER, timeout=60000)
    if PATH:
        kw['path'] = PATH
    ok = mt5.initialize(**kw)
    if not ok:
        code, msg = mt5.last_error()
        hint = ''
        if code in (-10005, -10003, -10004) or 'IPC' in str(msg):
            hint = ' — terminal MetaTrader 5 HFM belum terpasang / tidak bisa dibuka (isi MT5_PATH ke terminal64.exe)'
        elif code == -6 or 'uthoriz' in str(msg):
            hint = ' — login / password / server salah'
        STATE.update(connected=False, error='Gagal konek MT5: %s %s%s' % (code, msg, hint))
        log(STATE['error'])
        return False
    info = mt5.account_info()
    if info is None or info.login != LOGIN:
        if not mt5.login(LOGIN, password=PASSWORD, server=SERVER):
            STATE.update(connected=False, error='Login MT5 gagal: %s' % (mt5.last_error(),))
            return False
    STATE.update(connected=True, error=None, since=time.time())
    resolve_symbol()
    log('Terhubung ke MT5', LOGIN, SERVER, 'simbol', STATE['symbol'])
    return True


def resolve_symbol():
    if WANT_SYMBOL:
        mt5.symbol_select(WANT_SYMBOL, True)
        STATE['symbol'] = WANT_SYMBOL
        return WANT_SYMBOL
    cands = mt5.symbols_get('*XAUUSD*') or mt5.symbols_get('*GOLD*') or []
    best = None
    for s in cands:
        if s.trade_mode == 0:  # SYMBOL_TRADE_MODE_DISABLED
            continue
        score = (2 if s.name.upper().startswith('XAUUSD') else 0) + (1 if s.visible else 0) - len(s.name) * 0.01
        if best is None or score > best[0]:
            best = (score, s.name)
    name = best[1] if best else 'XAUUSD'
    mt5.symbol_select(name, True)
    STATE['symbol'] = name
    return name


def server_offset(tick=None):
    """Selisih jam server MT5 terhadap UTC (detik). Waktu deal MT5 memakai jam server."""
    tick = tick or (mt5.symbol_info_tick(STATE['symbol']) if STATE['symbol'] else None)
    if tick is not None and tick.time:
        diff = tick.time - time.time()
        if abs(diff) < 14 * 3600:
            off = round(diff / 1800) * 1800
            if abs((tick.time - off) - time.time()) < 600:  # tick masih segar
                STATE['offset'] = off
    if STATE['offset'] is None:
        m = datetime.now(timezone.utc).month
        STATE['offset'] = 3 * 3600 if 4 <= m <= 10 else 2 * 3600
    return STATE['offset']


def symbol_payload():
    sym = STATE['symbol'] or resolve_symbol()
    info = mt5.symbol_info(sym)
    tick = mt5.symbol_info_tick(sym)
    off = server_offset(tick)
    d = asdict(info) or {}
    keep = ['name', 'description', 'digits', 'point', 'spread', 'trade_mode', 'trade_stops_level', 'trade_freeze_level', 'volume_min', 'volume_max',
            'volume_step', 'trade_contract_size', 'currency_profit', 'currency_margin', 'filling_mode', 'expiration_mode', 'trade_tick_value', 'trade_tick_size']
    out = {k: d.get(k) for k in keep}
    t = asdict(tick) or {}
    out['bid'] = t.get('bid')
    out['ask'] = t.get('ask')
    out['tick_time'] = (t.get('time') or 0) - off if t else None
    out['fresh'] = bool(t) and abs(time.time() - ((t.get('time') or 0) - off)) < 300
    out['offset'] = off
    return out


TF = {'M1': mt5.TIMEFRAME_M1, 'M5': mt5.TIMEFRAME_M5, 'M15': mt5.TIMEFRAME_M15, 'M30': mt5.TIMEFRAME_M30, 'H1': mt5.TIMEFRAME_H1, 'H4': mt5.TIMEFRAME_H4, 'D1': mt5.TIMEFRAME_D1}


def rates(tf='M15', count=300):
    sym = STATE['symbol'] or resolve_symbol()
    arr = mt5.copy_rates_from_pos(sym, TF.get(tf, mt5.TIMEFRAME_M15), 0, int(count))
    off = server_offset()
    if arr is None:
        return []
    return [{'t': int(r['time']) - off, 'o': float(r['open']), 'h': float(r['high']), 'l': float(r['low']), 'c': float(r['close']), 'v': int(r['tick_volume'])} for r in arr]


def fix_times(d, off, keys=('time', 'time_setup', 'time_done', 'time_expiration', 'time_update')):
    for k in keys:
        if k in d and d[k]:
            d[k] = int(d[k]) - off
    for k in ('time_msc', 'time_setup_msc', 'time_done_msc', 'time_update_msc'):
        if k in d and d[k]:
            d[k] = int(d[k]) - off * 1000
    return d


def positions():
    off = server_offset()
    return [fix_times(asdict(p), off) for p in (mt5.positions_get() or [])]


def orders():
    off = server_offset()
    return [fix_times(asdict(o), off) for o in (mt5.orders_get() or [])]


def history(frm, to):
    off = server_offset()
    a = datetime.fromtimestamp(max(0, frm - 86400), tz=timezone.utc)
    b = datetime.fromtimestamp(to + 2 * 86400, tz=timezone.utc)
    deals = [fix_times(asdict(x), off) for x in (mt5.history_deals_get(a, b) or [])]
    ords = [fix_times(asdict(x), off) for x in (mt5.history_orders_get(a, b) or [])]
    return {'deals': deals, 'orders': ords}


def norm_price(p, digits):
    return round(float(p), int(digits))


def norm_volume(v, info):
    step = info.volume_step or 0.01
    v = max(info.volume_min, min(info.volume_max, float(v)))
    v = round(round(v / step) * step, 8)
    return v


OK_CODES = (10008, 10009, 10010)


def send(req, fills):
    last = None
    for f in fills:
        req['type_filling'] = f
        r = mt5.order_send(req)
        if r is None:
            last = {'retcode': -1, 'comment': str(mt5.last_error())}
            continue
        last = asdict(r)
        if 'request' in last:
            last['request'] = asdict(last['request'])
        if r.retcode in OK_CODES:
            return True, last
        if r.retcode != 10030:  # INVALID_FILL -> coba mode lain
            return False, last
    return False, last


def place_pending(body):
    sym = STATE['symbol'] or resolve_symbol()
    info = mt5.symbol_info(sym)
    tick = mt5.symbol_info_tick(sym)
    if info is None or tick is None:
        raise ValueError('Simbol %s tidak tersedia' % sym)
    kind = body.get('type')
    otype = {'buy_limit': mt5.ORDER_TYPE_BUY_LIMIT, 'sell_limit': mt5.ORDER_TYPE_SELL_LIMIT}.get(kind)
    if otype is None:
        raise ValueError('Jenis order harus buy_limit / sell_limit')
    pt, dg = info.point, info.digits
    gap = max(info.trade_stops_level, info.trade_freeze_level, 10) * pt
    price = norm_price(body['price'], dg)
    sl = norm_price(body['sl'], dg) if body.get('sl') else 0.0
    tp = norm_price(body['tp'], dg) if body.get('tp') else 0.0
    if not sl or not tp:
        raise ValueError('Setiap order wajib punya SL & TP')
    if kind == 'buy_limit':
        if price > tick.ask - gap:
            price = norm_price(tick.ask - gap, dg)
        if not (sl < price - gap and tp > price + gap):
            raise ValueError('SL/TP buy limit tidak valid')
    else:
        if price < tick.bid + gap:
            price = norm_price(tick.bid + gap, dg)
        if not (sl > price + gap and tp < price - gap):
            raise ValueError('SL/TP sell limit tidak valid')
    req = {'action': mt5.TRADE_ACTION_PENDING, 'symbol': sym, 'volume': norm_volume(body.get('volume', info.volume_min), info), 'type': otype,
           'price': price, 'sl': sl, 'tp': tp, 'deviation': 30, 'magic': MAGIC, 'comment': str(body.get('comment', 'SWEET Aurel'))[:28],
           'type_time': mt5.ORDER_TIME_GTC}
    mins = int(body.get('expiration_minutes') or 0)
    if mins > 0 and (info.expiration_mode & 4):  # SYMBOL_EXPIRATION_SPECIFIED
        req['type_time'] = mt5.ORDER_TIME_SPECIFIED
        req['expiration'] = int(tick.time) + mins * 60
    ok, res = send(req, [mt5.ORDER_FILLING_RETURN, mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC])
    if not ok and req.get('type_time') == mt5.ORDER_TIME_SPECIFIED:
        req['type_time'] = mt5.ORDER_TIME_GTC
        req.pop('expiration', None)
        ok, res = send(req, [mt5.ORDER_FILLING_RETURN, mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC])
    return {'ok': ok, 'result': res, 'price': price, 'volume': req['volume']}


def cancel(ticket):
    ok, res = send({'action': mt5.TRADE_ACTION_REMOVE, 'order': int(ticket)}, [mt5.ORDER_FILLING_RETURN])
    return {'ok': ok, 'result': res}


def close(ticket):
    pos = mt5.positions_get(ticket=int(ticket))
    if not pos:
        raise ValueError('Posisi %s tidak ditemukan' % ticket)
    p = pos[0]
    tick = mt5.symbol_info_tick(p.symbol)
    sell = p.type == mt5.POSITION_TYPE_BUY
    req = {'action': mt5.TRADE_ACTION_DEAL, 'symbol': p.symbol, 'volume': p.volume, 'position': p.ticket,
           'type': mt5.ORDER_TYPE_SELL if sell else mt5.ORDER_TYPE_BUY, 'price': tick.bid if sell else tick.ask,
           'deviation': 50, 'magic': MAGIC, 'comment': 'SWEET tutup'}
    ok, res = send(req, [mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_RETURN])
    return {'ok': ok, 'result': res}


def modify(body):
    req = {'action': mt5.TRADE_ACTION_SLTP, 'position': int(body['ticket']), 'sl': float(body.get('sl') or 0), 'tp': float(body.get('tp') or 0)}
    pos = mt5.positions_get(ticket=int(body['ticket']))
    if pos:
        req['symbol'] = pos[0].symbol
    ok, res = send(req, [mt5.ORDER_FILLING_RETURN])
    return {'ok': ok, 'result': res}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, code, obj):
        b = json.dumps(obj, default=str).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def handle_any(self, method):
        if not KEY or self.headers.get('X-Key') != KEY:
            return self.reply(401, {'error': 'kunci bridge salah'})
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        body = {}
        if method == 'POST':
            n = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self.rfile.read(n) or b'{}') if n else {}
        try:
            with LOCK:
                if u.path == '/health':
                    ok = connect()
                    out = {'ok': True, 'connected': ok, 'error': STATE['error'], 'login': LOGIN, 'server': SERVER, 'symbol': STATE['symbol'], 'offset': STATE['offset']}
                    if ok:
                        ti = asdict(mt5.terminal_info()) or {}
                        out['terminal'] = {k: ti.get(k) for k in ('name', 'company', 'connected', 'trade_allowed', 'build', 'path')}
                    return self.reply(200, out)
                if not connect():
                    return self.reply(503, {'error': STATE['error'] or 'MT5 tidak terhubung'})
                if u.path == '/account':
                    a = asdict(mt5.account_info()) or {}
                    a.pop('password', None)
                    return self.reply(200, a)
                if u.path == '/symbol':
                    return self.reply(200, symbol_payload())
                if u.path == '/rates':
                    return self.reply(200, rates(q.get('tf', 'M15'), q.get('count', 300)))
                if u.path == '/positions':
                    return self.reply(200, positions())
                if u.path == '/orders':
                    return self.reply(200, orders())
                if u.path == '/history':
                    now = int(time.time())
                    return self.reply(200, history(int(q.get('from', now - 30 * 86400)), int(q.get('to', now))))
                if method == 'POST' and u.path == '/order':
                    return self.reply(200, place_pending(body))
                if method == 'POST' and u.path == '/cancel':
                    return self.reply(200, cancel(body['ticket']))
                if method == 'POST' and u.path == '/close':
                    return self.reply(200, close(body['ticket']))
                if method == 'POST' and u.path == '/modify':
                    return self.reply(200, modify(body))
            return self.reply(404, {'error': 'endpoint tidak ada'})
        except Exception as e:
            traceback.print_exc()
            return self.reply(400, {'error': str(e)})

    def do_GET(self):
        self.handle_any('GET')

    def do_POST(self):
        self.handle_any('POST')


if __name__ == '__main__':
    if not KEY:
        print('ERROR: MT5_BRIDGE_KEY kosong di .env', flush=True)
        sys.exit(2)
    with LOCK:
        connect()
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), H)
    log('MT5 bridge listening 127.0.0.1:%d (login %s, server %s)' % (PORT, LOGIN, SERVER))
    try:
        srv.serve_forever()
    finally:
        mt5.shutdown()
