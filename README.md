# ChemiConnect

B2B platform for PHC pharmas and the District Main PHC. Stack: React (Vite) + PHP 7.4+ (PDO) + MySQL/MariaDB.

## Setup

1. **Database** - start MySQL (XAMPP / WAMP / any MySQL) and import the schema:

       mysql -u root -p < backend/schema.sql

   (or phpMyAdmin -> Import -> `backend/schema.sql`). This creates the `chemiconnect` database and tables.
   If your MySQL user/password is not `root` / empty, edit `backend/config.php`.

   **Getting "Unknown column ..." / "Database error"?** Import `backend/repair.sql` (phpMyAdmin -> Import). It is safe to run any number of times: it only adds whatever is missing and never touches your data.

   **Already imported an older schema?** Run the upgrades once, in order (keeps your data):

       mysql -u root -p chemiconnect < backend/migration.sql     # full address + Received flow (skip if already run)
       mysql -u root -p chemiconnect < backend/migration_2.sql   # Dispatched step + Indent tables
       mysql -u root -p chemiconnect < backend/migration_3.sql   # Batch number + expiry date in inventory (safe to re-run)
       mysql -u root -p chemiconnect < backend/migration_map.sql # Latitude + longitude coordinates for nearby map discovery
       mysql -u root -p chemiconnect < backend/migration_district.sql # District on every account (district-wise indents)
       mysql -u root -p chemiconnect < backend/migration_offline.sql # sync_log table for offline mode (safe to re-run)
       mysql -u root -p chemiconnect < backend/migration_trace.sql # QR medicine tracking tables (safe to re-run)

   (The API also runs these column upgrades by itself on first login, so batch/expiry and district work even if a migration was skipped.)

   `backend/repair.sql` also includes all upgrades (batches, expiry, coordinates), so running it is enough if you are unsure which migrations were applied.

2. **PHP API** (needs the `pdo_mysql` extension, enabled by default in XAMPP):

       npm run api          # = php -S localhost:8000 -t backend

   On Windows with XAMPP, if `php` is not on PATH: `C:\xampp\php\php.exe -S localhost:8000 -t backend`

3. **Frontend** (second terminal):

       npm install
       npm run dev          # open the URL Vite prints (http://localhost:5173)

Vite forwards every `/api/*` call to the PHP server (change with `API_TARGET=http://host:port`).

## How it works

- Navbar: Home | About Us | Contact (center), For Wholesalers, Login, Sign Up (pharmacies).
- Pharmacies and wholesalers have separate accounts (passwords are hashed, PHP sessions).
- **Pharmacy dashboard**: 3 cards - low-stock warnings (medicines with fewer than 4 units), requests sent to other pharmacies, requests received from other pharmacies - and a warnings list (medicine + units left).
- **Network**: type a medicine, see which pharmacies have it, send a request (to pharmacies or wholesalers).
- **Sign up** asks for the full address (street, area, city, state, 6-digit pincode). Pharmacies are ranked by distance using the pincode (longest shared prefix first, then same area, then same city).
- **Requests**: `Pending` -> supplier **Approves** or **Rejects** -> supplier marks **Dispatched** -> requester marks **Received** (the button only appears after dispatch). Stock moves only at *Received* (supplier decreases, requester increases, in one DB transaction). The supplier's address and phone are shown once approved.
- **Automatic requests**: when a medicine's stock drops to `AUTO_AT` (1) unit or fewer - through billing, an inventory edit, or giving stock away - a request for `AUTO_QTY` (10) units is sent to the nearest pharmacy that has enough spare stock. If that pharmacy rejects (or can no longer supply at *Received* time), the request goes to the next nearest pharmacy, and so on. Both constants are at the top of `backend/api.php` (and `AUTO_AT` in `src/App.jsx` for the hint text).
- **Batch-wise inventory**: every inventory row is one *batch* (medicine name + **batch number** + **expiry date** + quantity + price). Adding a medicine needs a batch number and an expiry date; a new batch of a medicine you already stock becomes its own row. Rows show *Expired* / *Expires in N days* (30-day warning); the dashboard has an **Expiry Alerts** card. Low-stock warnings and the automatic-request trigger count a medicine's **usable (non-expired) units over all its batches**. Expired batches cannot be billed, and are not counted as available to other pharmacies. Old rows created before this upgrade have no batch/expiry and show "-".
- **Wholesaler**: catalogue, inbound orders (approve/reject), registered pharmacies.
- Billing POS is still available in the pharmacy sidebar and reduces stock when an invoice is generated.

