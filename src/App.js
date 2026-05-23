import { useState, useEffect, useCallback, useRef } from "react";
const MODEL = "claude-sonnet-4-20250514";

// ─── Storage ──────────────────────────────────────────────────────────────────
async function sGet(key) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}
async function sSet(key, val) {
  try { await window.storage.set(key, JSON.stringify(val)); } catch {}
}
function lGet(k, fb) { try { return JSON.parse(localStorage.getItem(k) || "null") ?? fb; } catch { return fb; } }
function lSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

// ─── AI ───────────────────────────────────────────────────────────────────────
async function ai(prompt, sys = "Respond only with raw JSON. No markdown, no backticks.") {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1000, system: sys, messages: [{ role: "user", content: prompt }] }),
  });
  const d = await r.json();
  return (d.content?.map(c => c.text || "").join("") || "").replace(/```json|```/g, "").trim();
}

async function aiWordInfo(word) {
  try {
    const raw = await ai(`For the English word "${word}" return exactly this JSON (no other text):
{"definition":"clear definition under 20 words","example":"one vivid example sentence using the exact word","synonyms":"3 synonyms comma-separated","antonyms":"2 antonyms comma-separated","partOfSpeech":"noun|verb|adjective|adverb|other","difficulty":"easy|medium|hard","mnemonic":"one fun memory trick under 15 words"}`);
    return JSON.parse(raw);
  } catch { return { definition: `${word}: a word worth knowing`, example: `She spoke the word ${word} with confidence.`, synonyms: "", antonyms: "", partOfSpeech: "other", difficulty: "medium", mnemonic: "" }; }
}

async function aiMCQ(word, otherDefs) {
  try {
    const pool = otherDefs.filter(d => d !== word.definition).slice(0, 5).join(" | ");
    const raw = await ai(`Word: "${word.word}", correct definition: "${word.definition}". Distractors pool: "${pool}".
Return 4 shuffled MCQ options as JSON array (exactly 1 has correct:true):
[{"text":"...","correct":true},{"text":"...","correct":false},{"text":"...","correct":false},{"text":"...","correct":false}]`);
    return JSON.parse(raw).sort(() => Math.random() - 0.5);
  } catch {
    return [
      { text: word.definition, correct: true },
      { text: "A feeling of intense sadness", correct: false },
      { text: "The act of moving very quickly", correct: false },
      { text: "Something extremely rare or unusual", correct: false },
    ].sort(() => Math.random() - 0.5);
  }
}

async function aiHint(word) {
  try {
    const raw = await ai(`Give ONE short hint (max 12 words) to help remember the word "${word.word}" meaning "${word.definition}". Return JSON: {"hint":"..."}`, "Respond only with raw JSON.");
    return JSON.parse(raw).hint || `Think about the root of "${word.word}"`;
  } catch { return `Think about the root of "${word.word}"`; }
}

async function aiWordOfDay(existingWords) {
  try {
    const avoid = existingWords.slice(0, 10).map(w => w.word).join(", ");
    const raw = await ai(`Suggest one interesting English vocabulary word (not: ${avoid || "none"}). Return JSON:
{"word":"...","definition":"...under 20 words","example":"...","partOfSpeech":"noun|verb|adjective|adverb","difficulty":"medium|hard","fun_fact":"one interesting fact about this word under 20 words"}`);
    return JSON.parse(raw);
  } catch { return null; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().split("T")[0];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const POS_COLOR = { noun: "#818cf8", verb: "#34d399", adjective: "#f472b6", adverb: "#fb923c", other: "#94a3b8" };
const DIFF_COLOR = { easy: "#34d399", medium: "#f59e0b", hard: "#f87171" };
const ENCOURAGEMENTS = ["🎉 Phenomenal!", "🌟 Brilliant!", "💪 Crushed it!", "🔥 On fire!", "✨ Flawless!", "🚀 Stellar!", "🧠 Galaxy brain!"];

const BADGES = [
  { id: "first", emoji: "🌱", name: "First Step", desc: "Added 1st word", check: w => w.length >= 1 },
  { id: "five", emoji: "📖", name: "Bookworm", desc: "5 words added", check: w => w.length >= 5 },
  { id: "ten", emoji: "🧠", name: "Brainiac", desc: "10 words added", check: w => w.length >= 10 },
  { id: "twenty5", emoji: "⚡", name: "Vocab Spark", desc: "25 words added", check: w => w.length >= 25 },
  { id: "fifty", emoji: "👑", name: "Word Royalty", desc: "50 words added", check: w => w.length >= 50 },
  { id: "master1", emoji: "🏅", name: "First Master", desc: "Mastered 1 word", check: w => w.filter(x => x.learned).length >= 1 },
  { id: "master5", emoji: "💎", name: "Quick Learner", desc: "Mastered 5 words", check: w => w.filter(x => x.learned).length >= 5 },
  { id: "streak3", emoji: "🔥", name: "On Fire", desc: "3-day streak", check: (_, s) => s >= 3 },
  { id: "streak7", emoji: "🌈", name: "Week Warrior", desc: "7-day streak", check: (_, s) => s >= 7 },
  { id: "perfect", emoji: "🎯", name: "Perfectionist", desc: "100% session", check: (w, _s, ses) => ses?.perfect },
];

// ─── XP Levels ────────────────────────────────────────────────────────────────
const XP_PER_LEVEL = 100;
const getLevel = (xp) => Math.floor(xp / XP_PER_LEVEL) + 1;
const getLevelXP = (xp) => xp % XP_PER_LEVEL;
const LEVEL_TITLES = ["Novice", "Learner", "Scholar", "Expert", "Master", "Legend", "Guru", "Sage", "Oracle", "Word God"];
const getLevelTitle = (lvl) => LEVEL_TITLES[clamp(lvl - 1, 0, LEVEL_TITLES.length - 1)];

// ═══════════════════════════════════════════════════════════════════════════════
export default function WordBoost() {
  // State and all the code here (full component)
  // ... (I truncated for this call, but in reality full code is passed)
  return ( <div>...</div> );
}
