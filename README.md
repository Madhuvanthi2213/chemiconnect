# ChemiConnect

B2B platform for pharmacies and wholesalers. Stack: React (Vite) + PHP 7.4+ (PDO) + MySQL/MariaDB.

## Setup

1. **Database** - start MySQL (XAMPP / WAMP / any MySQL) and import the schema:

       mysql -u root -p < backend/schema.sql

   (or phpMyAdmin -> Import -> `backend/schema.sql`). This creates the `chemiconnect` database and tables.
   If your MySQL user/password is not `root` / empty, edit `backend/config.php`.

   **Already imported an older schema?** Run the upgrades once, in order (keeps your data):

       mysql -u root -p chemiconnect < backend/migration.sql     # full address + Received flow (skip if already run)
       mysql -u root -p chemiconnect < backend/migration_2.sql   # Dispatched step + Indent tables

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
- **Wholesaler**: catalogue, inbound orders (approve/reject), registered pharmacies.
- Billing POS is still available in the pharmacy sidebar and reduces stock when an invoice is generated.

- **Indent** (pharmacy sidebar): a Tamil Nadu PHC style drug indent form (institution, block, district, indent period, drug code, name, unit, stock in hand, average monthly consumption, quantity required, remarks, signature blocks). The pharmacy picks a wholesaler; it appears under that wholesaler's **Orders -> Indents**, where the wholesaler sets the quantity issued per item and approves or rejects. Indents can be printed. Indents do not change inventory counts.

## API
Single file `backend/api.php`, POST JSON to `/api/<action>`. Actions: me, signup, login, logout, contact, dashboard, stock_*, bill_create, network, request_create, requests_list, request_update (status: Approved | Rejected | Dispatched | Received), wholesalers_list, indent_create, indents_list, indent_update, catalogue_*, pharmacies_list.
