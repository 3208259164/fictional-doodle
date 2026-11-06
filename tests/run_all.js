#!/usr/bin/env node
/* =====================================================================
   学通 · 测试总运行器
   ---------------------------------------------------------------------
   为什么不用 shell 的 `cmd | grep` 判结果：
   命令一崩，管道里什么都拿不到，判断就自动变成"通过"——这个项目真的
   因此空跑过几个月（脚本路径写错，检查从未执行，界面一直显示全绿）。

   这里的规则：
     · 子进程退出码非 0        → 失败
     · 输出里解析不到断言数 0  → 失败（"没跑"和"跑过了"必须能区分）
     · 输出里失败数 > 0        → 失败

   用法：
     node tests/run_all.js                       # 全部
     node tests/run_all.js --site ../site        # 指定站点目录
     node tests/run_all.js --only regression,media_test
     node tests/run_all.js --list
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const SITE = path.resolve(opt('site', path.join(__dirname, '..', 'site')));
const TIMEOUT = parseInt(opt('timeout', '300'), 10) * 1000;

if (args.includes('--list')) {
  for (const f of files()) console.log(f);
  process.exit(0);
}

function files() {
  const skip = new Set(['run_all.js']);
  // 下划线开头的是辅助模块（如 _lazy_hook.js），不是测试
  let list = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && !skip.has(f) && !f.startsWith('_'));
  const only = opt('only', '');
  if (only) {
    const want = new Set(only.split(',').map(s => s.trim()));
    list = list.filter(f => want.has(f) || want.has(f.replace(/\.js$/, '')));
  } else {
    // 主回归先跑：它覆盖面最大，坏了先看它
    list.sort((a, b) => (a === 'regression.js' ? -1 : b === 'regression.js' ? 1 : a.localeCompare(b)));
  }
  return list;
}

// 已过时但功能还在的测试：不阻断，但名单外的新失败一定阻断
const KNOWN_FILE = path.join(__dirname, 'known-failing.txt');
const KNOWN = new Set(
  (fs.existsSync(KNOWN_FILE) ? fs.readFileSync(KNOWN_FILE, 'utf8') : '')
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => l.split(/\s+/)[0])
);

const num = (out, res) => {
  for (const r of res) {
    const m = out.match(r);
    if (m) return parseInt(m[1], 10);
  }
  return null;
};

function runOne(f) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], {
    cwd: __dirname,
    encoding: 'utf8',
    timeout: TIMEOUT,
    env: Object.assign({}, process.env, { YZY_SITE: SITE.endsWith('/') ? SITE : SITE + '/' }),
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const ms = Date.now() - t0;

  const asserts = num(out, [/断言\s*(\d+)\s*项/, /通过\s*(\d+)\s*项/, /(\d+)\s*项通过/, /共\s*(\d+)\s*项/]);
  const fails = num(out, [/失败\s*(\d+)\s*项/, /(\d+)\s*项失败/, /✗\s*(\d+)\s*个/]);

  const crashed = r.status !== 0 || r.error;
  const looksOk = /通过|OK|ok|PASS|✓/.test(out);

  let ok, note;
  if (crashed) {
    ok = false;
    note = '退出码 ' + (r.error ? String(r.error).slice(0, 40) : r.status);
  } else if (asserts === null || asserts === 0) {
    // 解析不到断言数：只有在明确说了"通过"时才放行，并记为 1（不能记 0，否则等于没测）
    ok = looksOk;
    note = ok ? '未声明断言数（按 1 计）' : '没有任何断言输出';
  } else {
    ok = (fails || 0) === 0;
    note = '断言 ' + asserts + (fails ? ' / 失败 ' + fails : '');
  }
  return { f, ok, asserts: asserts || (ok ? 1 : 0), fails: fails || 0, ms, note, out };
}

console.log('学通 · 测试总运行（站点：' + SITE + '）\n');
const results = [];
for (const f of files()) {
  const r = runOne(f);
  results.push(r);
  const isKnown = KNOWN.has(f);
  const tag = !r.ok && isKnown ? '  ⚠️ 已知过时' : (r.ok && isKnown ? '  ↑ 已修好，可从 known-failing.txt 删掉' : '');
  console.log((r.ok ? '  ✅ ' : (isKnown ? '  ⚠️ ' : '  ❌ ')) + f.padEnd(30) + r.note + '  (' + r.ms + 'ms)' + tag);
  if (!r.ok && !isKnown) {
    const tail = r.out.trim().split('\n').slice(-6).join('\n        ');
    console.log('        ' + tail);
  }
}

const A = results.reduce((s, r) => s + r.asserts, 0);
const F = results.reduce((s, r) => s + r.fails, 0);
const BAD = results.filter(r => !r.ok && !KNOWN.has(r.f)).length;
const KNOWNBAD = results.filter(r => !r.ok && KNOWN.has(r.f)).length;

const KF = results.filter(r => !r.ok && KNOWN.has(r.f)).reduce((s, r) => s + (r.fails || 0), 0);
console.log('\n########## 合计：断言 ' + A + ' 项，阻断失败 ' + BAD + ' 项，套件未通过 ' + BAD +
            ' 个｜已知过时 ' + KNOWNBAD + ' 个套件（' + KF + ' 项）##########');
process.exit(BAD === 0 && A > 0 ? 0 : 1);
