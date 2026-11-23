// Minimal iCalendar (RFC 5545) reader: enough for Google / iCloud / Outlook
// calendar feeds. Expands recurring events (daily, weekly, monthly, yearly with
// INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, EXDATE, overridden instances) and
// converts time zones, returning the instances that overlap a time window.

function unfold(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line) {
  const colon = findValueColon(line);
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(";");
  const params = {};
  for (const p of paramParts) {
    const i = p.indexOf("=");
    if (i > 0) params[p.slice(0, i).toUpperCase()] = p.slice(i + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value };
}

// The value starts at the first colon that is not inside a quoted parameter.
function findValueColon(line) {
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === ":" && !q) return i;
  }
  return -1;
}

const unescapeText = (v) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

/* ---------- time zones ---------- */

function tzOffsetMs(utcMs, tz) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - utcMs;
}

function validTz(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock time in `tz` → UTC milliseconds. */
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!validTz(tz)) return guess;
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}

/** UTC ms → wall-clock components in `tz`. */
function utcToZoned(ms, tz) {
  const off = validTz(tz) ? tzOffsetMs(ms, tz) : 0;
  const d = new Date(ms + off);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

/** Parse a DATE or DATE-TIME property into { ms, allDay, tz, parts }. */
function parseDate(prop, fallbackTz) {
  const v = prop.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || prop.params.VALUE === "DATE") {
    return { allDay: true, parts: { y: +y, mo: +mo, d: +d, h: 0, mi: 0, s: 0 }, tz: null, ms: Date.UTC(+y, +mo - 1, +d) };
  }
  const tz = z ? "UTC" : prop.params.TZID || fallbackTz || "UTC";
  const parts = { y: +y, mo: +mo, d: +d, h: +h, mi: +mi, s: +s };
  return { allDay: false, parts, tz, ms: z ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) : zonedToUtc(+y, +mo, +d, +h, +mi, +s, tz) };
}

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+w || 0) * 7 * 86400 + (+d || 0) * 86400 + (+h || 0) * 3600 + (+mi || 0) * 60 + (+s || 0)) * 1000;
  return sign === "-" ? -ms : ms;
}

function parseRRule(v) {
  const r = {};
  for (const part of v.split(";")) {
    const [k, val] = part.split("=");
    if (k && val) r[k.toUpperCase()] = val;
  }
  return r;
}

/* ---------- calendar maths on plain dates (UTC midnight = the date) ---------- */

const DAY = 86400000;
const WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const dayNum = (y, mo, d) => Math.floor(Date.UTC(y, mo - 1, d) / DAY);
const fromDayNum = (n) => {
  const dt = new Date(n * DAY);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
};
const daysInMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

function matchesByDayInMonth(token, date) {
  const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token);
  if (!m) return false;
  const [, nth, wd] = m;
  if (WD[date.wd] !== wd) return false;
  if (!nth) return true;
  const n = +nth;
  if (n > 0) return Math.ceil(date.d / 7) === n;
  return Math.ceil((daysInMonth(date.y, date.mo) - date.d + 1) / 7) === -n;
}

/** Does `date` (a calendar day) belong to the recurrence that started on `start`? */
function dayMatches(rule, start, date, startDayN, dateDayN) {
  const interval = Math.max(1, +rule.INTERVAL || 1);
  const byDay = rule.BYDAY ? rule.BYDAY.split(",") : null;
  const byMonthDay = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(",").map(Number) : null;
  const byMonth = rule.BYMONTH ? rule.BYMONTH.split(",").map(Number) : null;
  if (byMonth && !byMonth.includes(date.mo)) return false;
  switch (rule.FREQ) {
    case "DAILY":
      if ((dateDayN - startDayN) % interval !== 0) return false;
      return !byDay || byDay.some((t) => t.replace(/^[+-]?\d+/, "") === WD[date.wd]);
    case "WEEKLY": {
      const wkst = WD.indexOf(rule.WKST || "MO");
      const weekOf = (n, wd) => n - ((wd - wkst + 7) % 7);
      const weeks = (weekOf(dateDayN, date.wd) - weekOf(startDayN, start.wd)) / 7;
      if (weeks % interval !== 0) return false;
      const days = byDay ? byDay.map((t) => t.replace(/^[+-]?\d+/, "")) : [WD[start.wd]];
      return days.includes(WD[date.wd]);
    }
    case "MONTHLY": {
      const months = (date.y - start.y) * 12 + (date.mo - start.mo);
      if (months % interval !== 0) return false;
      if (byMonthDay) return byMonthDay.some((n) => (n > 0 ? n === date.d : daysInMonth(date.y, date.mo) + n + 1 === date.d));
      if (byDay) return byDay.some((t) => matchesByDayInMonth(t, date));
      return date.d === start.d;
    }
    case "YEARLY": {
      if ((date.y - start.y) % interval !== 0) return false;
      if (byDay && byMonth) return byDay.some((t) => matchesByDayInMonth(t, date));
      if (byMonthDay) return (byMonth ? true : date.mo === start.mo) && byMonthDay.includes(date.d);
      return date.mo === start.mo && date.d === start.d;
    }
    default:
      return false;
  }
}

/* ---------- events ---------- */