- **Free essential medicines**: PHCs give the essential medicines below free of cost; every other medicine is paid. The server forces the price of a free medicine to 0 (inventory, billing/POS, indents) and the UI shows a green **FREE** tag. Free list (matched by medicine name): Paracetamol, Cetirizine, Omeprazole, Antacid, Amoxicillin, ORS, Zinc, Metformin, Amlodipine, Salbutamol inhaler, Iron-Folic Acid, Vitamin A, Povidone-iodine, Clotrimazole cream, Albendazole. To change the list edit `FREE_MED_RE` in `backend/api.php` and `FREE_RE` in `src/App.jsx`.
- **Starter inventory**: every PHC Pharma account gets a big dummy stock - 152 batches of 138 medicines (the 15 free essentials in several strengths plus ~110 paid medicines, IV fluids, dressings...) - each with its own batch number, expiry date, quantity and price (`SEED_MEDS` in `backend/api.php`). New accounts get it at sign up; **existing PHC Pharma accounts get the medicines they do not stock yet the first time they log in** (version `SEED_VER`, stored in `users.stock_seed_v`; existing stock is never changed). Some medicines have 2 batches, 3 batches expire this month (Expiry Alerts card) and 3 have fewer than 4 units (low-stock warnings) so the alerts can be demonstrated. To change the list edit `SEED_MEDS` and raise `SEED_VER`. `backend/seed_inventory.sql` does the same straight from phpMyAdmin (optional).
- **Automatic low-stock request**: whenever a medicine's usable stock is 1 unit or less (after adding, editing, billing, or when the dashboard loads), a request for 10 units goes automatically to the nearest PHC pharma (same city / closest pincode) that has enough spare stock. Only one open request per medicine; if the supplier rejects it, the next nearest pharma is asked. If nobody has spare stock, the toast says so.
- **District-wise indents**: every account (PHC Pharma and District Main PHC) picks a Tamil Nadu **district** at sign up. There is exactly **one District Main PHC account per district**. A PHC Pharma's indent is routed by the server to the District Main PHC of *its own district only* (a PHC pharma in Erode can only indent to the Erode District Main PHC; it cannot choose or reach any other district). A District Main PHC can only act on indents from pharmacies of its own district. When it approves, the issued stock goes automatically into the requesting PHC pharma's inventory.
- **Indent** (pharmacy sidebar): a Tamil Nadu PHC style drug indent form (institution, block, district, indent period, drug code, name, unit, stock in hand, average monthly consumption, quantity required, remarks, signature blocks). The pharmacy picks a wholesaler; it appears under that wholesaler's **Orders -> Indents**, where the wholesaler sets the quantity issued per item and approves or rejects. Indents can be printed.
  **Approving an indent updates the PHC pharma's inventory automatically**: when the District Main PHC approves, it enters the quantity issued, **batch number** and **expiry date** for each item (batch and expiry are required for every item with a quantity above 0, and the expiry must not be in the past). In the same database transaction each issued item is added to the requesting PHC pharma's inventory with its name, batch number, quantity and expiry date (an existing identical batch is topped up; otherwise a new batch row is created, keeping the pharma's existing price for that medicine, else the District Main PHC's catalogue price, else 0). Rejecting an indent changes nothing. Pharma-to-pharma requests also move stock batch by batch (earliest expiry first) and the receiver gets the same batch number and expiry date. Stock orders placed with a District Main PHC (Network page) carry no batch details.

- **Naming**: in the UI the old *pharmacy* role is **PHC Pharma** and the old *wholesaler* role is **District Main PHC** (navbar, sign up, dashboards, indents). The database/API keep the internal role keys `pharmacy` / `wholesaler`, so no data migration is needed.
- **Billing POS** has three tabs: *New Bill*; *Sales Log* (every bill line as its own row - Bill ID, date, product, cost, quantity, amount - with an optional date filter); *Daily Summary* (one card per date with each product and the quantity sold that day; today is marked "in progress", earlier dates "Day closed"). The summary is computed from the stored bills, so each new date starts at midnight automatically (time zone `tz` in `backend/config.php`, default +05:30).

- **Nearby Pharmacy & Wholesaler Discovery Map**: interactive Leaflet + OpenStreetMap component located at the bottom of the PHC Pharma Dashboard (and accessible via the "Nearby Map" sidebar tab). Allows GPS location detection, Nominatim address search, distance calculation via OSRM road driving routes, live medicine stock verification, and direct medicine requests.

## Offline mode and plain-sentence alerts (Constraint-2: unreliable connectivity at a health centre)

**Stock entry works with no internet and is sent later.**
- *Inventory* (add a batch, change a quantity, remove a batch) and *Billing POS* (new bill) never wait for the network. Every change is saved on the device first (`localStorage`, see `src/offline.js`) and put in an outbox, in the order it happened.
- A bar at the top of every page shows what is happening in one sentence: offline, N entries waiting, sending, or refused. **See entries** lists each waiting entry in plain words; **Send now** sends immediately; refused entries can be removed or retried.
- When the connection returns (browser *online* event, a 20-second retry while entries wait, or **Send now**) the outbox is sent oldest first. Each entry carries a unique `client_id`; the server keeps it in the `sync_log` table, so an entry whose reply was lost on a weak connection is **never applied twice** (works for `stock_add`, `stock_update`, `bill_create`).
- An offline bill gets a temporary number (`OFF-001`); the server gives the real `INV-xxxx` number when it receives it, and the bill keeps the **time it was really made** (`sold_at`, accepted up to 31 days back) so the Daily Summary lands on the right day.
- If a batch is added offline and sold offline, the bill is linked to the real batch id as soon as the add is sent.
- The Dashboard opens with no internet too: low-stock and expiry alerts are worked out from the inventory kept on the device, and the request counts are marked *last known*.
- Pages that need other pharmacies (Network, Requests, Indent, Nearby Map) show *"This page needs the internet..."* and load by themselves when the connection is back.
- The app opens with no internet after it has been opened once online: it signs in with the last user and a service worker (`public/sw.js`) keeps the page on the device. The service worker runs in the **production build only** and needs `localhost` or https: `npm run build && npm run preview`.
- Signing out with entries still waiting asks for confirmation; the entries stay on the device and are sent after the next sign-in.

