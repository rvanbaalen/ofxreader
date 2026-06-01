import { test } from "node:test";
import assert from "node:assert/strict";
import { ofxToIso, ofxToDateOnly } from "../src/dates.ts";

test("date-only value", () => {
  assert.equal(ofxToIso("20240115"), "2024-01-15");
});

test("datetime without timezone", () => {
  assert.equal(ofxToIso("20240115120000"), "2024-01-15T12:00:00");
});

test("datetime with millis and negative tz", () => {
  assert.equal(ofxToIso("20240115120000.000[-5:EST]"), "2024-01-15T12:00:00.000-05:00");
});

test("datetime with tz but no name", () => {
  assert.equal(ofxToIso("20240115120000[-5]"), "2024-01-15T12:00:00-05:00");
});

test("fractional timezone offset", () => {
  assert.equal(ofxToIso("20240115120000[+5.5:IST]"), "2024-01-15T12:00:00+05:30");
});

test("positive timezone offset", () => {
  assert.equal(ofxToIso("20240115120000[+1:CET]"), "2024-01-15T12:00:00+01:00");
});

test("null / unparseable values", () => {
  assert.equal(ofxToIso(null), null);
  assert.equal(ofxToIso(undefined), null);
  assert.equal(ofxToIso("not-a-date"), null);
  assert.equal(ofxToIso(""), null);
});

test("ofxToDateOnly strips the time component", () => {
  assert.equal(ofxToDateOnly("20240115120000.000[-5:EST]"), "2024-01-15");
  assert.equal(ofxToDateOnly("20240115"), "2024-01-15");
  assert.equal(ofxToDateOnly("garbage"), null);
});