function parseCalendar(text) {
  const lines = unfold(text);
  const events = [];
  let calTz = null;
  let cur = null;
  let depth = 0; // ignore nested components such as VALARM
  for (const raw of lines) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.name === "X-WR-TIMEZONE" && !cur) calTz = line.value.trim();
    if (line.name === "BEGIN") {
      if (line.value === "VEVENT") cur = { props: {}, exdates: [] };
      else if (cur) depth++;
      continue;
    }
    if (line.name === "END") {
      if (line.value === "VEVENT" && cur) {
        events.push(cur);
        cur = null;
      } else if (cur && depth > 0) depth--;
      continue;
    }
    if (!cur || depth > 0) continue;
    if (line.name === "EXDATE") cur.exdates.push(line);
    else if (!cur.props[line.name]) cur.props[line.name] = line;
  }
  return { events, calTz };
}

function expand(text, fromMs, toMs) {
  const { events, calTz } = parseCalendar(text);
  const overrides = new Map(); // uid|recurrenceStartMs → event
  const out = [];

  const toInstance = (ev, startMs, endMs, allDay, startParts) => ({
    id: `${(ev.props.UID || {}).value || ""}|${startMs}`,
    title: ev.props.SUMMARY ? unescapeText(ev.props.SUMMARY.value) : "(No title)",
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    allDay,
    date: allDay ? `${startParts.y}-${String(startParts.mo).padStart(2, "0")}-${String(startParts.d).padStart(2, "0")}` : undefined,
    location: ev.props.LOCATION ? unescapeText(ev.props.LOCATION.value) : undefined,
    url: findLink(ev),
    status: ev.props.STATUS ? ev.props.STATUS.value : undefined,
  });

  for (const ev of events) {
    if (ev.props["RECURRENCE-ID"]) {
      const rid = parseDate(ev.props["RECURRENCE-ID"], calTz);
      if (rid) overrides.set(`${(ev.props.UID || {}).value}|${rid.ms}`, ev);
    }
  }

  for (const ev of events) {
    if (!ev.props.DTSTART) continue;
    const start = parseDate(ev.props.DTSTART, calTz);
    if (!start) continue;
    const endProp = ev.props.DTEND ? parseDate(ev.props.DTEND, calTz) : null;
    const durationMs = endProp ? endProp.ms - start.ms : ev.props.DURATION ? parseDuration(ev.props.DURATION.value) : start.allDay ? DAY : 0;
    const uid = (ev.props.UID || {}).value;

    // A modified single instance of a recurring series.
    if (ev.props["RECURRENCE-ID"]) {
      if (ev.props.STATUS && ev.props.STATUS.value === "CANCELLED") continue;
      const endMs = start.ms + durationMs;
      if (start.ms < toMs && (endMs > fromMs || (durationMs === 0 && start.ms >= fromMs))) out.push(toInstance(ev, start.ms, endMs, start.allDay, start.parts));
      continue;
    }
    if (ev.props.STATUS && ev.props.STATUS.value === "CANCELLED") continue;

    if (!ev.props.RRULE) {
      const endMs = start.ms + durationMs;
      if (start.ms < toMs && (endMs > fromMs || (durationMs === 0 && start.ms >= fromMs))) out.push(toInstance(ev, start.ms, endMs, start.allDay, start.parts));
      continue;
    }

    const rule = parseRRule(ev.props.RRULE.value);
    const until = rule.UNTIL ? parseDate({ value: rule.UNTIL, params: {} }, start.tz || "UTC") : null;
    const count = rule.COUNT ? +rule.COUNT : Infinity;
    const exdates = new Set();
    for (const ex of ev.exdates) for (const v of ex.value.split(",")) {
      const d = parseDate({ value: v, params: ex.params }, start.tz || calTz);
      if (d) exdates.add(start.allDay ? Date.UTC(d.parts.y, d.parts.mo - 1, d.parts.d) : d.ms);
    }
    const tz = start.tz;
    const sp = start.parts;
    const startDayN = dayNum(sp.y, sp.mo, sp.d);
    const startDate = fromDayNum(startDayN);
    // Last calendar day worth checking, in the event's own time zone.
    const lastZoned = utcToZoned(toMs, tz || "UTC");
    const lastDayN = dayNum(lastZoned.y, lastZoned.mo, lastZoned.d) + 1;
    let seen = 0;
    for (let n = startDayN; n <= lastDayN && seen < count; n++) {
      const date = fromDayNum(n);
      if (!dayMatches(rule, startDate, date, startDayN, n)) continue;
      const occMs = start.allDay ? Date.UTC(date.y, date.mo - 1, date.d) : zonedToUtc(date.y, date.mo, date.d, sp.h, sp.mi, sp.s, tz);
      if (occMs < start.ms) continue;
      if (until && occMs > until.ms + (until.allDay ? DAY - 1 : 0)) break;
      seen++;
      if (exdates.has(occMs)) continue;
      if (overrides.has(`${uid}|${occMs}`)) continue; // the override is emitted separately
      const endMs = occMs + durationMs;
      if (occMs < toMs && (endMs > fromMs || (durationMs === 0 && occMs >= fromMs))) out.push(toInstance(ev, occMs, endMs, start.allDay, { y: date.y, mo: date.mo, d: date.d }));
    }
  }
  out.sort((a, b) => a.start.localeCompare(b.start));
  return out;
}

/** Meeting link: URL property, or a Zoom/Meet/Teams link in location/description. */
function findLink(ev) {
  if (ev.props.URL) return ev.props.URL.value.trim();
  const hay = [ev.props.LOCATION, ev.props.DESCRIPTION, ev.props["X-GOOGLE-CONFERENCE"]].filter(Boolean).map((p) => unescapeText(p.value)).join(" ");
  const m = /(https:\/\/(?:[\w-]+\.)?(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|whereby\.com|calendly\.com)\/[^\s<>"')]+)/i.exec(hay);
  return m ? m[1] : undefined;
}

module.exports = { expand, zonedToUtc };
