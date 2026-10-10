<?php
/**
 * ChemiConnect API - single entry point.
 * Frontend calls  POST /api/<action>  with a JSON body (Vite proxy rewrites it to api.php?action=<action>).
 */
class Bad extends Exception {}

const LOW_STOCK = 4; // medicines with fewer than this many units are shown as warnings
const AUTO_AT  = 1;  // when a medicine's stock drops to this many units (or fewer) an automatic request goes to the nearest pharmacy
const AUTO_QTY = 10; // units asked for in an automatic request

session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/* ---------- helpers ---------- */
function out($data, int $code = 200) { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }
function fail(string $msg, int $code = 400) { out(['error' => $msg], $code); }

function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $c = require __DIR__ . '/config.php';
    try {
        $pdo = new PDO(
            sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $c['host'], $c['port'], $c['name']),
            $c['user'], $c['pass'],
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
    } catch (PDOException $e) {
        error_log('ChemiConnect DB connect: ' . $e->getMessage());
        fail('Cannot connect to the MySQL database. Check backend/config.php and import backend/schema.sql.', 500);
    }
    return $pdo;
}

function q(string $sql, array $params = []): PDOStatement { $s = db()->prepare($sql); $s->execute($params); return $s; }

function tx(callable $fn) {
    $pdo = db();
    $pdo->beginTransaction();
    try { $r = $fn($pdo); $pdo->commit(); return $r; }
    catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
}

$in = [];
function str(string $k, int $max = 255): string {
    global $in;
    $v = isset($in[$k]) && is_scalar($in[$k]) ? trim((string)$in[$k]) : '';
    return mb_substr($v, 0, $max);
}
function nat($v): int { return (is_numeric($v) && $v >= 0) ? (int)floor($v) : 0; }   // non-negative whole number, else 0
function whole(string $k): ?int {
    global $in;
    if (!isset($in[$k]) || !is_numeric($in[$k])) return null;
    $v = $in[$k] + 0;
    return floor($v) == $v ? (int)$v : null;
}
function money(string $k): ?float {
    global $in;
    if (!isset($in[$k]) || !is_numeric($in[$k]) || $in[$k] < 0) return null;
    return round((float)$in[$k], 2);
}
function roleIn(): string {
    global $in;
    $r = $in['role'] ?? '';
    if (!in_array($r, ['pharmacy', 'wholesaler'], true)) fail('Invalid role');
    return $r;
}

function fetchUser(int $id): ?array {
    $r = q('SELECT id, role, name, email, phone, address, area, city, state, pincode FROM users WHERE id = ?', [$id])->fetch();
    if (!$r) return null;
    $r['id'] = (int)$r['id'];
    return $r;
}
function me(): ?array { return empty($_SESSION['uid']) ? null : fetchUser((int)$_SESSION['uid']); }
function need(?string $role = null): array {
    $u = me();
    if (!$u) fail('Please login first', 401);
    if ($role && $u['role'] !== $role) fail('Not allowed for your account type', 403);
    return $u;
}

/* ---------- nearby ranking + automatic requests ---------- */

// Number of leading pincode digits two pharmacies share (6 = same pincode). Indian pincodes are hierarchical,
// so a longer shared prefix means the pharmacies are closer to each other.
function pinCommon(string $a, string $b): int {
    $n = 0; $l = min(strlen($a), strlen($b));
    while ($n < $l && $a[$n] === $b[$n]) $n++;
    return $n;
}
function nearKey(array $me, array $o): array {
    return [
        -pinCommon((string)$me['pincode'], (string)$o['pincode']),                              // longer shared pincode prefix first
        ($me['area'] !== '' && strcasecmp($me['area'], $o['area']) === 0) ? 0 : 1,              // same area
        ($me['city'] !== '' && strcasecmp($me['city'], $o['city']) === 0) ? 0 : 1,              // same city
        abs((int)$me['pincode'] - (int)$o['pincode']),                                          // numerically closer pincode
        (int)$o['id'],
    ];
}
function sortNearby(array $me, array $list): array {
    usort($list, function ($a, $b) use ($me) { return nearKey($me, $a) <=> nearKey($me, $b); });
    return $list;
}
function lowCross(int $old, int $new): bool { return $old > AUTO_AT && $new <= AUTO_AT; }

