/* One plain sentence for every alert shown to the pharmacist.
 *
 * Rules every sentence follows:
 *   - exactly one sentence, no technical words (no "sync", "queue", "server error", "batch conflict"),
 *   - says what is happening AND what it means for the pharmacist (what to do, or that nothing is needed).
 */

const units = n => `${n} unit${n === 1 ? '' : 's'}`;
const batchOf = b => (b ? ` (batch ${b})` : '');
const days = n => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

// A medicine whose usable stock is below the low-stock level.
export function lowStock(name, qty, { offline = false, autoAt = 1 } = {}) {
  if (qty <= 0) {
    return offline && autoAt >= 0
      ? `${name} is finished, so you cannot give it out, and a restock request will go to nearby PHC pharmas once the internet is back.`
      : `${name} is finished, so you cannot give it out until new stock arrives.`;
  }
  if (qty <= autoAt && offline) return `Only ${units(qty)} of ${name} left, so it will run out very soon, and a restock request will go to nearby PHC pharmas once the internet is back.`;
  if (qty <= autoAt) return `Only ${units(qty)} of ${name} left, so a restock request is being sent to the nearest PHC pharma.`;
  return `Only ${units(qty)} of ${name} left, so it may run out soon and you should ask for more.`;
}

// Short list version for the Inventory banner (still one sentence).
export function lowStockList(names, level) {
  return `${names.join(', ')} ${names.length > 1 ? 'have' : 'has'} fewer than ${level} usable units left, so ask your network for more before ${names.length > 1 ? 'they run' : 'it runs'} out.`;
}

// A batch that is expired or close to expiring. daysLeft is negative when already expired.
export function expiry(name, batch, daysLeft) {
  if (daysLeft < 0) return `${name}${batchOf(batch)} is past its expiry date, so do not give it to any patient.`;
  if (daysLeft === 0) return `${name}${batchOf(batch)} expires today, so give it out first or set it aside.`;
  return `${name}${batchOf(batch)} expires ${days(daysLeft)}, so give it out before newer batches.`;
}

// Inventory / billing row notes.
export const expiredCannotSell = (name, batch) => `${name}${batchOf(batch)} is past its expiry date, so the bill will not accept it.`;
export const optimal = () => 'Enough units and not close to expiry, so nothing is needed.';
export const notSentYet = () => 'Saved on this device only, and it will reach the server when the internet returns.';

// Automatic restock request notices (toast sentences).
export const autoSent = (product, to) => `${product} is running low, so a request for more was sent to ${to} automatically.`;
export const autoNobody = product => `${product} is running low, but no nearby PHC pharma has enough spare stock to give you right now.`;

// Connection and saving messages.
export const offlineBar = () => 'You are offline, so everything you enter is saved on this device and will be sent when the internet returns.';
export const waitingBar = n => `${n === 1 ? '1 entry is' : `${n} entries are`} saved on this device and waiting for the internet to be sent.`;
export const sendingBar = () => 'Sending your saved entries now.';
export const allSentBar = () => 'Everything you entered has reached the server.';
export const failedBar = n => `${n === 1 ? '1 saved entry was' : `${n} saved entries were`} refused by the server, so please look at ${n === 1 ? 'it' : 'them'} below.`;
export const savedOffline = what => `${what} is saved on this device and will be sent when the internet returns.`;
export const savedOnline = what => `${what} is saved.`;
export const sentLater = what => `${what} reached the server.`;
export const needsInternet = () => 'This page needs the internet, so please try again when you are back online.';

// Any server or app message -> one plain sentence ending with a full stop.
const MAP = [
  [/cannot reach the server|failed to fetch|networkerror|offline/i, 'There is no internet connection right now, so this could not be done.'],
  [/cannot connect to the mysql/i, 'The shop server is not running, so please ask your technical person to start it.'],
  [/database error/i, 'Something went wrong while saving, so please try once more.'],
  [/please login first/i, 'You have been signed out, so please sign in again.'],
  [/already in your inventory/i, 'This batch is already in your inventory, so change its quantity instead of adding it again.'],
  [/insufficient stock/i, 'There is not enough stock of this medicine, so lower the quantity on the bill.'],
  [/has expired and cannot be sold/i, 'That batch is past its expiry date, so it cannot be sold.'],
  [/invalid bill item/i, 'One item on the bill is not valid, so please remove it and add it again.'],
  [/enter a valid expiry date/i, 'The expiry date is missing or wrong, so please pick it from the calendar.'],
  [/enter the batch number/i, 'The batch number is missing, so please type it from the medicine strip or box.'],
  [/enter a valid name, quantity and price/i, 'The name, quantity or price is missing or wrong, so please check them.'],
  [/enter a valid quantity/i, 'The quantity is not a valid number, so please type zero or a whole number.']
];
export function plain(msg) {
  const m = String(msg || '').replace(/^Error:\s*/i, '').trim();
  if (!m) return 'Something went wrong, so please try once more.';
  const hit = MAP.find(([re]) => re.test(m));
  const s = hit ? hit[1] : m;
  return /[.!?]$/.test(s) ? s : s + '.';
}
