#!/usr/bin/env node
/* 学通 · 地名数据校验（data/places.js）
   目的：地名条目的 events[] 是从站内事件自动聚合来的。事件一旦改名或删除，
   这条关联就静默失效（点进去找不到事件）。这个脚本把这类「悄悄断掉」报出来。
   检查项：
     1. 结构：id / name / type / brief 非空，lat/lng 为数字
     2. id 唯一
     3. type 在允许集合内
     4. events[] 的每个名字都能在事件库（knowledge.js + events-extra.js）里找到
     5. 至少有一半地名带关联事件（太少说明聚合规则坏了）
   用法：node site/tools/check_places.js [站点目录] */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const TYPES = ['城市', '根据地', '战役地', '村', '镇', '县', '地区', '国际'];

function load(file, ctx) {
  const p = path.join(SITE, file);
  if (!fs.existsSync(p)) return false;
  try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: file }); return true; } catch (e) { return false; }
}

const sandbox = { window: {}, console: { log() {}, info() {}, warn() {}, error() {} } };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
// 事件库由三个文件拼起来：knowledge.js 先建 SITE_EXTRA.events，
// graph-extra.js 与 events-extra.js 往里补（顺序不能反，否则前者找不到 SITE_EXTRA）。
// 只加载 knowledge.js 会得到 102 条，把 369 条扩容批和 181 条图谱相关事件全漏掉，
// 结果是满屏「关联事件已找不到」的假提醒。
load('data/knowledge.js', sandbox);
load('data/graph-extra.js', sandbox);
load('data/events-extra.js', sandbox);
load('data/places.js', sandbox);

const W = sandbox.window;
const places = W.SITE_PLACES || [];
const evSet = new Set();
((W.SITE_EVENTS_EXTRA) || []).forEach(e => e && e.name && evSet.add(e.name));
((W.SITE_EXTRA && W.SITE_EXTRA.events) || []).forEach(e => e && e.name && evSet.add(e.name));

const errs = [], warns = [];
if (!places.length) errs.push('data/places.js 未加载到任何条目（SITE_PLACES 为空）');

const ids = new Set();
places.forEach((p, i) => {
  const tag = p && p.id ? p.id : ('#' + i);
  if (!p || !p.id) errs.push(tag + '：缺 id');
  if (!p || !p.name) errs.push(tag + '：缺 name');
  if (!p || !p.brief) errs.push(tag + '：缺 brief');
  if (!p || TYPES.indexOf(p.type) < 0) errs.push(tag + '：type 不在允许集合（' + (p && p.type) + '）');
  if (p && (typeof p.lat !== 'number' || typeof p.lng !== 'number')) errs.push(tag + '：lat/lng 不是数字');
  if (p && p.id) { if (ids.has(p.id)) errs.push(tag + '：id 重复'); ids.add(p.id); }
  ((p && p.events) || []).forEach(nm => { if (!evSet.has(nm)) warns.push(tag + '：关联事件「' + nm + '」在事件库里已找不到'); });
});

const withEv = places.filter(p => (p.events || []).length).length;
if (places.length && !evSet.size) errs.push('事件库为空，无法校验关联（knowledge.js / events-extra.js 解析失败）');
if (places.length && withEv * 2 < places.length) errs.push('带关联事件的地名不足一半（' + withEv + '/' + places.length + '），聚合可能失效');

const total = places.reduce((n, p) => n + (p.events || []).length, 0);
console.log('地名校验：' + places.length + ' 条｜带事件 ' + withEv + ' 条｜关联总数 ' + total + '｜事件库 ' + evSet.size + ' 条');
warns.slice(0, 10).forEach(w => console.log('  ⚠️  ' + w));
if (warns.length > 10) console.log('  ⚠️  …另有 ' + (warns.length - 10) + ' 条同类提醒');
errs.slice(0, 15).forEach(e => console.log('  ❌  ' + e));
if (errs.length) { console.log('地名校验未通过：' + errs.length + ' 项'); process.exit(1); }
console.log('地名校验通过' + (warns.length ? '（' + warns.length + ' 条提醒）' : ''));