/**
 * Sends (or continues) an automatic request for $product on behalf of pharmacy $user.
 * Picks the nearest pharmacy that has enough spare stock and was not already asked in this chain.
 * Returns ['product' => ..., 'to' => pharmacy name] or null when nobody is left to ask.
 */
function autoRequestFor(array $user, string $product, int $qty, ?int $chain = null): ?array {
    if ($chain === null) {
        // do not stack requests: one open request per medicine is enough
        if (q("SELECT id FROM requests WHERE from_user_id = ? AND LOWER(product) = LOWER(?) AND status IN ('Pending','Approved','Dispatched') LIMIT 1",
              [$user['id'], $product])->fetch()) return null;
    }
    $tried = [];
    if ($chain) {
        foreach (q('SELECT to_user_id FROM requests WHERE chain_id = ?', [$chain])->fetchAll() as $t) $tried[(int)$t['to_user_id']] = true;
    }
    // supplier must keep more than AUTO_AT units after giving, otherwise it would immediately need its own restock
    $need = $qty + AUTO_AT + 1;
    $cand = q("SELECT u.id, u.name, u.area, u.city, u.pincode
               FROM users u JOIN stock s ON s.user_id = u.id AND LOWER(s.name) = LOWER(?)
               WHERE u.role = 'pharmacy' AND u.id <> ? AND s.qty >= ?", [$product, $user['id'], $need])->fetchAll();
    $cand = array_values(array_filter($cand, function ($c) use ($tried) { return !isset($tried[(int)$c['id']]); }));
    if (!$cand) return null;
    $to = sortNearby($user, $cand)[0];

    q('INSERT INTO requests (from_user_id, to_user_id, product, qty, auto, chain_id) VALUES (?,?,?,?,1,?)',
      [$user['id'], (int)$to['id'], $product, $qty, $chain]);
    if (!$chain) {
        $rid = (int)db()->lastInsertId();
        q('UPDATE requests SET chain_id = ? WHERE id = ?', [$rid, $rid]);
    }
    return ['product' => $product, 'to' => $to['name']];
}

// Runs the automatic request for every medicine that just hit the low level. Never breaks the main action.
function runAuto(array $user, array $products): array {
    $res = [];
    foreach ($products as $p) {
        try { if ($x = autoRequestFor($user, $p, AUTO_QTY)) $res[] = $x; }
        catch (Throwable $e) { error_log('ChemiConnect auto request: ' . $e->getMessage()); }
    }
    return $res;
}

/* ---------- request handling ---------- */
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Use POST', 405);
$raw = file_get_contents('php://input');
$in = json_decode($raw === false || $raw === '' ? '[]' : $raw, true);
if (!is_array($in)) $in = [];
$action = $_GET['action'] ?? '';

try {
    switch ($action) {

    /* ===== auth ===== */
    case 'me':
        db(); // surfaces DB connection problems early
        out(['user' => me()]);

    case 'signup': {
        $role = roleIn();
        $name = str('name', 150); $email = strtolower(str('email', 190));
        $phone = str('phone', 30);
        $address = str('address', 255); $area = str('area', 100); $city = str('city', 100);
        $state = str('state', 100); $pin = str('pincode', 10);
        $pw = (string)($in['password'] ?? '');
        if ($name === '' || $email === '' || $pw === '') fail('Please fill all required fields');
        if ($address === '' || $area === '' || $city === '' || $state === '') fail('Please enter your full address (street, area, city and state)');
        if (!preg_match('/^[0-9]{6}$/', $pin)) fail('Enter a valid 6-digit pincode');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address');
        if (strlen($pw) < 6) fail('Password must be at least 6 characters');
        if (q('SELECT id FROM users WHERE email = ? AND role = ?', [$email, $role])->fetch())
            fail('Account already exists. Please login.', 409);
        q('INSERT INTO users (role, name, email, phone, address, area, city, state, pincode, pw_hash) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [$role, $name, $email, $phone, $address, $area, $city, $state, $pin, password_hash($pw, PASSWORD_DEFAULT)]);
        $id = (int)db()->lastInsertId();
        session_regenerate_id(true);
        $_SESSION['uid'] = $id;
        out(['user' => fetchUser($id)]);
    }

    case 'login': {
        $role = roleIn();
        $email = strtolower(str('email', 190));
        $pw = (string)($in['password'] ?? '');
        $u = q('SELECT id, pw_hash FROM users WHERE email = ? AND role = ?', [$email, $role])->fetch();
        if (!$u) fail("No $role account found for this email. Please sign up first.", 404);
        if (!password_verify($pw, $u['pw_hash'])) fail('Incorrect password', 401);
        session_regenerate_id(true);
        $_SESSION['uid'] = (int)$u['id'];
        out(['user' => fetchUser((int)$u['id'])]);
    }

    case 'logout':
        $_SESSION = [];
        session_destroy();
        out(['ok' => true]);

    case 'contact': {
        $name = str('name', 150); $email = str('email', 190); $msg = str('message', 2000);
        if ($name === '' || $email === '' || $msg === '') fail('Please fill all fields');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address');
        q('INSERT INTO messages (name, email, message) VALUES (?,?,?)', [$name, $email, $msg]);
        out(['ok' => true]);
    }

    /* ===== dashboards ===== */
    case 'dashboard': {
        $u = need();
        if ($u['role'] === 'pharmacy') {
            $low = q('SELECT name, qty FROM stock WHERE user_id = ? AND qty < ? ORDER BY qty, name', [$u['id'], LOW_STOCK])->fetchAll();
            foreach ($low as &$l) $l['qty'] = (int)$l['qty'];
            unset($l);
            // requests this pharmacy sent to OTHER pharmacies
            $sent = q("SELECT COUNT(*) AS total, COALESCE(SUM(r.status = 'Pending'), 0) AS pending, COALESCE(SUM(r.status IN ('Approved','Dispatched')), 0) AS approved
                       FROM requests r JOIN users t ON t.id = r.to_user_id
                       WHERE r.from_user_id = ? AND t.role = 'pharmacy'", [$u['id']])->fetch();
            // requests received FROM other pharmacies
            $recv = q("SELECT COUNT(*) AS total, COALESCE(SUM(r.status = 'Pending'), 0) AS pending, COALESCE(SUM(r.status IN ('Approved','Dispatched')), 0) AS approved
                       FROM requests r JOIN users f ON f.id = r.from_user_id
                       WHERE r.to_user_id = ? AND f.role = 'pharmacy'", [$u['id']])->fetch();
            out([
                'low' => $low,
                'sent' => (int)$sent['total'], 'sent_pending' => (int)$sent['pending'], 'sent_approved' => (int)$sent['approved'],
                'received' => (int)$recv['total'], 'received_pending' => (int)$recv['pending'], 'received_approved' => (int)$recv['approved'],
            ]);
        }
        $cat = q('SELECT COUNT(*) FROM products WHERE user_id = ?', [$u['id']])->fetchColumn();
        $pend = q("SELECT COUNT(*) FROM requests WHERE to_user_id = ? AND status = 'Pending'", [$u['id']])->fetchColumn()
              + q("SELECT COUNT(*) FROM indents WHERE to_user_id = ? AND status = 'Pending'", [$u['id']])->fetchColumn();
        $ph = q("SELECT COUNT(*) FROM users WHERE role = 'pharmacy'")->fetchColumn();
        out(['catalogue' => (int)$cat, 'pending' => (int)$pend, 'pharmacies' => (int)$ph]);
    }

    /* ===== pharmacy inventory ===== */
    case 'stock_list': {
        $u = need('pharmacy');
        $rows = q('SELECT id, name, qty, price FROM stock WHERE user_id = ? ORDER BY name', [$u['id']])->fetchAll();
        foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['qty'] = (int)$r['qty']; $r['price'] = (float)$r['price']; }
        out(['stock' => $rows]);
    }

    case 'stock_add': {
        $u = need('pharmacy');
        $name = str('name', 150); $qty = whole('qty'); $price = money('price');
        if ($name === '' || $qty === null || $qty < 0 || $price === null) fail('Enter a valid name, quantity and price');
        if (q('SELECT id FROM stock WHERE user_id = ? AND LOWER(name) = LOWER(?)', [$u['id'], $name])->fetch())
            fail('Product already exists in inventory', 409);
        q('INSERT INTO stock (user_id, name, qty, price) VALUES (?,?,?,?)', [$u['id'], $name, $qty, $price]);
        out(['ok' => true, 'auto' => $qty <= AUTO_AT ? runAuto($u, [$name]) : []]);
    }

    case 'stock_update': {
        $u = need('pharmacy');
        $id = whole('id'); $qty = whole('qty');
        if (!$id || $qty === null || $qty < 0) fail('Enter a valid quantity');
        $old = q('SELECT name, qty FROM stock WHERE id = ? AND user_id = ?', [$id, $u['id']])->fetch();
        if (!$old) fail('Product not found in your inventory', 404);
        q('UPDATE stock SET qty = ? WHERE id = ? AND user_id = ?', [$qty, $id, $u['id']]);
        out(['ok' => true, 'auto' => lowCross((int)$old['qty'], $qty) ? runAuto($u, [$old['name']]) : []]);
    }

    case 'stock_delete': {
        $u = need('pharmacy');
        q('DELETE FROM stock WHERE id = ? AND user_id = ?', [whole('id') ?? 0, $u['id']]);
        out(['ok' => true]);
    }

    /* ===== billing ===== */
    case 'bill_create': {
        $u = need('pharmacy');
        $items = $in['items'] ?? [];
        if (!is_array($items) || !$items) fail('Add at least one product to the bill');
        $customer = str('customer', 150) ?: 'Walk-in Customer';
        $res = tx(function ($pdo) use ($u, $items, $customer) {
            $total = 0.0; $lines = []; $crossed = [];
            foreach ($items as $it) {
                $id = (int)($it['id'] ?? 0); $qty = (int)($it['qty'] ?? 0);
                if ($id < 1 || $qty < 1) throw new Bad('Invalid bill item');
                $s = $pdo->prepare('SELECT id, name, qty, price FROM stock WHERE id = ? AND user_id = ? FOR UPDATE');
                $s->execute([$id, $u['id']]);
                $r = $s->fetch();
                if (!$r) throw new Bad('Product not found in your inventory');
                if ((int)$r['qty'] < $qty) throw new Bad('Insufficient stock for ' . $r['name']);
                $pdo->prepare('UPDATE stock SET qty = qty - ? WHERE id = ?')->execute([$qty, $id]);
                if (lowCross((int)$r['qty'], (int)$r['qty'] - $qty)) $crossed[] = $r['name'];
                $total += $qty * (float)$r['price'];
                $lines[] = [$r['name'], $qty, $r['price']];
            }
            $n = (int)$pdo->query('SELECT COUNT(*) FROM bills WHERE user_id = ' . (int)$u['id'])->fetchColumn() + 1;
            $no = 'INV-' . str_pad((string)$n, 4, '0', STR_PAD_LEFT);
            $pdo->prepare('INSERT INTO bills (user_id, bill_no, customer, total) VALUES (?,?,?,?)')
                ->execute([$u['id'], $no, $customer, $total]);
            $bid = (int)$pdo->lastInsertId();
            $ins = $pdo->prepare('INSERT INTO bill_items (bill_id, name, qty, price) VALUES (?,?,?,?)');
            foreach ($lines as $l) $ins->execute([$bid, $l[0], $l[1], $l[2]]);
            return ['bill_no' => $no, 'total' => $total, 'crossed' => $crossed];
        });
        $auto = runAuto($u, $res['crossed']);   // after commit, so a failed auto request never undoes the bill
        out(['bill_no' => $res['bill_no'], 'total' => $res['total'], 'auto' => $auto]);
    }

    /* ===== network (stock sharing) ===== */
    case 'network': {
        $u = need('pharmacy');
        $product = str('product', 150);
        $ph = q("SELECT u.id, u.name, u.area, u.city, u.pincode, COALESCE(s.qty, 0) AS avail
                 FROM users u LEFT JOIN stock s ON s.user_id = u.id AND LOWER(s.name) = LOWER(?)
                 WHERE u.role = 'pharmacy' AND u.id <> ? ORDER BY u.name", [$product, $u['id']])->fetchAll();
        foreach ($ph as &$p) { $p['id'] = (int)$p['id']; $p['avail'] = (int)$p['avail']; }
        unset($p);
        $ph = sortNearby($u, $ph);   // nearest pharmacy first
        $ws = q("SELECT u.id, u.name, u.area, u.city, u.pincode, p.price AS price
                 FROM users u LEFT JOIN products p ON p.user_id = u.id AND LOWER(p.name) = LOWER(?)
                 WHERE u.role = 'wholesaler' ORDER BY u.name", [$product])->fetchAll();
        foreach ($ws as &$w) { $w['id'] = (int)$w['id']; $w['listed'] = $w['price'] !== null; $w['price'] = $w['price'] !== null ? (float)$w['price'] : null; }
        out(['pharmacies' => $ph, 'wholesalers' => $ws]);
    }

    case 'request_create': {
        $u = need('pharmacy');
        $to = whole('to_id'); $product = str('product', 150); $qty = whole('qty');
        if (!$to || $product === '' || !$qty || $qty < 1) fail('Enter a medicine name and quantity');
        if ($to === $u['id']) fail('You cannot send a request to yourself');
        if (!q('SELECT id FROM users WHERE id = ?', [$to])->fetch()) fail('Recipient not found', 404);
        q('INSERT INTO requests (from_user_id, to_user_id, product, qty) VALUES (?,?,?,?)', [$u['id'], $to, $product, $qty]);
        out(['ok' => true]);
    }

    case 'requests_list': {
        $u = need();
        $sent = str('box', 10) === 'sent';
        $mine = $sent ? 'r.from_user_id' : 'r.to_user_id';
        $other = $sent ? 'r.to_user_id' : 'r.from_user_id';
        $rows = q("SELECT r.id, r.product, r.qty, r.status, r.created_at, r.auto, o.name AS other_name, o.area AS other_area, o.city AS other_city, o.role AS other_role,
                          o.address AS other_address, o.state AS other_state, o.pincode AS other_pincode, o.phone AS other_phone
                   FROM requests r JOIN users o ON o.id = $other
                   WHERE $mine = ? ORDER BY r.id DESC", [$u['id']])->fetchAll();
        foreach ($rows as &$r) {
            $r['id'] = (int)$r['id']; $r['qty'] = (int)$r['qty']; $r['auto'] = (int)$r['auto'] === 1;
            // street address + phone are only shared once the supplier has accepted (so the units can be collected)
            if (!in_array($r['status'], ['Approved', 'Received'], true)) { unset($r['other_address'], $r['other_phone']); }
        }
        unset($r);
        out(['requests' => $rows]);
    }

    // Flow:  Pending --(supplier)--> Approved | Rejected --(supplier)--> Dispatched --(requester)--> Received
    // Stock only moves when the REQUESTER marks the request Received: supplier -qty, requester +qty.
    // A rejected automatic request is passed on to the next nearest pharmacy.
    case 'request_update': {
        $u = need();
        $id = whole('id'); $status = str('status', 20);
        if (!$id || !in_array($status, ['Approved', 'Rejected', 'Dispatched', 'Received'], true)) fail('Invalid request');

        if ($status === 'Received') {
            $res = tx(function ($pdo) use ($u, $id) {
                $s = $pdo->prepare('SELECT * FROM requests WHERE id = ? AND from_user_id = ? FOR UPDATE');
                $s->execute([$id, $u['id']]);
                $r = $s->fetch();
                if (!$r) throw new Bad('Request not found', 404);
                if ($r['status'] === 'Received') throw new Bad('Already marked as received', 409);
                if ($r['status'] !== 'Dispatched') throw new Bad('The supplier has not dispatched the units yet', 409);

                $qty = (int)$r['qty']; $name = $r['product']; $price = 0.0; $crossed = null;
                $s = $pdo->prepare('SELECT role FROM users WHERE id = ?');
                $s->execute([$r['to_user_id']]);
                $role = $s->fetchColumn();

                if ($role === 'pharmacy') {
                    $s = $pdo->prepare('SELECT id, name, qty, price FROM stock WHERE user_id = ? AND LOWER(name) = LOWER(?) FOR UPDATE');
                    $s->execute([$r['to_user_id'], $r['product']]);
                    $sup = $s->fetch();
                    if (!$sup || (int)$sup['qty'] < $qty) {
                        // supplier sold the units in the meantime: close this request, caller moves on to the next pharmacy
                        $pdo->prepare("UPDATE requests SET status = 'Rejected' WHERE id = ?")->execute([$id]);
                        return ['failed' => true, 'req' => $r];
                    }
                    $pdo->prepare('UPDATE stock SET qty = qty - ? WHERE id = ?')->execute([$qty, $sup['id']]);   // supplier decreases
                    $name = $sup['name']; $price = (float)$sup['price'];
                    if (lowCross((int)$sup['qty'], (int)$sup['qty'] - $qty)) $crossed = $sup['name'];
                } else {
                    $s = $pdo->prepare('SELECT name, price FROM products WHERE user_id = ? AND LOWER(name) = LOWER(?)');
                    $s->execute([$r['to_user_id'], $r['product']]);
                    if ($p = $s->fetch()) { $name = $p['name']; $price = (float)$p['price']; }
                }

                // requester increases
                $s = $pdo->prepare('SELECT id FROM stock WHERE user_id = ? AND LOWER(name) = LOWER(?) FOR UPDATE');
                $s->execute([$u['id'], $name]);
                if ($ex = $s->fetch()) {
                    $pdo->prepare('UPDATE stock SET qty = qty + ? WHERE id = ?')->execute([$qty, $ex['id']]);
                } else {
                    $pdo->prepare('INSERT INTO stock (user_id, name, qty, price) VALUES (?,?,?,?)')->execute([$u['id'], $name, $qty, $price]);
                }
                $pdo->prepare("UPDATE requests SET status = 'Received' WHERE id = ?")->execute([$id]);
                return ['ok' => true, 'supplier' => (int)$r['to_user_id'], 'crossed' => $crossed];
            });

            if (!empty($res['failed'])) {
                $msg = 'The supplier no longer has enough stock, so this request was cancelled.';
                $r = $res['req'];
                if ((int)$r['auto'] === 1 && $r['chain_id']) {
                    $x = autoRequestFor($u, $r['product'], (int)$r['qty'], (int)$r['chain_id']);
                    if ($x) $msg .= ' A new request was sent to ' . $x['to'] . '.';
                }
                fail($msg, 409);
            }
            // the supplier's own stock may now be at the low level -> it requests from ITS nearest pharmacy
            if ($res['crossed'] && ($sup = fetchUser($res['supplier']))) runAuto($sup, [$res['crossed']]);
            out(['ok' => true, 'auto' => []]);
        }

        // Dispatched: the supplier hands the units over (no stock change yet)
        if ($status === 'Dispatched') {
            tx(function ($pdo) use ($u, $id) {
                $s = $pdo->prepare('SELECT * FROM requests WHERE id = ? AND to_user_id = ? FOR UPDATE');
                $s->execute([$id, $u['id']]);
                $r = $s->fetch();
                if (!$r) throw new Bad('Request not found', 404);
                if ($r['status'] === 'Pending') throw new Bad('Approve the request first', 409);
                if ($r['status'] !== 'Approved') throw new Bad('This request is already dispatched or closed', 409);
                if ($u['role'] === 'pharmacy') {
                    $s = $pdo->prepare('SELECT qty FROM stock WHERE user_id = ? AND LOWER(name) = LOWER(?)');
                    $s->execute([$u['id'], $r['product']]);
                    $have = (int)$s->fetchColumn();
                    if ($have < (int)$r['qty'])
                        throw new Bad('Not enough stock to dispatch. You have ' . $have . ' unit(s) of ' . $r['product'], 409);
                }
                $pdo->prepare("UPDATE requests SET status = 'Dispatched' WHERE id = ?")->execute([$id]);
            });
            out(['ok' => true, 'auto' => []]);
        }

        // Approve / Reject (recipient only)
        $r = tx(function ($pdo) use ($u, $id, $status) {
            $s = $pdo->prepare('SELECT * FROM requests WHERE id = ? AND to_user_id = ? FOR UPDATE');
            $s->execute([$id, $u['id']]);
            $r = $s->fetch();
            if (!$r) throw new Bad('Request not found', 404);
            if ($r['status'] !== 'Pending') throw new Bad('This request is already processed', 409);

            if ($status === 'Approved' && $u['role'] === 'pharmacy') {
                $s = $pdo->prepare('SELECT qty FROM stock WHERE user_id = ? AND LOWER(name) = LOWER(?)');
                $s->execute([$u['id'], $r['product']]);
                $have = (int)$s->fetchColumn();
                if ($have < (int)$r['qty'])
                    throw new Bad('Not enough stock to approve. You have ' . $have . ' unit(s) of ' . $r['product'], 409);
            }
            $pdo->prepare('UPDATE requests SET status = ? WHERE id = ?')->execute([$status, $id]);
            return $r;
        });

        $auto = [];
        if ($status === 'Rejected' && (int)$r['auto'] === 1 && $r['chain_id']) {
            $req = fetchUser((int)$r['from_user_id']);
            if ($req && ($x = autoRequestFor($req, $r['product'], (int)$r['qty'], (int)$r['chain_id']))) $auto[] = $x;
        }
        out(['ok' => true, 'auto' => $auto]);
    }

    /* ===== indents (PHC style requisition: pharmacy -> wholesaler) ===== */
    case 'wholesalers_list': {
        $u = need('pharmacy');
        $rows = q("SELECT id, name, area, city, pincode FROM users WHERE role = 'wholesaler'")->fetchAll();
        foreach ($rows as &$r) $r['id'] = (int)$r['id'];
        unset($r);
        out(['wholesalers' => sortNearby($u, $rows)]);
    }

    case 'indent_create': {
        $u = need('pharmacy');
        $to = whole('to_id');
        if (!$to || !q("SELECT id FROM users WHERE id = ? AND role = 'wholesaler'", [$to])->fetch()) fail('Select the wholesaler to send this indent to');
        $inst = str('institution', 150);
        if ($inst === '') fail('Enter the name of the institution');
        $date = str('indent_date', 10);
        $d = DateTime::createFromFormat('Y-m-d', $date);
        if (!$d || $d->format('Y-m-d') !== $date) fail('Enter a valid indent date');
        $items = $in['items'] ?? [];
        if (!is_array($items) || count($items) > 100) fail('An indent can have 1 to 100 items');
        $clean = [];
        foreach ($items as $it) {
            if (!is_array($it)) continue;
            $name = mb_substr(trim((string)($it['name'] ?? '')), 0, 150);
            if ($name === '') continue;
            $qty = nat($it['qty'] ?? 0);
            if ($qty < 1) fail('Enter the quantity required for ' . $name);
            $clean[] = [
                mb_substr(trim((string)($it['code'] ?? '')), 0, 40), $name,
                mb_substr(trim((string)($it['unit'] ?? '')), 0, 60),
                nat($it['stock'] ?? 0), nat($it['avg'] ?? 0), $qty,
                mb_substr(trim((string)($it['remarks'] ?? '')), 0, 255),
            ];
        }
        if (!$clean) fail('Add at least one medicine with the quantity required');
        $res = tx(function ($pdo) use ($u, $to, $inst, $date, $clean) {
            $n = (int)$pdo->query('SELECT COUNT(*) FROM indents WHERE from_user_id = ' . (int)$u['id'])->fetchColumn() + 1;
            $no = 'IND-' . str_pad((string)$n, 4, '0', STR_PAD_LEFT);
            $pdo->prepare('INSERT INTO indents (indent_no, from_user_id, to_user_id, institution, district, block, address, indent_date, period, officer, remarks)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?)')
                ->execute([$no, $u['id'], $to, $inst, str('district', 100), str('block', 100), str('address', 255), $date,
                           str('period', 20), str('officer', 150), str('remarks', 500)]);
            $iid = (int)$pdo->lastInsertId();
            $ins = $pdo->prepare('INSERT INTO indent_items (indent_id, sno, drug_code, name, unit, stock_in_hand, avg_monthly, qty_required, remarks) VALUES (?,?,?,?,?,?,?,?,?)');
            foreach ($clean as $k => $c) $ins->execute([$iid, $k + 1, $c[0], $c[1], $c[2], $c[3], $c[4], $c[5], $c[6]]);
            return ['indent_no' => $no];
        });
        out(['ok' => true, 'indent_no' => $res['indent_no']]);
    }

    // pharmacy: indents it sent.  wholesaler: indents it received.
    case 'indents_list': {
        $u = need();
        $mine  = $u['role'] === 'pharmacy' ? 'i.from_user_id' : 'i.to_user_id';
        $other = $u['role'] === 'pharmacy' ? 'i.to_user_id' : 'i.from_user_id';
        $rows = q("SELECT i.*, o.name AS other_name, o.phone AS other_phone, o.city AS other_city
                   FROM indents i JOIN users o ON o.id = $other
                   WHERE $mine = ? ORDER BY i.id DESC", [$u['id']])->fetchAll();
        $ids = array_map(function ($r) { return (int)$r['id']; }, $rows);
        $by = [];
        if ($ids) {
            $it = q('SELECT * FROM indent_items WHERE indent_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ') ORDER BY indent_id, sno', $ids)->fetchAll();
            foreach ($it as $x) {
                foreach (['id', 'indent_id', 'sno', 'stock_in_hand', 'avg_monthly', 'qty_required'] as $k) $x[$k] = (int)$x[$k];
                $x['qty_issued'] = $x['qty_issued'] === null ? null : (int)$x['qty_issued'];
                $by[$x['indent_id']][] = $x;
            }
        }
        foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['items'] = $by[$r['id']] ?? []; }
        unset($r);
        out(['indents' => $rows]);
    }

    // wholesaler approves (with the quantity it will issue per item) or rejects
    case 'indent_update': {
        $u = need('wholesaler');
        $id = whole('id'); $status = str('status', 20);
        if (!$id || !in_array($status, ['Approved', 'Rejected'], true)) fail('Invalid request');
        $issued = isset($in['issued']) && is_array($in['issued']) ? $in['issued'] : [];
        tx(function ($pdo) use ($u, $id, $status, $issued) {
            $s = $pdo->prepare('SELECT status FROM indents WHERE id = ? AND to_user_id = ? FOR UPDATE');
            $s->execute([$id, $u['id']]);
            $st = $s->fetchColumn();
            if ($st === false) throw new Bad('Indent not found', 404);
            if ($st !== 'Pending') throw new Bad('This indent is already processed', 409);
            if ($status === 'Approved') {
                $s = $pdo->prepare('SELECT id, qty_required FROM indent_items WHERE indent_id = ?');
                $s->execute([$id]);
                $upd = $pdo->prepare('UPDATE indent_items SET qty_issued = ? WHERE id = ?');
                foreach ($s->fetchAll() as $it) {
                    $q = array_key_exists($it['id'], $issued) ? nat($issued[$it['id']]) : (int)$it['qty_required'];
                    $upd->execute([min($q, (int)$it['qty_required']), $it['id']]);
                }
            }
            $pdo->prepare('UPDATE indents SET status = ? WHERE id = ?')->execute([$status, $id]);
        });
        out(['ok' => true]);
    }

    /* ===== wholesaler ===== */
    case 'catalogue_list': {
        $u = need('wholesaler');
        $rows = q('SELECT id, name, price FROM products WHERE user_id = ? ORDER BY name', [$u['id']])->fetchAll();
        foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['price'] = (float)$r['price']; }
        out(['products' => $rows]);
    }

    case 'catalogue_add': {
        $u = need('wholesaler');
        $name = str('name', 150); $price = money('price');
        if ($name === '' || $price === null) fail('Enter product name and wholesale price');
        if (q('SELECT id FROM products WHERE user_id = ? AND LOWER(name) = LOWER(?)', [$u['id'], $name])->fetch())
            fail('Product already in catalogue', 409);
        q('INSERT INTO products (user_id, name, price) VALUES (?,?,?)', [$u['id'], $name, $price]);
        out(['ok' => true]);
    }

    case 'catalogue_delete': {
        $u = need('wholesaler');
        q('DELETE FROM products WHERE id = ? AND user_id = ?', [whole('id') ?? 0, $u['id']]);
        out(['ok' => true]);
    }

    case 'pharmacies_list': {
        need('wholesaler');
        $rows = q("SELECT id, name, address, area, city, state, pincode, phone, created_at FROM users WHERE role = 'pharmacy' ORDER BY name")->fetchAll();
        out(['pharmacies' => $rows]);
    }

    default:
        fail('Unknown action', 404);
    }
} catch (Bad $e) {
    fail($e->getMessage(), $e->getCode() ?: 400);
} catch (PDOException $e) {
    error_log('ChemiConnect DB error: ' . $e->getMessage());
    fail('Database error. Please try again.', 500);
}
