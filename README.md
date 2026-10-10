# ChemiConnect

B2B platform for pharmacies and wholesalers. Stack: React (Vite) + PHP 7.4+ (PDO) + MySQL/MariaDB.

## Setup

1. **Database** - start MySQL (XAMPP / WAMP / any MySQL) and import the schema:

       mysql -u root -p < backend/schema.sql

   (or phpMyAdmin -> Import -> `backend/schema.sql`). This creates the `chemiconnect` database and tables.
   If your MySQL user/password is not `root` / empty, edit `backend/config.php`.

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
- **Requests**: the receiving pharmacy approves/rejects. Approving moves the units from its inventory to the requester (checked in a DB transaction).
- **Wholesaler**: catalogue, inbound orders (approve/reject), registered pharmacies.
- Billing POS is still available in the pharmacy sidebar and reduces stock when an invoice is generated.

## API
Single file `backend/api.php`, POST JSON to `/api/<action>`. Actions: me, signup, login, logout, contact, dashboard, stock_*, bill_create, network, request_create, requests_list, request_update, catalogue_*, pharmacies_list.
