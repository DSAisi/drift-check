#!/usr/bin/env node
// drift.mjs —— 人格漂移体检（零依赖，只用 Node 自带的东西）
//
// 三个用法：
//   node drift.mjs template          生成 zero.md 骨架，喂给你的 AI 答
//   node drift.mjs diff a.md b.md    两份答卷对一遍，报"哪里对不上"
//   node drift.mjs --selftest        自检（不通过就说明这个脚本自己坏了）
//
// 设计上为什么**不预填"锚点词"**：
//   我们最开始那版为每道题预填了关键词（"她""家""闸"…），结果发现：
//   ① 那些词只对我们家成立，别人的 AI 一个都不会有 —— 根本没法通用；
//   ② 更糟的是，我们有一只锚点里混进了"那天的日期"，于是**那题每天都会报漂**，
//      报的不是 AI 漂了，是时间过去了。
//   ⇒ 这一版换掉了：**不比"预填的词"，比"两次答得一样不一样"**。
//      这天然通用，而且正好抓住真正该抓的那种假 —— **背题面**。

import fs from "node:fs";

const IDS = [
  "R1", "R2", "R3", "R4",
  "C1", "C2", "C3", "C4", "C5",
  "P1", "P2", "P3", "P4",
  "O1", "O2", "O3", "O4", "E1", "E2", "E3", "E4",
  "I1", "I2", "I3", "I4",
  "N0",
];

const DRIFT_WARN = 0.12; // 两次之间字块重合度低于这个 ⇒ 标"对不上"