**Every alert is explained to the pharmacist in one plain sentence** (all wording is in `src/explain.js`, so it can be edited or translated in one place):
- Low stock / out of stock, expiring and expired batches: a *What it means* column on the Dashboard, and a sentence under the status tags on Inventory (for example *"Only 3 units of Paracetamol left, so it may run out soon and you should ask for more."*).
- Offline, waiting, sending and refused entries (the bar above), "not sent yet" rows in Inventory, and automatic restock notices (*"... is running low, so a request for more was sent to X automatically."*).
- Messages (toasts) are one sentence each and appear one under another; server error texts are turned into plain sentences (`plain()` in `src/explain.js`).
- Offline and a medicine drops to 1 unit or less: the pharmacist is told that the restock request will go to nearby PHC pharmas once the internet is back (the automatic request itself is sent by the server when the entry arrives).

## Scan QR: medicine tracking from manufacturing to expiry

A new **Scan QR** page (sidebar of both PHC Pharma and District Main PHC) follows one medicine **batch** (medicine name + batch number + expiry date) through its whole life.

- **Scan & Track**: scan the QR on a pack with the camera (or *Read QR from a photo*, or type a batch number / medicine name / the code printed under the QR). The page shows the batch card (medicine, batch, manufacturer, manufacturing and expiry date), an **expiry status banner** (within date / expires in N days / **expired - do not give to any patient**), totals (received at warehouse, issued to PHC pharmas, given to patients, in stock now), the **journey timeline**, and **where it is now** (which PHC pharmas hold units). The last scans are kept on the device.
- **Journey steps** are recorded automatically by the existing screens, nothing extra to type:
  `Manufactured` -> `Received at District Main PHC` -> `Issued to a PHC Pharma` (when the District Main PHC approves an indent) -> `Moved between PHC Pharmas` (when a pharma marks a pharma-to-pharma request *Received*) -> `In PHC Pharma inventory` (inventory add, or opening stock) -> `Given out to patients` (every bill; bills of one day at one pharmacy are shown as one step) -> `Expiry`.
- **QR Labels** tab: a QR for every batch in a PHC Pharma's inventory (starter and old stock included - the code is made the first time the tab is opened) or every batch a District Main PHC registered or issued. Print one label or a sheet of labels.
- **Register Batch** tab (District Main PHC only): where a journey starts. Enter medicine, batch number, manufacturer, manufacturing date, expiry date and quantity received; the manufacturer details are saved once and never overwritten. Use the same name + batch number + expiry date when approving an indent so the issued units join the same journey. Batches that were never registered show *"manufacturing details not recorded"* in the timeline.
- The QR contains a link `<your site>/?trace=<CODE>`, so a phone's normal camera app also opens the journey (after sign in).
- Tracking is written through `traceTry()` in `backend/api.php`, so a tracking problem can never block a stock change, a bill or an indent. Tables: `trace_batches`, `trace_events` (`backend/migration_trace.sql`; the API also creates them by itself on first login).
- Scanning needs the internet (the journey comes from the server). Camera access needs **https or localhost**. Chrome/Edge/Android use the built-in `BarcodeDetector`; other browsers (iPhone Safari, Firefox) use the `jsqr` package - run `npm install` once after pulling this change. QR codes are drawn by `src/qr.js` (no extra package).
- API: `trace_list`, `trace_lookup` (code), `trace_register` (District Main PHC only).

## API
Single file `backend/api.php`, POST JSON to `/api/<action>`. Actions: me, signup, login, logout, contact, dashboard, stock_*, bill_create, sales_log, sales_daily, network, nearby_suppliers (lat, lng, radius, product, qty, role_filter), medicines_search (q), user_update_location (lat, lng), request_create (with server-side stock verification), requests_list, request_update (status: Approved | Rejected | Dispatched | Received), wholesalers_list, indent_create, indents_list, indent_update (body: id, status, lines = {itemId: {qty, batch, expiry}}), catalogue_*, pharmacies_list.

- **District-only pharma network**: a PHC Pharma sees (Network page, Nearby Map, automatic low-stock requests) and can send stock requests only to PHC pharmas of **its own district**; the server rejects requests to other districts. A District Main PHC sees only indents and registered pharmas of its own district. Approving an indent adds the issued stock (name, batch, expiry, quantity) to the requesting PHC pharma's inventory automatically.
