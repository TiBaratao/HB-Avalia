const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getDueDate,
  localDateParts,
  scheduledForDay,
} = require("../scheduled-checklists-core");

test("scheduled checklist dates use the configured Sao Paulo timezone", () => {
  const parts = localDateParts(new Date("2025-03-10T02:00:00.000Z"));
  assert.equal(parts.year, "2025");
  assert.equal(parts.month, "03");
  assert.equal(parts.day, "09");
  assert.equal(parts.weekday, "Sun");
});

test("daily, weekly, and monthly schedules preserve their configured recurrence", () => {
  const parts = { year: "2025", month: "02", day: "28", weekday: "Fri" };
  assert.equal(scheduledForDay({ frequency: "DAILY" }, parts), true);
  assert.equal(scheduledForDay({ frequency: "WEEKLY", publishWeekday: 5 }, parts), true);
  assert.equal(scheduledForDay({ frequency: "WEEKLY", publishWeekday: 4 }, parts), false);
  assert.equal(scheduledForDay({ frequency: "MONTHLY", publishDayOfMonth: 31 }, parts), true);
});

test("scheduled checklist due dates preserve the existing weekly and monthly rules", () => {
  const friday = { year: "2025", month: "02", day: "28", weekday: "Fri" };
  assert.equal(getDueDate("DAILY", friday), "2025-02-28");
  assert.equal(getDueDate("WEEKLY", friday), "2025-03-02");
  assert.equal(getDueDate("MONTHLY", friday), "2025-02-28");
});
