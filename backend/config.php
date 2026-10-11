<?php
// MySQL connection settings. Defaults match a fresh XAMPP/WAMP install (user root, no password).
// You can also override them with environment variables DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS.
$env = fn($k, $d) => getenv($k) !== false ? getenv($k) : $d;

return [
    'host' => $env('DB_HOST', '127.0.0.1'),
    'port' => $env('DB_PORT', '3306'),
    'name' => $env('DB_NAME', 'chemiconnect'),
    'user' => $env('DB_USER', 'root'),
    'pass' => $env('DB_PASS', ''),
    // Time zone used for "which day was this bill on" (daily sales summary). +05:30 = India. Override with DB_TZ.
    'tz'   => $env('DB_TZ', '+05:30'),
];
