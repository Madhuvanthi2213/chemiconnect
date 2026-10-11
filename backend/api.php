<?php
/**
 * ChemiConnect API - single entry point.
 * Frontend calls  POST /api/<action>  with a JSON body (Vite proxy rewrites it to api.php?action=<action>).
 */
class Bad extends Exception {}

const LOW_STOCK = 4; // medicines with fewer than this many units are shown as warnings
const AUTO_AT  = 1;  // when a medicine's stock drops to this many units (or fewer) an automatic request goes to the nearest pharmacy
const AUTO_QTY = 10; // units asked for in an automatic request
const EXPIRY_WARN_DAYS = 30; // batches expiring within this many days are shown as expiry alerts

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
        // "A day" for the daily sales summary = the local calendar day (default India, UTC+05:30; see config.php)
        $pdo->exec('SET time_zone = ' . $pdo->quote($c['tz'] ?? '+05:30'));
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


/* ---------- self-healing database upgrade ----------
 * Adds whatever an older database is missing (batch number / expiry date in stock, district for accounts, batch fields in
 * indent items), so "add product with batch + expiry" and the district-wise indent flow work even if the SQL
 * migrations were never run. Safe to run any number of times; it never deletes data. Runs once per login session.
 */
function colExists(string $t, string $c): bool {
    return (int)q('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$t, $c])->fetchColumn() > 0;
}
function idxExists(string $t, string $i): bool {
    return (int)q('SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [$t, $i])->fetchColumn() > 0;
}
function ensureSchema(): void {
    if (($_SESSION['schema_ok'] ?? 0) === 8) return;
    try {
        $pdo = db();
        // offline sync: remembers which offline entries (client_id) were already applied, so a retry never double-counts
        $pdo->exec('CREATE TABLE IF NOT EXISTS sync_log (
            user_id INT UNSIGNED NOT NULL,
            client_id VARCHAR(64) NOT NULL,
            result TEXT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, client_id)
        ) ENGINE=InnoDB');
        // medicine tracking (QR scan): one row per medicine batch + the events of its journey, manufacturing -> expiry
        $pdo->exec('CREATE TABLE IF NOT EXISTS trace_batches (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            token VARCHAR(20) NOT NULL,
            name VARCHAR(150) NOT NULL,
            batch_no VARCHAR(50) NOT NULL DEFAULT \'\',
            expiry_date DATE NULL,
            mfg_date DATE NULL,
            manufacturer VARCHAR(150) NOT NULL DEFAULT \'\',
            mfg_qty INT UNSIGNED NOT NULL DEFAULT 0,
            created_by INT UNSIGNED NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_trace_token (token),
            KEY idx_trace_batch (batch_no),
            KEY idx_trace_name (name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        $pdo->exec('CREATE TABLE IF NOT EXISTS trace_events (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            trace_id INT UNSIGNED NOT NULL,
            kind VARCHAR(20) NOT NULL,
            from_user_id INT UNSIGNED NULL,
            to_user_id INT UNSIGNED NULL,
            qty INT UNSIGNED NOT NULL DEFAULT 0,
            note VARCHAR(255) NOT NULL DEFAULT \'\',
            happened_at DATETIME NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_trace_time (trace_id, happened_at),
            FOREIGN KEY (trace_id) REFERENCES trace_batches(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        if (!colExists('stock', 'batch_no'))    $pdo->exec("ALTER TABLE stock ADD COLUMN batch_no VARCHAR(50) NOT NULL DEFAULT '' AFTER name");
        if (!colExists('stock', 'expiry_date')) $pdo->exec('ALTER TABLE stock ADD COLUMN expiry_date DATE NULL AFTER batch_no');
        if (!idxExists('stock', 'uq_user_batch')) $pdo->exec('ALTER TABLE stock ADD UNIQUE KEY uq_user_batch (user_id, name, batch_no, expiry_date)');
        if (idxExists('stock', 'uq_user_med'))    $pdo->exec('ALTER TABLE stock DROP INDEX uq_user_med');
        if (!colExists('indent_items', 'batch_no'))    $pdo->exec("ALTER TABLE indent_items ADD COLUMN batch_no VARCHAR(50) NOT NULL DEFAULT '' AFTER qty_issued");
        if (!colExists('indent_items', 'expiry_date')) $pdo->exec('ALTER TABLE indent_items ADD COLUMN expiry_date DATE NULL AFTER batch_no');
        if (!colExists('users', 'district')) {
            $pdo->exec("ALTER TABLE users ADD COLUMN district VARCHAR(100) NOT NULL DEFAULT '' AFTER pincode");
            $pdo->exec("UPDATE users SET district = city WHERE district = ''");   // old accounts: best guess = their city
        }
        if (!idxExists('users', 'idx_role_district')) $pdo->exec('ALTER TABLE users ADD INDEX idx_role_district (role, district)');
        if (!colExists('requests', 'auto'))     $pdo->exec('ALTER TABLE requests ADD COLUMN auto TINYINT(1) NOT NULL DEFAULT 0 AFTER status');
        if (!colExists('requests', 'chain_id')) $pdo->exec('ALTER TABLE requests ADD COLUMN chain_id INT UNSIGNED NULL AFTER auto');
        if (!idxExists('requests', 'idx_chain')) $pdo->exec('ALTER TABLE requests ADD KEY idx_chain (chain_id)');
        $pdo->exec("ALTER TABLE requests MODIFY status ENUM('Pending','Approved','Dispatched','Received','Rejected') NOT NULL DEFAULT 'Pending'");
        if (!colExists('users', 'stock_seeded')) {
            $pdo->exec('ALTER TABLE users ADD COLUMN stock_seeded TINYINT(1) NOT NULL DEFAULT 0');
            // pharmacies that already have their own stock are left alone
            $pdo->exec("UPDATE users SET stock_seeded = 1 WHERE role = 'pharmacy' AND id IN (SELECT DISTINCT user_id FROM stock)");
        }
        if (!colExists('users', 'stock_seed_v')) $pdo->exec('ALTER TABLE users ADD COLUMN stock_seed_v TINYINT UNSIGNED NOT NULL DEFAULT 0');
        // free essential medicines always cost 0
        foreach ($pdo->query('SELECT DISTINCT name FROM stock WHERE price <> 0')->fetchAll(PDO::FETCH_COLUMN) as $n)
            if (isFreeMed((string)$n)) $pdo->prepare('UPDATE stock SET price = 0 WHERE name = ?')->execute([$n]);
        // starter inventory (dummy medicines with batch no. + expiry date) for pharmacies that have none yet
        foreach ($pdo->query("SELECT id FROM users WHERE role = 'pharmacy' AND stock_seed_v < " . SEED_VER)->fetchAll(PDO::FETCH_COLUMN) as $uid) seedStock($pdo, (int)$uid);
        $_SESSION['schema_ok'] = 8;
    } catch (Throwable $e) {
        error_log('ChemiConnect ensureSchema: ' . $e->getMessage());
    }
}


/* ---------- free essential medicines ----------
 * PHCs hand out the most essential medicines FREE of cost; every other medicine is paid.
 * isFreeMed() decides by medicine name (word match), so "Paracetamol 500mg Tablet" or "ORS Sachet" are free.
 * The server forces the price of a free medicine to 0 everywhere (inventory, billing, indents).
 */
const FREE_MED_RE = '/\b(paracetamol|cetirizine|omeprazole|antacid|amoxicillin|ors|zinc|metformin|amlodipine|salbutamol|folic|povidone|clotrimazole|albendazole)\b|\bvitamin[\s\-]*a\b/i';
function isFreeMed(string $name): bool {
    return (bool)preg_match(FREE_MED_RE, $name);
}

/* Dummy starter inventory (every row has a batch number and an expiry date). [name, batch prefix, qty, price, months to expiry]
 * Free essentials have price 0 (forced by isFreeMed); the rest are normal paid medicines.
 * A medicine listed more than once = several batches. Months 0 = expires at the end of this month (shows in Expiry Alerts);
 * the last few rows have fewer than 4 units (show in Low-stock warnings). Bump SEED_VER after changing this list
 * and every PHC pharma gets the medicines it does not have yet. */
const SEED_VER = 2;
const SEED_MEDS = [
    ['Paracetamol 500mg Tablet', 'PCM', 400, 0, 22], ['Paracetamol 650mg Tablet', 'PCM', 260, 0, 20], ['Paracetamol 125mg/5ml Syrup 60ml', 'PCS', 120, 0, 16],
    ['Cetirizine 10mg Tablet', 'CTZ', 250, 0, 20], ['Omeprazole 20mg Capsule', 'OMP', 200, 0, 18], ['Antacid Suspension 170ml', 'ANT', 90, 0, 15],
    ['Antacid Chewable Tablet', 'ACT', 240, 0, 17], ['Amoxicillin 500mg Capsule', 'AMX', 180, 0, 14], ['Amoxicillin 250mg Dispersible Tablet', 'AMD', 140, 0, 13],
    ['ORS Sachet 21g', 'ORS', 300, 0, 24], ['Zinc 20mg Dispersible Tablet', 'ZNC', 220, 0, 21], ['Metformin 500mg Tablet', 'MET', 350, 0, 19],
    ['Metformin 850mg Tablet', 'MEF', 180, 0, 18], ['Amlodipine 5mg Tablet', 'AML', 300, 0, 23], ['Amlodipine 10mg Tablet', 'AMT', 150, 0, 22],
    ['Salbutamol Inhaler 100mcg', 'SAL', 60, 0, 16], ['Salbutamol 2mg Tablet', 'SLT', 110, 0, 19], ['Iron Folic Acid Tablet', 'IFA', 500, 0, 25],
    ['Folic Acid 5mg Tablet', 'FOL', 260, 0, 24], ['Vitamin A 2000 IU Capsule', 'VTA', 150, 0, 17], ['Povidone Iodine 5% Solution 100ml', 'PVI', 70, 0, 26],
    ['Povidone Iodine 10% Ointment 15g', 'PVO', 55, 0, 22], ['Clotrimazole 1% Cream 15g', 'CLO', 80, 0, 18], ['Albendazole 400mg Tablet', 'ALB', 200, 0, 20],
    ['Albendazole 200mg/5ml Suspension 10ml', 'ALS', 70, 0, 15], ['Ibuprofen 400mg Tablet', 'IBU', 150, 2.5, 20], ['Ibuprofen 100mg/5ml Suspension 60ml', 'IBS', 60, 38, 15],
    ['Diclofenac 50mg Tablet', 'DIC', 140, 3, 19], ['Diclofenac Gel 30g', 'DGL', 60, 85, 17], ['Aceclofenac 100mg Tablet', 'ACL', 130, 4.5, 18],
    ['Naproxen 250mg Tablet', 'NAP', 90, 5, 19], ['Tramadol 50mg Capsule', 'TRM', 60, 6, 16], ['Mefenamic Acid 500mg Tablet', 'MFA', 110, 3.5, 20],
    ['Aspirin 75mg Tablet', 'ASP', 160, 2, 25], ['Aspirin 325mg Tablet', 'AS3', 100, 2, 24], ['Diclofenac Spray 55g', 'DSP', 35, 120, 14],
    ['Methyl Salicylate Ointment 30g', 'MSO', 45, 60, 18], ['Azithromycin 500mg Tablet', 'AZI', 90, 18, 15], ['Azithromycin 250mg Tablet', 'AZT', 80, 12, 16],
    ['Ciprofloxacin 500mg Tablet', 'CIP', 100, 9, 16], ['Cefixime 200mg Tablet', 'CEF', 80, 14, 14], ['Cefpodoxime 200mg Tablet', 'CPX', 70, 22, 15],
    ['Cephalexin 500mg Capsule', 'CPL', 90, 10, 17], ['Doxycycline 100mg Capsule', 'DOX', 90, 7, 18], ['Metronidazole 400mg Tablet', 'MTZ', 160, 2.5, 21],
    ['Ofloxacin 200mg Tablet', 'OFX', 100, 6, 17], ['Norfloxacin 400mg Tablet', 'NRX', 90, 5.5, 18], ['Cotrimoxazole 480mg Tablet', 'COT', 140, 3, 22],
    ['Erythromycin 250mg Tablet', 'ERY', 70, 8, 16], ['Nitrofurantoin 100mg Capsule', 'NIT', 60, 9, 15], ['Fluconazole 150mg Tablet', 'FLU', 50, 20, 18],
    ['Acyclovir 400mg Tablet', 'ACY', 60, 12, 19], ['Ivermectin 12mg Tablet', 'IVM', 80, 8, 20], ['Mupirocin 2% Ointment 5g', 'MUP', 50, 95, 16],
    ['Framycetin Skin Cream 30g', 'FRA', 40, 70, 17], ['Terbinafine 1% Cream 10g', 'TER', 45, 85, 18], ['Silver Sulphadiazine 1% Cream 25g', 'SSD', 40, 75, 15],
    ['Gentamicin Eye/Ear Drops 10ml', 'GEN', 50, 30, 14], ['Ciprofloxacin Eye Drops 5ml', 'CEY', 55, 32, 13], ['Pantoprazole 40mg Tablet', 'PAN', 160, 6, 21],
    ['Ranitidine 150mg Tablet', 'RAN', 120, 2.5, 17], ['Rabeprazole 20mg Tablet', 'RAB', 110, 7, 20], ['Domperidone 10mg Tablet', 'DOM', 150, 3, 19],
    ['Ondansetron 4mg Tablet', 'OND', 90, 5, 15], ['Loperamide 2mg Capsule', 'LOP', 80, 3.5, 16], ['Dicyclomine 10mg Tablet', 'DCY', 120, 3, 18],
    ['Lactulose Syrup 100ml', 'LAC', 50, 110, 16], ['Bisacodyl 5mg Tablet', 'BIS', 100, 2.5, 22], ['Simethicone 40mg Tablet', 'SIM', 100, 2, 20],
    ['Racecadotril 100mg Capsule', 'RCD', 50, 25, 15], ['Probiotic Sachet', 'PRB', 90, 12, 12], ['Levocetirizine 5mg Tablet', 'LEV', 130, 4, 22],
    ['Montelukast 10mg Tablet', 'MON', 100, 12, 17], ['Chlorpheniramine 4mg Tablet', 'CPM', 200, 1, 24], ['Fexofenadine 120mg Tablet', 'FEX', 90, 9, 19],
    ['Cough Syrup 100ml', 'CSY', 70, 55, 14], ['Ambroxol Syrup 100ml', 'AMB', 60, 48, 16], ['Dextromethorphan Cough Syrup 100ml', 'DXM', 55, 52, 15],
    ['Budesonide Inhaler 200mcg', 'BUD', 30, 260, 18], ['Ipratropium Inhaler 20mcg', 'IPR', 30, 230, 17], ['Theophylline 200mg Tablet', 'THE', 70, 5, 20],
    ['Xylometazoline Nasal Drops 10ml', 'XYL', 50, 42, 15], ['Saline Nasal Drops 10ml', 'SNS', 60, 35, 20], ['Prednisolone 5mg Tablet', 'PRD', 150, 2, 21],
    ['Prednisolone 20mg Tablet', 'PR2', 70, 5, 20], ['Dexamethasone 0.5mg Tablet', 'DEX', 90, 1.5, 23], ['Atorvastatin 10mg Tablet', 'ATO', 140, 8, 24],
    ['Atorvastatin 20mg Tablet', 'AT2', 110, 12, 23], ['Losartan 50mg Tablet', 'LOS', 130, 6.5, 23], ['Atenolol 50mg Tablet', 'ATE', 120, 4.5, 22],
    ['Telmisartan 40mg Tablet', 'TEL', 120, 8, 21], ['Enalapril 5mg Tablet', 'ENA', 100, 3, 22], ['Metoprolol 50mg Tablet', 'MTP', 110, 5, 21],
    ['Hydrochlorothiazide 12.5mg Tablet', 'HCT', 100, 2.5, 24], ['Furosemide 40mg Tablet', 'FUR', 100, 2, 23], ['Clopidogrel 75mg Tablet', 'CLP', 90, 9, 22],
    ['Isosorbide Mononitrate 20mg Tablet', 'ISM', 80, 6, 20], ['Sorbitrate 5mg Tablet', 'SOR', 80, 3, 19], ['Glimepiride 2mg Tablet', 'GLM', 110, 7.5, 20],
    ['Glibenclamide 5mg Tablet', 'GLB', 130, 2, 21], ['Gliclazide 80mg Tablet', 'GLC', 100, 5, 20], ['Insulin Regular 40IU Vial 10ml', 'INS', 25, 160, 9],
    ['Rosuvastatin 10mg Tablet', 'ROS', 90, 14, 22], ['Phenytoin 100mg Tablet', 'PHT', 80, 3, 20], ['Carbamazepine 200mg Tablet', 'CBZ', 70, 4, 19],
    ['Amitriptyline 25mg Tablet', 'AMI', 80, 2.5, 21], ['Gabapentin 300mg Capsule', 'GAB', 70, 10, 18], ['Diazepam 5mg Tablet', 'DZP', 40, 3, 16],
    ['Betahistine 16mg Tablet', 'BET', 60, 9, 17], ['Promethazine 25mg Tablet', 'PMZ', 80, 3, 19], ['Cinnarizine 25mg Tablet', 'CNZ', 90, 3.5, 18],
    ['Vitamin B Complex Tablet', 'VBC', 200, 2, 18], ['Vitamin C 500mg Chewable Tablet', 'VTC', 180, 2.5, 19], ['Calcium D3 Tablet', 'CAL', 150, 5, 21],
    ['Vitamin D3 60000 IU Sachet', 'VD3', 100, 18, 18], ['Multivitamin Tablet', 'MVT', 160, 3, 20], ['Vitamin B12 Methylcobalamin 1500mcg Tablet', 'B12', 100, 6, 19],
    ['Hydrocortisone 1% Cream 15g', 'HYD', 60, 45, 18], ['Betamethasone 0.05% Cream 15g', 'BTM', 50, 55, 17], ['Calamine Lotion 100ml', 'CLM', 60, 40, 20],
    ['Permethrin 5% Lotion 30ml', 'PER', 40, 90, 17], ['Benzyl Benzoate Lotion 100ml', 'BBL', 45, 50, 16], ['Gentian Violet Paint 15ml', 'GVP', 50, 20, 22],
    ['Chlorhexidine 0.2% Mouthwash 100ml', 'CHX', 50, 45, 18], ['Hydrogen Peroxide 6% Solution 100ml', 'HPX', 50, 25, 20], ['Surgical Spirit 100ml', 'SSP', 60, 30, 24],
    ['Cotton Roll 100g', 'CTR', 80, 40, 36], ['Crepe Bandage 6cm', 'CRB', 70, 35, 36], ['Adhesive Plaster 2.5cm', 'ADP', 90, 28, 30],
    ['Disposable Gloves (Box of 100)', 'GLV', 30, 260, 30], ['Disposable Syringe 5ml (Box of 100)', 'SYR', 25, 350, 30], ['Normal Saline 0.9% IV 500ml', 'NSL', 60, 38, 18],
    ['Ringer Lactate IV 500ml', 'RLI', 50, 42, 18], ['Dextrose 5% IV 500ml', 'DNS', 50, 40, 18], ['Glucometer Test Strips (50)', 'GTS', 30, 450, 12],
    ['Pregnancy Test Kit', 'PTK', 60, 35, 18], ['Tetanus Toxoid 0.5ml Vial', 'TTV', 40, 18, 10], ['Oxytocin 5IU Injection', 'OXY', 30, 28, 9],
    ['Paracetamol 500mg Tablet', 'PCM', 150, 0, 9], ['ORS Sachet 21g', 'ORS', 120, 0, 10], ['Metformin 500mg Tablet', 'MET', 100, 0, 8],
    ['Amoxicillin 500mg Capsule', 'AMX', 60, 0, 7], ['Pantoprazole 40mg Tablet', 'PAN', 50, 6, 8], ['Azithromycin 500mg Tablet', 'AZI', 30, 18, 6],
    ['Atorvastatin 10mg Tablet', 'ATO', 40, 8, 10], ['Cetirizine 10mg Tablet', 'CTZ', 80, 0, 9], ['Cough Syrup 100ml', 'CSY', 15, 55, 0],
    ['Vitamin B Complex Tablet', 'VBC', 40, 2, 0], ['Ciprofloxacin Eye Drops 5ml', 'CEY', 12, 32, 0], ['Diazepam 5mg Tablet', 'DZP', 3, 3, 12],
    ['Insulin Regular 40IU Vial 10ml', 'INS', 2, 160, 8], ['Oxytocin 5IU Injection', 'OXY', 3, 28, 7],
];
// Adds every starter medicine the pharmacy does not already stock (by name). Existing stock is never changed or removed.
function seedStock(PDO $pdo, int $uid): void {
    $have = [];
    $q = $pdo->prepare('SELECT DISTINCT LOWER(name) FROM stock WHERE user_id = ?');
    $q->execute([$uid]);
    foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $n) $have[(string)$n] = true;
    $ins = $pdo->prepare('INSERT IGNORE INTO stock (user_id, name, batch_no, expiry_date, qty, price) VALUES (?,?,?,?,?,?)');
    foreach (SEED_MEDS as $i => $m) {
        if (isset($have[strtolower($m[0])])) continue;
        $exp = date('Y-m-d', strtotime('last day of +' . $m[4] . ' months'));
        $batch = $m[1] . '-' . date('y') . str_pad((string)($i + 11), 3, '0', STR_PAD_LEFT);
        $ins->execute([$uid, $m[0], $batch, $exp, $m[2], isFreeMed($m[0]) ? 0 : $m[3]]);
    }
    $pdo->prepare('UPDATE users SET stock_seeded = 1, stock_seed_v = ? WHERE id = ?')->execute([SEED_VER, $uid]);
}

// Tamil Nadu districts (account district must be one of these)
const TN_DISTRICTS = ['Ariyalur','Chengalpattu','Chennai','Coimbatore','Cuddalore','Dharmapuri','Dindigul','Erode','Kallakurichi','Kanchipuram','Kanyakumari','Karur','Krishnagiri','Madurai','Mayiladuthurai','Nagapattinam','Namakkal','Nilgiris','Perambalur','Pudukkottai','Ramanathapuram','Ranipet','Salem','Sivagangai','Tenkasi','Thanjavur','Theni','Thoothukudi','Tiruchirappalli','Tirunelveli','Tirupathur','Tiruppur','Tiruvallur','Tiruvannamalai','Tiruvarur','Vellore','Villupuram','Virudhunagar'];
function districtIn(): string {
    $d = str('district', 100);
    foreach (TN_DISTRICTS as $x) if (strcasecmp($x, $d) === 0) return $x;
    fail('Select your district');
}
// the ONE District Main PHC account of a district (null if that district has no account yet)
function districtMain(string $district): ?array {
    $r = q("SELECT id, name, area, city, pincode, district FROM users WHERE role = 'wholesaler' AND LOWER(district) = LOWER(?) ORDER BY id LIMIT 1", [$district])->fetch();
    if ($r) $r['id'] = (int)$r['id'];
    return $r ?: null;
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

function haversineDistance(float $lat1, float $lon1, float $lat2, float $lon2): float {
    $earthRadius = 6371.0; // km
    $dLat = deg2rad($lat2 - $lat1);
    $dLon = deg2rad($lon2 - $lon1);
    $a = sin($dLat / 2) * sin($dLat / 2) +
         cos(deg2rad($lat1)) * cos(deg2rad($lat2)) *
         sin($dLon / 2) * sin($dLon / 2);
    $c = 2 * atan2(sqrt($a), sqrt(1 - $a));
    return $earthRadius * $c;
}

function getCityCoords(string $city, string $state, string $pincode, int $id): array {
    $c = strtolower(trim($city));
    $map = [
        'chennai' => [13.0827, 80.2707],
        'coimbatore' => [11.0168, 76.9558],
        'madurai' => [9.9252, 78.1198],
        'trichy' => [10.7905, 78.7047],
        'tiruchirappalli' => [10.7905, 78.7047],
        'salem' => [11.6643, 78.1460],
        'tirunelveli' => [8.7139, 77.7567],
        'tiruppur' => [11.1085, 77.3411],
        'vellore' => [12.9165, 79.1325],
        'erode' => [11.3410, 77.7172],
        'thoothukudi' => [8.7642, 78.1348],
        'dindigul' => [10.3673, 77.9803],
        'thanjavur' => [10.7870, 79.1378],
        'ranipet' => [12.9229, 79.3330],
        'sivakasi' => [9.4532, 77.7972],
        'karur' => [10.9601, 78.0766],
        'hosur' => [12.7409, 77.8253],
        'nagercoil' => [8.1833, 77.4119],
        'kanchipuram' => [12.8342, 79.7036],
        'cuddalore' => [11.7480, 79.7714],
    ];
    // Default Tamil Nadu coordinates: 11.1271, 78.6569
    $base = $map[$c] ?? [11.1271, 78.6569];
    // Deterministic small jitter based on id so multiple pharmacies in the same city don't completely overlap on map
    $seed = ($id * 9973) % 1000;
    $latJitter = (($seed % 40) - 20) * 0.003;
    $lngJitter = ((floor($seed / 40) % 40) - 20) * 0.003;
    return [round($base[0] + $latJitter, 7), round($base[1] + $lngJitter, 7)];
}

function fetchUser(int $id): ?array {
    $r = q('SELECT id, role, name, email, phone, address, area, city, state, pincode, district, latitude, longitude FROM users WHERE id = ?', [$id])->fetch();
    if (!$r) return null;
    $r['id'] = (int)$r['id'];
    $r['latitude'] = $r['latitude'] !== null ? (float)$r['latitude'] : null;
    $r['longitude'] = $r['longitude'] !== null ? (float)$r['longitude'] : null;
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
// true when a medicine is at (or below) the auto-request level after a stock change. autoRequestFor() never stacks requests,
// so calling it again while a request is still open is harmless.
function lowCross(int $old, int $new): bool { return $new <= AUTO_AT; }

/* ---------- batch-wise stock helpers ----------
 * The `stock` table holds one row per BATCH (medicine name + batch number + expiry date).
 * "Usable" units = units in batches that are not expired (a batch is usable through its expiry date).
 */
const SQL_USABLE = '(expiry_date IS NULL OR expiry_date >= CURDATE())';

// Valid YYYY-MM-DD date string, or null.
function dateOrNull(string $v): ?string {
    $d = DateTime::createFromFormat('Y-m-d', $v);
    return ($d && $d->format('Y-m-d') === $v) ? $v : null;
}

// Total usable (non-expired) units of one medicine for one pharmacy, across all its batches.
function usableTotal(int $uid, string $name, ?PDO $pdo = null): int {
    $s = ($pdo ?: db())->prepare('SELECT COALESCE(SUM(qty), 0) FROM stock WHERE user_id = ? AND LOWER(name) = LOWER(?) AND ' . SQL_USABLE);
    $s->execute([$uid, $name]);
    return (int)$s->fetchColumn();
}

// Adds units of one batch to a pharmacy's inventory: tops up the batch if it already exists, otherwise creates it.
// A new batch of a medicine that is already stocked keeps that medicine's name spelling and selling price.
function stockAdd(PDO $pdo, int $uid, string $name, string $batch, ?string $exp, int $qty, float $price): void {
    $s = $pdo->prepare('SELECT id FROM stock WHERE user_id = ? AND LOWER(name) = LOWER(?) AND LOWER(batch_no) = LOWER(?) AND expiry_date <=> ? FOR UPDATE');
    $s->execute([$uid, $name, $batch, $exp]);
    if ($id = $s->fetchColumn()) {
        $pdo->prepare('UPDATE stock SET qty = qty + ? WHERE id = ?')->execute([$qty, $id]);
        return;
    }
    $s = $pdo->prepare('SELECT name, price FROM stock WHERE user_id = ? AND LOWER(name) = LOWER(?) ORDER BY id LIMIT 1');
    $s->execute([$uid, $name]);
    if ($e = $s->fetch()) { $name = $e['name']; $price = (float)$e['price']; }
    if (isFreeMed($name)) $price = 0.0;
    $pdo->prepare('INSERT INTO stock (user_id, name, batch_no, expiry_date, qty, price) VALUES (?,?,?,?,?,?)')
        ->execute([$uid, $name, $batch, $exp, $qty, $price]);
}

/* ---------- medicine tracking (QR scan: manufacturing -> expiry) ----------
 * One batch = medicine name + batch number + expiry date (the same key the inventory uses), wherever it is stocked.
 * Every batch has a tracking record with a short token that is printed as a QR code; each step of its journey is an event:
 *   manufactured -> received (District Main PHC) -> issued (indent to a PHC Pharma) -> transferred (PHC Pharma to PHC Pharma)
 *   -> stocked (added to an inventory by hand / opening stock) -> dispensed (billed to a patient) ... and finally its expiry date.
 * Tracking is written next to stock changes but through traceTry(), so a tracking problem can never stop a stock change, bill or indent.
 */
function traceToken(PDO $pdo): string {
    $abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O/1/I, easy to read aloud and type
    for ($try = 0; $try < 10; $try++) {
        $t = 'CC';
        for ($i = 0; $i < 10; $i++) $t .= $abc[random_int(0, strlen($abc) - 1)];
        $s = $pdo->prepare('SELECT 1 FROM trace_batches WHERE token = ?');
        $s->execute([$t]);
        if (!$s->fetchColumn()) return $t;
    }
    throw new RuntimeException('Could not make a code for this batch');
}

// Finds the tracking record of a batch, or creates it (and its token) the first time the batch is seen.
function traceBatch(PDO $pdo, string $name, string $batch, ?string $exp, ?int $by = null): int {
    $s = $pdo->prepare('SELECT id FROM trace_batches WHERE LOWER(name) = LOWER(?) AND LOWER(batch_no) = LOWER(?) AND expiry_date <=> ? ORDER BY id LIMIT 1');
    $s->execute([$name, $batch, $exp]);
    if ($id = $s->fetchColumn()) return (int)$id;
    $pdo->prepare('INSERT INTO trace_batches (token, name, batch_no, expiry_date, created_by) VALUES (?,?,?,?,?)')
        ->execute([traceToken($pdo), $name, $batch, $exp, $by]);
    return (int)$pdo->lastInsertId();
}

function traceLog(PDO $pdo, int $tid, string $kind, ?int $from, ?int $to, int $qty, string $note = '', ?string $at = null): void {
    $pdo->prepare('INSERT INTO trace_events (trace_id, kind, from_user_id, to_user_id, qty, note, happened_at) VALUES (?,?,?,?,?,?,' . ($at ? '?' : 'NOW()') . ')')
        ->execute($at ? [$tid, $kind, $from, $to, $qty, mb_substr($note, 0, 255), $at] : [$tid, $kind, $from, $to, $qty, mb_substr($note, 0, 255)]);
}

function traceTry(callable $fn): void {
    try { $fn(); } catch (Throwable $e) { error_log('ChemiConnect trace: ' . $e->getMessage()); }
}

// A party in a journey step (name, role, district), or null.
function traceParty(array $e, string $p): ?array {
    if ($e[$p . '_name'] === null) return null;
    return ['name' => $e[$p . '_name'], 'role' => $e[$p . '_role'], 'district' => $e[$p . '_district']];
}

// Everything the scan page shows for one batch.
function traceView(array $t): array {
    $ev = q('SELECT e.kind, e.qty, e.note, e.happened_at, e.from_user_id,
                    f.name AS from_name, f.role AS from_role, f.district AS from_district,
                    r.name AS to_name, r.role AS to_role, r.district AS to_district
             FROM trace_events e
             LEFT JOIN users f ON f.id = e.from_user_id
             LEFT JOIN users r ON r.id = e.to_user_id
             WHERE e.trace_id = ? ORDER BY e.happened_at, e.id', [(int)$t['id']])->fetchAll();
    $events = []; $merged = [];
    foreach ($ev as $e) {
        $row = ['kind' => $e['kind'], 'qty' => (int)$e['qty'], 'note' => $e['note'], 'at' => $e['happened_at'],
                'from' => traceParty($e, 'from'), 'to' => traceParty($e, 'to'), 'count' => 1];
        if ($e['kind'] === 'dispensed') {   // many bills of the same day at the same pharmacy are shown as one step
            $k = $e['from_user_id'] . '|' . substr((string)$e['happened_at'], 0, 10);
            if (isset($merged[$k])) {
                $events[$merged[$k]]['qty'] += $row['qty'];
                $events[$merged[$k]]['count']++;
                $events[$merged[$k]]['at'] = $e['happened_at'];
                $events[$merged[$k]]['note'] = '';
                continue;
            }
            $merged[$k] = count($events);
        }
        $events[] = $row;
    }
    usort($events, function ($a, $b) { return strcmp((string)$a['at'], (string)$b['at']); });

    $holders = q('SELECT u.name, u.role, u.district, u.city, s.qty FROM stock s JOIN users u ON u.id = s.user_id
                  WHERE LOWER(s.name) = LOWER(?) AND LOWER(s.batch_no) = LOWER(?) AND s.expiry_date <=> ? AND s.qty > 0
                  ORDER BY s.qty DESC, u.name LIMIT 60', [$t['name'], $t['batch_no'], $t['expiry_date']])->fetchAll();
    foreach ($holders as &$h) $h['qty'] = (int)$h['qty'];
    unset($h);
    $inStock = (int)q('SELECT COALESCE(SUM(qty), 0) FROM stock WHERE LOWER(name) = LOWER(?) AND LOWER(batch_no) = LOWER(?) AND expiry_date <=> ?',
                      [$t['name'], $t['batch_no'], $t['expiry_date']])->fetchColumn();
    $sum = function (string $kind) use ($t) { return (int)q('SELECT COALESCE(SUM(qty), 0) FROM trace_events WHERE trace_id = ? AND kind = ?', [(int)$t['id'], $kind])->fetchColumn(); };
    $days = $t['expiry_date'] ? (int)q('SELECT DATEDIFF(?, CURDATE())', [$t['expiry_date']])->fetchColumn() : null;

    return [
        'batch' => [
            'token' => $t['token'], 'name' => $t['name'], 'batch_no' => $t['batch_no'], 'expiry_date' => $t['expiry_date'],
            'mfg_date' => $t['mfg_date'], 'manufacturer' => $t['manufacturer'], 'days_left' => $days, 'free' => isFreeMed($t['name'])
        ],
        'events' => $events,
        'holders' => $holders,
        'totals' => ['received' => $sum('received'), 'issued' => $sum('issued'), 'dispensed' => $sum('dispensed'), 'in_stock' => $inStock]
    ];
}

/**
 * Sends (or continues) an automatic request for $product on behalf of pharmacy $user.
 * Picks the nearest pharmacy that has enough spare stock and was not already asked in this chain.
 * Returns ['product' => ..., 'to' => pharmacy name] or null when nobody is left to ask.
 */
$AUTO_SKIP = [];   // medicines at the low level for which no request could be sent (reported back to the UI)
function autoRequestFor(array $user, string $product, int $qty, ?int $chain = null): ?array {
    global $AUTO_SKIP;
    if ($chain === null) {
        // do not stack requests: one open request per medicine is enough
        if (q("SELECT id FROM requests WHERE from_user_id = ? AND LOWER(product) = LOWER(?) AND status IN ('Pending','Approved','Dispatched') LIMIT 1",
              [$user['id'], $product])->fetch()) { $AUTO_SKIP[] = ['product' => $product, 'why' => 'open']; return null; }
    }
    $tried = [];
    if ($chain) {
        foreach (q('SELECT to_user_id FROM requests WHERE chain_id = ?', [$chain])->fetchAll() as $t) $tried[(int)$t['to_user_id']] = true;
    }
    // supplier must keep more than AUTO_AT units after giving, otherwise it would immediately need its own restock
    $need = $qty + AUTO_AT + 1;
    $cand = q("SELECT u.id, u.name, u.area, u.city, u.pincode
               FROM users u JOIN (SELECT user_id, SUM(qty) AS qty FROM stock
                                  WHERE LOWER(name) = LOWER(?) AND " . SQL_USABLE . " GROUP BY user_id) s ON s.user_id = u.id
               WHERE u.role = 'pharmacy' AND u.id <> ? AND s.qty >= ? AND LOWER(u.district) = LOWER(?)", [$product, $user['id'], $need, (string)$user['district']])->fetchAll();   // same district only
    $cand = array_values(array_filter($cand, function ($c) use ($tried) { return !isset($tried[(int)$c['id']]); }));
    if (!$cand) { if ($chain === null) $AUTO_SKIP[] = ['product' => $product, 'why' => 'none']; return null; }
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

/* ---------- offline sync (idempotency) ----------
 * The app lets a PHC pharma enter stock / bills with no internet. Each offline entry carries a unique client_id.
 * If the same entry reaches the server twice (e.g. the reply was lost on a weak connection) the stored result
 * is returned instead of applying it again.
 */
function cidIn(): string { $c = $GLOBALS['in']['client_id'] ?? ''; return is_string($c) ? substr(preg_replace('/[^A-Za-z0-9_\-]/', '', $c), 0, 64) : ''; }
function idemGet(int $uid): ?array {
    $c = cidIn(); if ($c === '') return null;
    $r = q('SELECT result FROM sync_log WHERE user_id = ? AND client_id = ?', [$uid, $c])->fetchColumn();
    if ($r === false) return null;
    $d = json_decode((string)$r, true);
    return is_array($d) ? array_merge($d, ['duplicate' => true]) : ['ok' => true, 'duplicate' => true];
}
function idemPut(int $uid, array $result): array {
    $c = cidIn();
    if ($c !== '') q('INSERT IGNORE INTO sync_log (user_id, client_id, result) VALUES (?,?,?)', [$uid, $c, json_encode($result, JSON_UNESCAPED_UNICODE)]);
    return $result;
}

/* ---------- request handling ---------- */
if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Use POST', 405);
$raw = file_get_contents('php://input');
$in = json_decode($raw === false || $raw === '' ? '[]' : $raw, true);
if (!is_array($in)) $in = [];
$GLOBALS['in'] = $in;
$action = $_GET['action'] ?? '';
ensureSchema();

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
        $district = districtIn();   // every account belongs to a district
        $pw = (string)($in['password'] ?? '');
        if ($name === '' || $email === '' || $pw === '') fail('Please fill all required fields');
        if ($address === '' || $area === '' || $city === '' || $state === '') fail('Please enter your full address (street, area, city and state)');
        if (!preg_match('/^[0-9]{6}$/', $pin)) fail('Enter a valid 6-digit pincode');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Enter a valid email address');
        if (strlen($pw) < 6) fail('Password must be at least 6 characters');
        if (q('SELECT id FROM users WHERE email = ? AND role = ?', [$email, $role])->fetch()) fail('An account with this email already exists. Please login.', 409);
        // one District Main PHC account per district
        if ($role === 'wholesaler' && districtMain($district))
            fail("A District Main PHC account already exists for $district district.", 409);
        $lat = isset($in['latitude']) && is_numeric($in['latitude']) ? (float)$in['latitude'] : null;
        $lng = isset($in['longitude']) && is_numeric($in['longitude']) ? (float)$in['longitude'] : null;
        if ($lat === null || $lng === null) {
            [$lat, $lng] = getCityCoords($city ?: $district, $state, $pin, 0);
        }
        q('INSERT INTO users (role, name, email, phone, address, area, city, state, pincode, district, latitude, longitude, pw_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [$role, $name, $email, $phone, $address, $area, $city, $state, $pin, $district, $lat, $lng, password_hash($pw, PASSWORD_DEFAULT)]);
        $id = (int)db()->lastInsertId();
        if ($role === 'pharmacy') seedStock(db(), $id);   // starter inventory: free essentials + dummy paid medicines with batch/expiry
        session_regenerate_id(true);
        $_SESSION['uid'] = $id;
        out(['user' => fetchUser($id)]);
    }

    case 'login': {
        $role = roleIn();
        $email = strtolower(str('email', 190));
        $pw = (string)($in['password'] ?? '');
        $u = q('SELECT id, pw_hash FROM users WHERE email = ? AND role = ?', [$email, $role])->fetch();
        $label = $role === 'pharmacy' ? 'PHC Pharma' : 'District Main PHC';
        if (!$u) fail("No $label account found for this email. Please sign up first.", 404);
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
            // low stock is per MEDICINE (usable units summed over its non-expired batches)
            $low = q('SELECT name, qty FROM (SELECT MIN(name) AS name, SUM(CASE WHEN ' . SQL_USABLE . ' THEN qty ELSE 0 END) AS qty
                                             FROM stock WHERE user_id = ? GROUP BY LOWER(name)) t
                      WHERE qty < ? ORDER BY qty, name', [$u['id'], LOW_STOCK])->fetchAll();
            foreach ($low as &$l) $l['qty'] = (int)$l['qty'];
            unset($l);
            // medicines that are at 1 unit (or 0) get their automatic request even if the stock was changed some other way
            $atLevel = [];
            foreach ($low as $l) if ($l['qty'] <= AUTO_AT) $atLevel[] = $l['name'];
            if ($atLevel) runAuto($u, $atLevel);
            // batches that are already expired or will expire soon (only batches that still have units)
            $today = (string)q('SELECT CURDATE()')->fetchColumn();
            $exp = q('SELECT name, batch_no, expiry_date, qty FROM stock
                      WHERE user_id = ? AND qty > 0 AND expiry_date IS NOT NULL AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL ' . EXPIRY_WARN_DAYS . ' DAY)
                      ORDER BY expiry_date, name LIMIT 50', [$u['id']])->fetchAll();
            foreach ($exp as &$e) { $e['qty'] = (int)$e['qty']; $e['expired'] = $e['expiry_date'] < $today; }
            unset($e);
            // requests this pharmacy sent to OTHER pharmacies
            $sent = q("SELECT COUNT(*) AS total, COALESCE(SUM(r.status = 'Pending'), 0) AS pending, COALESCE(SUM(r.status IN ('Approved','Dispatched')), 0) AS approved
                       FROM requests r JOIN users t ON t.id = r.to_user_id
                       WHERE r.from_user_id = ? AND t.role = 'pharmacy'", [$u['id']])->fetch();
            // requests received FROM other pharmacies
            $recv = q("SELECT COUNT(*) AS total, COALESCE(SUM(r.status = 'Pending'), 0) AS pending, COALESCE(SUM(r.status IN ('Approved','Dispatched')), 0) AS approved
                       FROM requests r JOIN users f ON f.id = r.from_user_id
                       WHERE r.to_user_id = ? AND f.role = 'pharmacy'", [$u['id']])->fetch();
            out([
                'low' => $low, 'expiring' => $exp,
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
        $rows = q('SELECT id, name, batch_no, expiry_date, qty, price FROM stock WHERE user_id = ?
                   ORDER BY name, expiry_date IS NULL, expiry_date, id', [$u['id']])->fetchAll();
        foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['qty'] = (int)$r['qty']; $r['free'] = isFreeMed($r['name']); $r['price'] = $r['free'] ? 0.0 : (float)$r['price']; }
        out(['stock' => $rows]);
    }

    // One row = one batch. Batch number and expiry date are required for every new batch.
    case 'stock_add': {
        $u = need('pharmacy');
        if ($prev = idemGet((int)$u['id'])) out($prev);
        $name = str('name', 150); $batch = str('batch_no', 50); $exp = dateOrNull(str('expiry_date', 10));
        $qty = whole('qty'); $price = isFreeMed($name) ? 0.0 : money('price');   // free essential medicines have no price
        if ($name === '' || $qty === null || $qty < 0 || $price === null) fail('Enter a valid name, quantity and price');
        if ($batch === '') fail('Enter the batch number');
        if ($exp === null) fail('Enter a valid expiry date');
        if (q('SELECT id FROM stock WHERE user_id = ? AND LOWER(name) = LOWER(?) AND LOWER(batch_no) = LOWER(?) AND expiry_date <=> ?', [$u['id'], $name, $batch, $exp])->fetch())
            fail('This batch is already in your inventory. Edit its quantity instead.', 409);
        if ($old = q('SELECT name FROM stock WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1', [$u['id'], $name])->fetch()) $name = $old['name']; // keep one spelling per medicine
        q('INSERT INTO stock (user_id, name, batch_no, expiry_date, qty, price) VALUES (?,?,?,?,?,?)', [$u['id'], $name, $batch, $exp, $qty, $price]);
        $newId = (int)db()->lastInsertId();   // the app needs it to link offline bills to a batch that was entered offline
        traceTry(function () use ($u, $name, $batch, $exp, $qty) {
            $pdo = db();
            traceLog($pdo, traceBatch($pdo, $name, $batch, $exp), 'stocked', null, (int)$u['id'], $qty, 'Added to inventory');
        });
        $auto = usableTotal((int)$u['id'], $name) <= AUTO_AT ? runAuto($u, [$name]) : [];
        out(idemPut((int)$u['id'], ['ok' => true, 'id' => $newId, 'auto' => $auto, 'auto_skipped' => $GLOBALS['AUTO_SKIP']]));
    }

    case 'stock_update': {
        $u = need('pharmacy');
        if ($prev = idemGet((int)$u['id'])) out($prev);
        $id = whole('id'); $qty = whole('qty');
        if (!$id || $qty === null || $qty < 0) fail('Enter a valid quantity');
        $old = q('SELECT name, qty FROM stock WHERE id = ? AND user_id = ?', [$id, $u['id']])->fetch();
        if (!$old) fail('Product not found in your inventory', 404);
        $before = usableTotal((int)$u['id'], $old['name']);
        q('UPDATE stock SET qty = ? WHERE id = ? AND user_id = ?', [$qty, $id, $u['id']]);
        $after = usableTotal((int)$u['id'], $old['name']);
        $auto = lowCross($before, $after) ? runAuto($u, [$old['name']]) : [];
        out(idemPut((int)$u['id'], ['ok' => true, 'auto' => $auto, 'auto_skipped' => $GLOBALS['AUTO_SKIP']]));
    }

    case 'stock_delete': {
        $u = need('pharmacy');
        q('DELETE FROM stock WHERE id = ? AND user_id = ?', [whole('id') ?? 0, $u['id']]);
        out(['ok' => true]);   // deleting twice is harmless, so no idempotency record is needed
    }

    /* ===== billing ===== */
    case 'bill_create': {
        $u = need('pharmacy');
        if ($prev = idemGet((int)$u['id'])) out($prev);
        $items = $in['items'] ?? [];
        if (!is_array($items) || !$items) fail('Add at least one product to the bill');
        $customer = str('customer', 150) ?: 'Walk-in Customer';
        // A bill made offline keeps the time it was really made (so the daily summary lands on the right day).
        // Accepted only when it is a valid local date-time, not in the future and not older than 31 days.
        $soldAt = null;
        $sa = str('sold_at', 19);
        if ($sa !== '' && ($dt = DateTime::createFromFormat('Y-m-d H:i:s', $sa)) && $dt->format('Y-m-d H:i:s') === $sa) {
            $nowTs = time(); $ts = $dt->getTimestamp();
            if ($ts <= $nowTs + 300 && $ts >= $nowTs - 31 * 86400) $soldAt = $sa;
        }
        $res = tx(function ($pdo) use ($u, $items, $customer, $soldAt) {
            $total = 0.0; $lines = []; $crossed = []; $dis = [];
            foreach ($items as $it) {
                $id = (int)($it['id'] ?? 0); $qty = (int)($it['qty'] ?? 0);
                if ($id < 1 || $qty < 1) throw new Bad('Invalid bill item');
                $s = $pdo->prepare('SELECT id, name, batch_no, expiry_date, qty, price, (expiry_date IS NOT NULL AND expiry_date < CURDATE()) AS expired FROM stock WHERE id = ? AND user_id = ? FOR UPDATE');
                $s->execute([$id, $u['id']]);
                $r = $s->fetch();
                if (!$r) throw new Bad('Product not found in your inventory');
                if ((int)$r['expired'] === 1) throw new Bad($r['name'] . ' (batch ' . $r['batch_no'] . ') has expired and cannot be sold');
                if ((int)$r['qty'] < $qty) throw new Bad('Insufficient stock for ' . $r['name'] . ($r['batch_no'] !== '' ? ' (batch ' . $r['batch_no'] . ')' : ''));
                $before = usableTotal((int)$u['id'], $r['name'], $pdo);
                $pdo->prepare('UPDATE stock SET qty = qty - ? WHERE id = ?')->execute([$qty, $id]);
                if (lowCross($before, $before - $qty) && !in_array($r['name'], $crossed, true)) $crossed[] = $r['name'];
                $unit = isFreeMed($r['name']) ? 0.0 : (float)$r['price'];   // free essentials are billed at 0
                $total += $qty * $unit;
                $lines[] = [$r['name'], $qty, $unit];
                $dis[] = [$r['name'], (string)$r['batch_no'], $r['expiry_date'], $qty];
            }
            $n = (int)$pdo->query('SELECT COUNT(*) FROM bills WHERE user_id = ' . (int)$u['id'])->fetchColumn() + 1;
            $no = 'INV-' . str_pad((string)$n, 4, '0', STR_PAD_LEFT);
            if ($soldAt) $pdo->prepare('INSERT INTO bills (user_id, bill_no, customer, total, created_at) VALUES (?,?,?,?,?)')
                ->execute([$u['id'], $no, $customer, $total, $soldAt]);
            else $pdo->prepare('INSERT INTO bills (user_id, bill_no, customer, total) VALUES (?,?,?,?)')
                ->execute([$u['id'], $no, $customer, $total]);
            $bid = (int)$pdo->lastInsertId();
            $ins = $pdo->prepare('INSERT INTO bill_items (bill_id, name, qty, price) VALUES (?,?,?,?)');
            foreach ($lines as $l) $ins->execute([$bid, $l[0], $l[1], $l[2]]);
            foreach ($dis as $d) {
                if ($d[1] === '') continue;   // old rows without a batch number cannot be tracked
                traceTry(function () use ($pdo, $u, $d, $no, $soldAt) {
                    traceLog($pdo, traceBatch($pdo, $d[0], $d[1], $d[2]), 'dispensed', (int)$u['id'], null, (int)$d[3], 'Bill ' . $no, $soldAt);
                });
            }
            return ['bill_no' => $no, 'total' => $total, 'crossed' => $crossed];
        });
        $auto = runAuto($u, $res['crossed']);   // after commit, so a failed auto request never undoes the bill
        out(idemPut((int)$u['id'], ['bill_no' => $res['bill_no'], 'total' => $res['total'], 'auto' => $auto, 'auto_skipped' => $GLOBALS['AUTO_SKIP']]));
    }

    /* ===== sales records (every bill line + day wise summary) ===== */
    // One row per bill line: bill id, date, product, unit cost, quantity, amount. Optional 'date' (YYYY-MM-DD) filter.
    case 'sales_log': {
        $u = need('pharmacy');
        $date = str('date', 10);
        $sql = 'SELECT b.bill_no, b.created_at, bi.name, bi.qty, bi.price
                FROM bill_items bi JOIN bills b ON b.id = bi.bill_id WHERE b.user_id = ?';
        $p = [$u['id']];
        if ($date !== '') {
            $d = DateTime::createFromFormat('Y-m-d', $date);
            if (!$d || $d->format('Y-m-d') !== $date) fail('Enter a valid date');
            $sql .= ' AND DATE(b.created_at) = ?'; $p[] = $date;
        }
        $rows = q($sql . ' ORDER BY b.id DESC, bi.id ASC LIMIT 1001', $p)->fetchAll();
        $truncated = count($rows) > 1000;
        $rows = array_slice($rows, 0, 1000);
        foreach ($rows as &$r) {
            $r['qty'] = (int)$r['qty']; $r['price'] = (float)$r['price'];
            $r['amount'] = round($r['qty'] * $r['price'], 2);
        }
        unset($r);
        out(['sales' => $rows, 'truncated' => $truncated]);
    }

    // One entry per calendar day (newest first): bills, total, and each product with the quantity sold that day.
    // Computed from the stored bills, so a day is complete the moment midnight passes - no scheduled job needed.
    case 'sales_daily': {
        $u = need('pharmacy');
        $today = (string)q('SELECT CURDATE()')->fetchColumn();
        $days = q('SELECT DATE(created_at) AS d, COUNT(*) AS bills, COALESCE(SUM(total), 0) AS total
                   FROM bills WHERE user_id = ? GROUP BY DATE(created_at) ORDER BY d DESC LIMIT 366', [$u['id']])->fetchAll();
        if (!$days) out(['today' => $today, 'days' => []]);
        $oldest = $days[count($days) - 1]['d'];
        $items = q('SELECT DATE(b.created_at) AS d, bi.name, SUM(bi.qty) AS qty, SUM(bi.qty * bi.price) AS amount
                    FROM bill_items bi JOIN bills b ON b.id = bi.bill_id
                    WHERE b.user_id = ? AND DATE(b.created_at) >= ?
                    GROUP BY DATE(b.created_at), bi.name ORDER BY d DESC, bi.name', [$u['id'], $oldest])->fetchAll();
        $by = [];
        foreach ($items as $i) $by[$i['d']][] = ['name' => $i['name'], 'qty' => (int)$i['qty'], 'amount' => round((float)$i['amount'], 2)];
        $res = [];
        foreach ($days as $d) $res[] = ['date' => $d['d'], 'bills' => (int)$d['bills'], 'total' => round((float)$d['total'], 2), 'items' => $by[$d['d']] ?? []];
        out(['today' => $today, 'days' => $res]);
    }

    /* ===== network (stock sharing) ===== */
    case 'network': {
        $u = need('pharmacy');
        $product = str('product', 150);
        $ph = q("SELECT u.id, u.name, u.area, u.city, u.pincode, COALESCE(s.qty, 0) AS avail
                 FROM users u LEFT JOIN (SELECT user_id, SUM(qty) AS qty FROM stock
                                         WHERE LOWER(name) = LOWER(?) AND " . SQL_USABLE . " GROUP BY user_id) s ON s.user_id = u.id
                 WHERE u.role = 'pharmacy' AND u.id <> ? AND LOWER(u.district) = LOWER(?) ORDER BY u.name", [$product, $u['id'], (string)$u['district']])->fetchAll();   // same district only
        foreach ($ph as &$p) { $p['id'] = (int)$p['id']; $p['avail'] = (int)$p['avail']; }
        unset($p);
        $ph = sortNearby($u, $ph);   // nearest pharmacy first
        // PHC pharmas never send stock requests to a District Main PHC - they raise an Indent (district-wise) instead
        out(['pharmacies' => $ph, 'wholesalers' => []]);
    }

    /* ===== nearby pharmacy & wholesaler map discovery ===== */
    case 'nearby_suppliers': {
        $u = need();
        $lat = isset($in['lat']) && is_numeric($in['lat']) ? (float)$in['lat'] : null;
        $lng = isset($in['lng']) && is_numeric($in['lng']) ? (float)$in['lng'] : null;
        $radius = isset($in['radius']) && is_numeric($in['radius']) ? (float)$in['radius'] : null; // km: 5, 10, 25, 0 = all
        $product = str('product', 150);
        $qty = whole('qty') ?: 1;
        $roleFilter = str('role_filter', 20); // 'all', 'pharmacy', 'wholesaler'
        if ($u['role'] === 'pharmacy') $roleFilter = 'pharmacy';   // PHC pharmas only discover other PHC pharmas (District Main is reached via Indent)

        // Determine user's anchor location if not supplied
        if ($lat === null || $lng === null) {
            if ($u['latitude'] !== null && $u['longitude'] !== null) {
                $lat = (float)$u['latitude'];
                $lng = (float)$u['longitude'];
            } else {
                [$lat, $lng] = getCityCoords($u['city'], $u['state'], $u['pincode'], (int)$u['id']);
            }
        }

        try {
            $sql = "SELECT id, role, name, email, phone, address, area, city, state, pincode, latitude, longitude, created_at FROM users WHERE id <> ? AND LOWER(district) = LOWER(?)";   // same district only
            $params = [$u['id'], (string)$u['district']];
            if ($roleFilter === 'pharmacy') { $sql .= " AND role = 'pharmacy'"; }
            elseif ($roleFilter === 'wholesaler') { $sql .= " AND role = 'wholesaler'"; }
            $users = q($sql, $params)->fetchAll();
        } catch (PDOException $e) {
            $sql = "SELECT id, role, name, email, phone, address, area, city, state, pincode, created_at FROM users WHERE id <> ? AND LOWER(district) = LOWER(?)";   // same district only
            $params = [$u['id'], (string)$u['district']];
            if ($roleFilter === 'pharmacy') { $sql .= " AND role = 'pharmacy'"; }
            elseif ($roleFilter === 'wholesaler') { $sql .= " AND role = 'wholesaler'"; }
            $users = q($sql, $params)->fetchAll();
        }

        $results = [];
        foreach ($users as $supplier) {
            $sId = (int)$supplier['id'];
            $sRole = $supplier['role'];
            $sLat = isset($supplier['latitude']) && $supplier['latitude'] !== null ? (float)$supplier['latitude'] : null;
            $sLng = isset($supplier['longitude']) && $supplier['longitude'] !== null ? (float)$supplier['longitude'] : null;

            if ($sLat === null || $sLng === null) {
                [$sLat, $sLng] = getCityCoords($supplier['city'], $supplier['state'], $supplier['pincode'], $sId);
            }

            $distKm = haversineDistance($lat, $lng, $sLat, $sLng);
            if ($radius !== null && $radius > 0 && $distKm > $radius) {
                continue;
            }

            $info = [
                'id' => $sId,
                'name' => $supplier['name'],
                'role' => $sRole,
                'type_label' => $sRole === 'pharmacy' ? 'PHC Pharma' : 'District Main PHC',
                'address' => $supplier['address'],
                'area' => $supplier['area'],
                'city' => $supplier['city'],
                'state' => $supplier['state'],
                'pincode' => $supplier['pincode'],
                'phone' => $supplier['phone'],
                'latitude' => $sLat,
                'longitude' => $sLng,
                'distance_km' => round($distKm, 2),
                'available_stock' => 0,
                'has_stock' => false,
                'has_sufficient_stock' => false,
                'batches_count' => 0,
                'earliest_expiry' => null,
                'wholesaler_price' => null,
                'wholesaler_listed' => false,
            ];

            if ($sRole === 'pharmacy') {
                if ($product !== '') {
                    $st = q("SELECT COALESCE(SUM(qty), 0) AS avail, COUNT(id) AS batches, MIN(expiry_date) AS earliest_expiry
                             FROM stock WHERE user_id = ? AND LOWER(name) = LOWER(?) AND " . SQL_USABLE, [$sId, $product])->fetch();
                    $avail = (int)($st['avail'] ?? 0);
                    $info['available_stock'] = $avail;
                    $info['has_stock'] = $avail > 0;
                    $info['has_sufficient_stock'] = $avail >= $qty;
                    $info['batches_count'] = (int)($st['batches'] ?? 0);
                    $info['earliest_expiry'] = $st['earliest_expiry'] ?? null;
                } else {
                    $tot = q("SELECT COALESCE(SUM(qty), 0) AS total_units, COUNT(DISTINCT name) AS med_count FROM stock WHERE user_id = ? AND " . SQL_USABLE, [$sId])->fetch();
                    $info['available_stock'] = (int)($tot['total_units'] ?? 0);
                    $info['distinct_medicines'] = (int)($tot['med_count'] ?? 0);
                    $info['has_stock'] = $info['available_stock'] > 0;
                    $info['has_sufficient_stock'] = true;
                }
            } else {
                // Wholesaler
                if ($product !== '') {
                    $pr = q("SELECT price FROM products WHERE user_id = ? AND LOWER(name) = LOWER(?)", [$sId, $product])->fetch();
                    if ($pr) {
                        $info['wholesaler_listed'] = true;
                        $info['wholesaler_price'] = (float)$pr['price'];
                        $info['has_stock'] = true;
                        $info['has_sufficient_stock'] = true;
                    } else {
                        $info['wholesaler_listed'] = false;
                        $info['has_stock'] = false;
                        $info['has_sufficient_stock'] = false;
                    }
                } else {
                    $catCount = (int)q("SELECT COUNT(*) FROM products WHERE user_id = ?", [$sId])->fetchColumn();
                    $info['distinct_medicines'] = $catCount;
                    $info['has_stock'] = $catCount > 0;
                    $info['has_sufficient_stock'] = true;
                }
            }

            $results[] = $info;
        }

        // Sort by distance (nearest first)
        usort($results, function($a, $b) {
            return $a['distance_km'] <=> $b['distance_km'];
        });

        out([
            'user_location' => ['lat' => $lat, 'lng' => $lng],
            'suppliers' => $results,
            'total_found' => count($results)
        ]);
    }

    case 'medicines_search': {
        need();
        $term = str('q', 150);
        if ($term === '') {
            out(['medicines' => []]);
        }
        $like = '%' . $term . '%';
        $rows = q("SELECT DISTINCT name FROM (
                     SELECT name FROM stock WHERE LOWER(name) LIKE LOWER(?) AND " . SQL_USABLE . "
                     UNION
                     SELECT name FROM products WHERE LOWER(name) LIKE LOWER(?)
                   ) t ORDER BY name LIMIT 20", [$like, $like])->fetchAll();
        $names = array_column($rows, 'name');
        out(['medicines' => $names]);
    }

    case 'user_update_location': {
        $u = need();
        $lat = isset($in['lat']) && is_numeric($in['lat']) ? (float)$in['lat'] : null;
        $lng = isset($in['lng']) && is_numeric($in['lng']) ? (float)$in['lng'] : null;
        if ($lat === null || $lng === null || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
            fail('Valid latitude (-90 to 90) and longitude (-180 to 180) required');
        }
        try {
            q('UPDATE users SET latitude = ?, longitude = ? WHERE id = ?', [$lat, $lng, $u['id']]);
        } catch (PDOException $e) {
            fail('Database column for coordinates not ready. Please run backend/migration_map.sql', 500);
        }
        out(['ok' => true, 'user' => fetchUser((int)$u['id'])]);
    }

    case 'request_create': {
        $u = need('pharmacy');
        $to = whole('to_id'); $product = str('product', 150); $qty = whole('qty');
        if (!$to || $product === '' || !$qty || $qty < 1) fail('Enter a medicine name and quantity');
        if ($to === $u['id']) fail('You cannot send a request to yourself');
        $recipient = q('SELECT id, role, name, district FROM users WHERE id = ?', [$to])->fetch();
        if (!$recipient) fail('Recipient not found', 404);
        if (strcasecmp((string)$recipient['district'], (string)$u['district']) !== 0) fail('You can only send requests to PHC pharmas in your own district (' . $u['district'] . ').', 403);
        if ($recipient['role'] !== 'pharmacy') fail('Stock requests can only go to other PHC pharmas. To get stock from the District Main PHC, raise an Indent.', 403);
        if ($recipient['role'] === 'pharmacy') {
            $have = usableTotal((int)$to, $product);
            if ($have < $qty) {
                fail("Supplier does not have sufficient unexpired stock ({$have} unit(s) available, {$qty} requested)", 409);
            }
        }
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

                $qty = (int)$r['qty']; $name = $r['product']; $price = 0.0; $crossed = null; $moved = [];
                $s = $pdo->prepare('SELECT role FROM users WHERE id = ?');
                $s->execute([$r['to_user_id']]);
                $role = $s->fetchColumn();

                if ($role === 'pharmacy') {
                    // the supplier gives units from its batches, earliest expiry first; every batch keeps its batch no. + expiry date
                    $s = $pdo->prepare('SELECT id, name, batch_no, expiry_date, qty, price FROM stock
                                        WHERE user_id = ? AND LOWER(name) = LOWER(?) AND qty > 0 AND ' . SQL_USABLE . '
                                        ORDER BY expiry_date IS NULL, expiry_date, id FOR UPDATE');
                    $s->execute([$r['to_user_id'], $r['product']]);
                    $batches = $s->fetchAll();
                    $have = 0;
                    foreach ($batches as $b) $have += (int)$b['qty'];
                    if ($have < $qty) {
                        // supplier sold the units in the meantime: close this request, caller moves on to the next pharmacy
                        $pdo->prepare("UPDATE requests SET status = 'Rejected' WHERE id = ?")->execute([$id]);
                        return ['failed' => true, 'req' => $r];
                    }
                    $left = $qty;
                    foreach ($batches as $b) {
                        if ($left <= 0) break;
                        $take = min($left, (int)$b['qty']);
                        $pdo->prepare('UPDATE stock SET qty = qty - ? WHERE id = ?')->execute([$take, $b['id']]);   // supplier decreases
                        $moved[] = [$b['name'], (string)$b['batch_no'], $b['expiry_date'], $take, (float)$b['price']];
                        $left -= $take;
                    }
                    if (lowCross($have, $have - $qty)) $crossed = $batches[0]['name'];
                } else {
                    // District Main PHC stock orders carry no batch details
                    $s = $pdo->prepare('SELECT name, price FROM products WHERE user_id = ? AND LOWER(name) = LOWER(?)');
                    $s->execute([$r['to_user_id'], $r['product']]);
                    if ($p = $s->fetch()) { $name = $p['name']; $price = (float)$p['price']; }
                    $moved[] = [$name, '', null, $qty, $price];
                }

                // requester increases, batch by batch
                foreach ($moved as $m) {
                    stockAdd($pdo, (int)$u['id'], $m[0], $m[1], $m[2], $m[3], $m[4]);
                    if ($role === 'pharmacy' && $m[1] !== '') traceTry(function () use ($pdo, $u, $r, $m, $id) {
                        traceLog($pdo, traceBatch($pdo, $m[0], $m[1], $m[2]), 'transferred', (int)$r['to_user_id'], (int)$u['id'], (int)$m[3], 'Stock request #' . $id);
                    });
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
                    $have = usableTotal((int)$u['id'], $r['product'], $pdo);
                    if ($have < (int)$r['qty'])
                        throw new Bad('Not enough usable (non-expired) stock to dispatch. You have ' . $have . ' unit(s) of ' . $r['product'], 409);
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
                $have = usableTotal((int)$u['id'], $r['product'], $pdo);
                if ($have < (int)$r['qty'])
                    throw new Bad('Not enough usable (non-expired) stock to approve. You have ' . $have . ' unit(s) of ' . $r['product'], 409);
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
        // a PHC pharma can only ever see / indent to the District Main PHC of ITS OWN district
        $m = districtMain((string)$u['district']);
        out(['district' => $u['district'], 'wholesalers' => $m ? [$m] : []]);
    }

    case 'indent_create': {
        $u = need('pharmacy');
        // Destination is decided by the SERVER from the pharma's district - the client cannot pick another district.
        if ((string)$u['district'] === '') fail('Your account has no district. Please contact support.');
        $main = districtMain((string)$u['district']);
        if (!$main) fail('No District Main PHC account exists for ' . $u['district'] . ' district yet. Ask your district to register one.');
        $to = (int)$main['id'];
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
                ->execute([$no, $u['id'], $to, $inst, $u['district'], str('block', 100), str('address', 255), $date,
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
        // District Main PHC sees only indents of PHC pharmas in its own district
        $rows = q("SELECT i.*, o.name AS other_name, o.phone AS other_phone, o.city AS other_city
                   FROM indents i JOIN users o ON o.id = $other
                   WHERE $mine = ?" . ($u['role'] === 'pharmacy' ? '' : ' AND LOWER(o.district) = LOWER(?)') . " ORDER BY i.id DESC",
                  $u['role'] === 'pharmacy' ? [$u['id']] : [$u['id'], (string)$u['district']])->fetchAll();
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

    // District Main PHC approves or rejects. On approval it gives, per item, the quantity issued + batch number + expiry date,
    // and those items are added to the requesting PHC pharma's inventory automatically (same transaction).
    // $in['lines'] = { <indent_item_id>: { qty, batch, expiry (YYYY-MM-DD) }, ... }
    case 'indent_update': {
        $u = need('wholesaler');
        $id = whole('id'); $status = str('status', 20);
        if (!$id || !in_array($status, ['Approved', 'Rejected'], true)) fail('Invalid request');
        $lines = isset($in['lines']) && is_array($in['lines']) ? $in['lines'] : [];
        $stocked = tx(function ($pdo) use ($u, $id, $status, $lines) {
            $s = $pdo->prepare('SELECT i.status, i.indent_no, i.from_user_id, p.district AS pharma_district FROM indents i JOIN users p ON p.id = i.from_user_id WHERE i.id = ? AND i.to_user_id = ? FOR UPDATE');
            $s->execute([$id, $u['id']]);
            $ind = $s->fetch();
            if (!$ind) throw new Bad('Indent not found', 404);
            if (strcasecmp((string)$ind['pharma_district'], (string)$u['district']) !== 0) throw new Bad('This indent is from a PHC pharma outside your district', 403);
            if ($ind['status'] !== 'Pending') throw new Bad('This indent is already processed', 409);
            $count = 0;
            if ($status === 'Approved') {
                $today = (string)$pdo->query('SELECT CURDATE()')->fetchColumn();
                $s = $pdo->prepare('SELECT id, name, qty_required FROM indent_items WHERE indent_id = ? ORDER BY sno');
                $s->execute([$id]);
                $upd = $pdo->prepare('UPDATE indent_items SET qty_issued = ?, batch_no = ?, expiry_date = ? WHERE id = ?');
                $cat = $pdo->prepare('SELECT price FROM products WHERE user_id = ? AND LOWER(name) = LOWER(?)');
                $total = 0;
                foreach ($s->fetchAll() as $it) {
                    $ln = (isset($lines[$it['id']]) && is_array($lines[$it['id']])) ? $lines[$it['id']] : [];
                    $q = array_key_exists('qty', $ln) ? nat($ln['qty']) : (int)$it['qty_required'];
                    $q = min($q, (int)$it['qty_required']);
                    $batch = mb_substr(trim((string)($ln['batch'] ?? '')), 0, 50);
                    $exp = null;
                    if ($q > 0) {
                        if ($batch === '') throw new Bad('Enter the batch number for ' . $it['name']);
                        $exp = dateOrNull(trim((string)($ln['expiry'] ?? '')));
                        if ($exp === null) throw new Bad('Enter a valid expiry date for ' . $it['name']);
                        if ($exp < $today) throw new Bad($it['name'] . ' batch ' . $batch . ' has already expired');
                    } else {
                        $batch = '';
                    }
                    $upd->execute([$q, $batch, $exp, $it['id']]);
                    if ($q > 0) {
                        $cat->execute([$u['id'], $it['name']]);
                        $price = (float)($cat->fetchColumn() ?: 0);
                        stockAdd($pdo, (int)$ind['from_user_id'], $it['name'], $batch, $exp, $q, $price);   // PHC pharma inventory updates here
                        traceTry(function () use ($pdo, $u, $ind, $it, $batch, $exp, $q) {
                            traceLog($pdo, traceBatch($pdo, $it['name'], $batch, $exp, (int)$u['id']), 'issued', (int)$u['id'], (int)$ind['from_user_id'], $q, 'Indent ' . $ind['indent_no']);
                        });
                        $count++; $total += $q;
                    }
                }
                if ($total < 1) throw new Bad('Issue at least one item, or reject the indent');
            }
            $pdo->prepare('UPDATE indents SET status = ? WHERE id = ?')->execute([$status, $id]);
            return $count;
        });
        out(['ok' => true, 'stocked' => $stocked]);
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
        if ($name === '' || $price === null) fail('Enter product name and supply price');
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
        $u = need('wholesaler');
        $rows = q("SELECT id, name, address, area, city, state, pincode, phone, created_at FROM users WHERE role = 'pharmacy' AND LOWER(district) = LOWER(?) ORDER BY name", [(string)$u['district']])->fetchAll();   // own district only
        out(['pharmacies' => $rows]);
    }

    /* ===== medicine tracking: scan the QR of a batch, see its journey from manufacturing to expiry ===== */
    // Batches the signed-in account can print QR labels for. A PHC Pharma gets one for every batch in its inventory
    // (old and starter stock included); a District Main PHC gets the batches it registered or issued.
    case 'trace_list': {
        $u = need();
        $pdo = db();
        $same = 't.expiry_date <=> s.expiry_date AND LOWER(t.name) = LOWER(s.name) AND LOWER(t.batch_no) = LOWER(s.batch_no)';
        if ($u['role'] === 'pharmacy') {
            // batches of this inventory that have no tracking record yet (or no "arrived here" step): create them
            $todo = q("SELECT s.name, s.batch_no, s.expiry_date, s.qty, t.id AS tid FROM stock s
                       LEFT JOIN trace_batches t ON $same
                       WHERE s.user_id = ? AND s.batch_no <> ''
                         AND (t.id IS NULL OR NOT EXISTS (SELECT 1 FROM trace_events e WHERE e.trace_id = t.id AND e.to_user_id = s.user_id))
                       LIMIT 400", [$u['id']])->fetchAll();
            foreach ($todo as $r) traceTry(function () use ($pdo, $u, $r) {
                $tid = $r['tid'] ? (int)$r['tid'] : traceBatch($pdo, $r['name'], $r['batch_no'], $r['expiry_date']);
                traceLog($pdo, $tid, 'stocked', null, (int)$u['id'], (int)$r['qty'], 'Opening stock (tracking started)');
            });
            $rows = q("SELECT t.token, t.name, t.batch_no, t.expiry_date, t.mfg_date, t.manufacturer, s.qty
                       FROM stock s JOIN trace_batches t ON $same
                       WHERE s.user_id = ? AND s.batch_no <> ''
                       ORDER BY s.name, s.expiry_date IS NULL, s.expiry_date, s.id", [$u['id']])->fetchAll();
            foreach ($rows as &$r) $r['qty'] = (int)$r['qty'];
        } else {
            $rows = q("SELECT t.token, t.name, t.batch_no, t.expiry_date, t.mfg_date, t.manufacturer,
                              (SELECT COALESCE(SUM(e.qty), 0) FROM trace_events e WHERE e.trace_id = t.id AND e.kind = 'received' AND e.to_user_id = ?) AS qty_in,
                              (SELECT COALESCE(SUM(e.qty), 0) FROM trace_events e WHERE e.trace_id = t.id AND e.kind = 'issued' AND e.from_user_id = ?) AS qty_out
                       FROM trace_batches t
                       WHERE t.created_by = ? OR EXISTS (SELECT 1 FROM trace_events e WHERE e.trace_id = t.id AND (e.from_user_id = ? OR e.to_user_id = ?))
                       ORDER BY t.created_at DESC, t.id DESC LIMIT 300", [$u['id'], $u['id'], $u['id'], $u['id'], $u['id']])->fetchAll();
            foreach ($rows as &$r) { $r['qty_in'] = (int)$r['qty_in']; $r['qty_out'] = (int)$r['qty_out']; }
        }
        unset($r);
        out(['batches' => $rows]);
    }

    // 'code' = what the QR contained (a link with ?trace=TOKEN, or just the token) or something typed by hand
    // (a batch number or medicine name). A token shows the full journey; typed text shows the batches that match.
    case 'trace_lookup': {
        need();
        $raw = str('code', 300);
        if ($raw === '') fail('Scan a QR code or type a batch number first');
        $token = null;
        if (preg_match('/[?&]trace=([A-Za-z0-9]{6,20})/', $raw, $m)) $token = strtoupper($m[1]);
        elseif (preg_match('/^CC[A-Za-z0-9]{10}$/', $raw)) $token = strtoupper($raw);
        if ($token !== null) {
            $t = q('SELECT * FROM trace_batches WHERE token = ?', [$token])->fetch();
            if (!$t) fail('This QR code is not known to ChemiConnect. The medicine may not be registered here.', 404);
            out(['trace' => traceView($t)]);
        }
        $like = '%' . addcslashes($raw, '%_\\') . '%';
        $rows = q('SELECT token, name, batch_no, expiry_date FROM trace_batches WHERE batch_no LIKE ? OR name LIKE ? ORDER BY name, expiry_date LIMIT 20', [$like, $like])->fetchAll();
        if (!$rows) fail('No medicine batch matches "' . $raw . '". Check the batch number, or scan the QR code on the pack.', 404);
        if (count($rows) === 1) {
            $t = q('SELECT * FROM trace_batches WHERE token = ?', [$rows[0]['token']])->fetch();
            out(['trace' => traceView($t)]);
        }
        out(['matches' => $rows]);
    }

    // District Main PHC: register a batch received from the manufacturer. This is where a batch's journey starts.
    case 'trace_register': {
        $u = need('wholesaler');
        $name = str('name', 150); $batch = str('batch_no', 50); $maker = str('manufacturer', 150);
        $exp = dateOrNull(str('expiry_date', 10)); $mfg = dateOrNull(str('mfg_date', 10)); $qty = whole('qty');
        if ($name === '' || $batch === '') fail('Enter the medicine name and the batch number');
        if ($maker === '') fail('Enter the manufacturer');
        if ($mfg === null) fail('Enter a valid manufacturing date');
        if ($exp === null) fail('Enter a valid expiry date');
        $today = (string)db()->query('SELECT CURDATE()')->fetchColumn();
        if ($mfg > $today) fail('The manufacturing date cannot be in the future');
        if ($exp <= $mfg) fail('The expiry date must be after the manufacturing date');
        if ($qty === null || $qty < 1) fail('Enter how many units you received');
        $res = tx(function ($pdo) use ($u, $name, $batch, $maker, $exp, $mfg, $qty) {
            $tid = traceBatch($pdo, $name, $batch, $exp, (int)$u['id']);
            $s = $pdo->prepare("SELECT COUNT(*) FROM trace_events WHERE trace_id = ? AND kind = 'manufactured'");
            $s->execute([$tid]);
            $existing = (int)$s->fetchColumn() > 0;
            if (!$existing) {   // first registration of this batch: the manufacturing details are recorded once and never overwritten
                $pdo->prepare('UPDATE trace_batches SET mfg_date = ?, manufacturer = ?, mfg_qty = ?, created_by = COALESCE(created_by, ?) WHERE id = ?')
                    ->execute([$mfg, $maker, $qty, (int)$u['id'], $tid]);
                traceLog($pdo, $tid, 'manufactured', null, null, 0, 'Manufactured by ' . $maker, $mfg . ' 00:00:00');
            }
            traceLog($pdo, $tid, 'received', null, (int)$u['id'], $qty, $existing ? 'Another consignment of this batch received' : 'Received from the manufacturer');
            $s = $pdo->prepare('SELECT token FROM trace_batches WHERE id = ?');
            $s->execute([$tid]);
            return ['ok' => true, 'token' => $s->fetchColumn(), 'existing' => $existing];
        });
        out($res);
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