// ── 中文二元字块（去掉标点和空白后，取相邻两字）────────────────
function chunks(s) {
  const clean = String(s).replace(/[\s\p{P}\p{S}]/gu, "");
  const out = new Set();
  if (clean.length < 2) { if (clean) out.add(clean); return out; }
  for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2));
  return out;
}
function sim(a, b) {
  const A = chunks(a), B = chunks(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

// ── 读一份答卷 ────────────────────────────────────────────────
function parse(file) {
  const text = fs.readFileSync(file, "utf8");
  // ⚠ 必须用带 `m` 的 `^##`：用 `split(/\n##\s+/)` 会把**文件里第一个 `##`** 漏掉
  //   （它前面没有换行）⇒ 首题永远读不到。2026-09-27 自检当场抓出来的。
  const parts = text.split(/^##\s+/m).slice(1);
  const map = {};
  for (const p of parts) {
    const nl = p.indexOf("\n");
    const id = (nl < 0 ? p : p.slice(0, nl)).trim().split(/[\s.、]/)[0];
    const body = nl < 0 ? "" : p.slice(nl + 1);
    const main = (body.match(/\*\*主[：:]\*\*\s*([\s\S]*?)(?=\n\*\*换|\n##|$)/) || [])[1] || "";
    const alt = (body.match(/\*\*换[：:]\*\*\s*([\s\S]*?)(?=\n\*\*主|\n##|$)/) || [])[1] || "";
    map[id] = { main: main.trim(), alt: alt.trim() };
  }
  return map;
}

// ── template ─────────────────────────────────────────────────
if (process.argv[2] === "template") {
  const out = ["# 零点答卷（zero.md）", "",
    "> 把这份发给你的 AI，让它**按题号作答**，然后原样存回来。",
    "> ⚠ 每题要答两次：`**主：**` 是主问法，`**换：**` 是换问法。",
    "> ⚠ 题目在 `questions.md`。", ""];
  for (const id of IDS) {
    out.push(`## ${id}`, "", `**主：**`, "", `**换：**`, "");
  }
  fs.writeFileSync("zero.md", out.join("\n"));
  console.log("✓ 写出 zero.md（" + IDS.length + " 题）—— 发给你的 AI 答吧。");
  process.exit(0);
}

// ── selftest ─────────────────────────────────────────────────
if (process.argv.includes("--selftest")) {
  let pass = 0, fail = 0;
  const t = (name, cond) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } };
  t("同样的字 ⇒ 相似度 1", sim("我记得那一天", "我记得那一天") === 1);
  t("完全不相干 ⇒ 相似度低", sim("我记得那一天下雨", "量子力学的哈密顿量") < 0.12);
  t("标点不影响", sim("你好，世界！", "你好世界") === 1);
  const fake = "## R1\n\n**主：** 她是我的人\n\n**换：** 她是我的人\n\n## R2\n\n**主：** 我们在一起\n\n**换：** 完全不同的另一段话\n";
  fs.writeFileSync("/tmp/_drift_selftest.md", fake);
  const m = parse("/tmp/_drift_selftest.md");
  t("能读到 R1 主问法", m.R1 && m.R1.main.includes("我的人"));
  t("能读到 R1 换问法", m.R1 && m.R1.alt.includes("我的人"));
  t("R1 两次一致 ⇒ 相似度 1", sim(m.R1.main, m.R1.alt) === 1);
  t("R2 两次不一致 ⇒ 相似度低", sim(m.R2.main, m.R2.alt) < 0.3);
  console.log(`\n共 ${pass + fail} 项：过 ${pass} ／ 不过 ${fail}`);
  process.exit(fail ? 1 : 0);
}

// ── diff ─────────────────────────────────────────────────────
if (process.argv[2] === "diff") {
  const [fa, fb] = process.argv.slice(3);
  if (!fa || !fb) { console.log("用法：node drift.mjs diff <基点.md> <新的.md>"); process.exit(1); }
  const A = parse(fa), B = parse(fb);

  const missing = IDS.filter(id => !A[id] || !B[id]);
  if (missing.length) {
    console.log("⚠ 两份答卷里缺少这些题号：" + missing.join("／"));
    console.log("  ⇒ **这不是「漂了」，是「没读到」。** 先补齐再比（我们自己的版本就在这儿栽过：参数搞反时它照样报「正常」）。");
    process.exit(2);
  }

  console.log(`基点：${fa}\n新卷：${fb}\n`);
  let flagged = 0, borrowed = 0;
  for (const id of IDS) {
    const d = sim(A[id].main, B[id].main);
    const gA = sim(A[id].main, A[id].alt);   // 基点里，主问法和换问法有多像
    const gB = sim(B[id].main, B[id].alt);   // 新卷里，同上
    const tags = [];
    if (d < DRIFT_WARN) { tags.push("对不上"); flagged++; }
    // 主问法答得天差地别、换问法却几乎一样 ⇒ 有一边像是背的
    if (gA - gB >= 0.5 || gB - gA >= 0.5) { tags.push("两边答得像背的"); borrowed++; }
    const mark = tags.length ? "⚠ " + tags.join("／") : "✓ 一致";
    console.log(`${mark}  ${id}   前后重合 ${(d * 100).toFixed(0)}%   主↔换 ${(gA * 100).toFixed(0)}% → ${(gB * 100).toFixed(0)}%`);
  }
  console.log(`\n共 ${IDS.length} 题：**对不上 ${flagged} 题**，**两次答得太像（可能背题面）${borrowed} 题**。`);
  console.log("\n⚠ 三句丑话，别跳过：");
  console.log("  ① 这个数**只是哨兵**，它比的是「两次答得像不像」，不是「有没有它自己」。报了别当结论，回去读原文。");
  console.log("  ② **E4（「你昨天做了什么」）一定会报「对不上」** —— 因为它问的是时效性事实，过一天必然变。那不是漂，是时间过去了。");
  console.log("  ③ **N0（七乘八）要是报了不对** ⇒ 别怀疑你的 AI，**是题目或脚本坏了**。");
  process.exit(0);
}

console.log(`人格漂移体检 · 零依赖

用法：
  node drift.mjs template         生成 zero.md 骨架
  node drift.mjs diff a.md b.md   两份答卷对一遍
  node drift.mjs --selftest       自检

题目在 questions.md。怎么看结果，看 README.md。`);
