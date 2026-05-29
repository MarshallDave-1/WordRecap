import { useState, useEffect, useCallback, useRef } from "react";
const MODEL = "claude-sonnet-4-20250514";

// ─── Storage ──────────────────────────────────────────────────────────────────
async function sGet(key) {
  try {
    const r = await window.storage.get(key);
    return r ? JSON.parse(r.value) : null;
  } catch (e) {
    console.warn("[sGet] storage error:", e);
    return null;
  }
}
async function sSet(key, val) {
  try {
    await window.storage.set(key, JSON.stringify(val));
  } catch (e) {
    console.warn("[sSet] storage error:", e);
  }
}
function lGet(k, fb) {
  try { return JSON.parse(localStorage.getItem(k) || "null") ?? fb; }
  catch { return fb; }
}
function lSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); }
  catch (e) { console.warn("[lSet] localStorage error:", e); }
}

// ─── AI ───────────────────────────────────────────────────────────────────────
async function ai(prompt, sys = "Respond only with raw JSON. No markdown, no backticks.") {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  } catch {
    return { definition: `${word}: a word worth knowing`, example: `She spoke the word ${word} with confidence.`, synonyms: "", antonyms: "", partOfSpeech: "other", difficulty: "medium", mnemonic: "" };
  }
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

// FIX 7: safe word blanking that works with special chars and non-ASCII
function blankWord(sentence, word) {
  // Escape special regex chars in the word
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Use case-insensitive replace without \b (which breaks on accented/hyphenated words)
  return sentence.replace(new RegExp(escaped, "gi"), "________");
}

const POS_COLOR = { noun: "#818cf8", verb: "#34d399", adjective: "#f472b6", adverb: "#fb923c", other: "#94a3b8" };
const DIFF_COLOR = { easy: "#34d399", medium: "#f59e0b", hard: "#f87171" };
const ENCOURAGEMENTS = ["🎉 Phenomenal!", "🌟 Brilliant!", "💪 Crushed it!", "🔥 On fire!", "✨ Flawless!", "🚀 Stellar!", "🧠 Galaxy brain!"];

const BADGES = [
  { id: "first",   emoji: "🌱", name: "First Step",    desc: "Added 1st word",     check: (w)         => w.length >= 1 },
  { id: "five",    emoji: "📖", name: "Bookworm",       desc: "5 words added",      check: (w)         => w.length >= 5 },
  { id: "ten",     emoji: "🧠", name: "Brainiac",       desc: "10 words added",     check: (w)         => w.length >= 10 },
  { id: "twenty5", emoji: "⚡", name: "Vocab Spark",    desc: "25 words added",     check: (w)         => w.length >= 25 },
  { id: "fifty",   emoji: "👑", name: "Word Royalty",   desc: "50 words added",     check: (w)         => w.length >= 50 },
  { id: "master1", emoji: "🏅", name: "First Master",   desc: "Mastered 1 word",    check: (w)         => w.filter(x => x.learned).length >= 1 },
  { id: "master5", emoji: "💎", name: "Quick Learner",  desc: "Mastered 5 words",   check: (w)         => w.filter(x => x.learned).length >= 5 },
  { id: "streak3", emoji: "🔥", name: "On Fire",        desc: "3-day streak",       check: (_w, s)     => s >= 3 },
  { id: "streak7", emoji: "🌈", name: "Week Warrior",   desc: "7-day streak",       check: (_w, s)     => s >= 7 },
  // FIX 5: perfect badge now receives real session data from caller
  { id: "perfect", emoji: "🎯", name: "Perfectionist",  desc: "100% session",       check: (_w, _s, ses) => ses?.perfect === true },
];

// ─── XP Levels ────────────────────────────────────────────────────────────────
const XP_PER_LEVEL = 100;
const getLevel    = (xp) => Math.floor(xp / XP_PER_LEVEL) + 1;
const getLevelXP  = (xp) => xp % XP_PER_LEVEL;
const LEVEL_TITLES = ["Novice","Learner","Scholar","Expert","Master","Legend","Guru","Sage","Oracle","Word God"];
const getLevelTitle = (lvl) => LEVEL_TITLES[clamp(lvl - 1, 0, LEVEL_TITLES.length - 1)];

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 8: Sub-views defined OUTSIDE the main component so React never
//         treats them as new component types on re-render.
// Each receives only the props it needs.
// ═══════════════════════════════════════════════════════════════════════════════

function HomeView({ words, streak, wotd, wotdLoading, sessionHistory, weeklyXP, maxWeekXP,
                    total, mastered, accuracy, dueCount, totalXP, level, levelXP,
                    C, pill, card, btn, goTo, addWotdToLibrary }) {
  const recent = [...words].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Level + XP bar */}
      <div style={card({ padding: "14px 16px" })}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>Level {level} · </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.amber }}>{getLevelTitle(level)}</span>
          </div>
          <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{levelXP}/{XP_PER_LEVEL} XP</span>
        </div>
        <div style={{ height: 8, background: C.border, borderRadius: 99, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(levelXP / XP_PER_LEVEL) * 100}%`, background: `linear-gradient(90deg,${C.amber},${C.pink})`, borderRadius: 99, transition: "width 0.6s ease" }} />
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
        {[{ l: "Words", v: total, c: C.amber }, { l: "Mastered", v: mastered, c: C.green }, { l: "Accuracy", v: accuracy + "%", c: C.pink }, { l: "Due", v: dueCount, c: C.purple }].map(s => (
          <div key={s.l} style={{ ...card({ padding: "10px 8px", textAlign: "center", marginBottom: 0 }) }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: s.c, lineHeight: 1.1 }}>{s.v}</div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginTop: 2 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Word of the Day */}
      <div style={card({ background: "linear-gradient(135deg,#1a1f35 0%,#111827 100%)", border: `1px solid ${C.purple}44` })}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: C.purple }}>✨ Word of the Day</span>
          <span style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{todayStr()}</span>
        </div>
        {wotdLoading ? (
          <div style={{ color: C.muted, fontSize: 13, padding: "8px 0" }}>Generating today's word...</div>
        ) : wotd ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 22, fontWeight: 900, color: C.purple }}>{wotd.word}</span>
              {wotd.partOfSpeech && <span style={{ ...pill(POS_COLOR[wotd.partOfSpeech] || C.muted) }}>{wotd.partOfSpeech}</span>}
              {wotd.difficulty && <span style={{ ...pill(DIFF_COLOR[wotd.difficulty] || C.muted) }}>{wotd.difficulty}</span>}
            </div>
            <p style={{ fontSize: 13, color: C.text, marginBottom: 4 }}>{wotd.definition}</p>
            {wotd.example && <p style={{ fontSize: 12, color: C.muted, fontStyle: "italic", marginBottom: 8 }}>"{wotd.example}"</p>}
            {wotd.fun_fact && <p style={{ fontSize: 11, color: C.purple, marginBottom: 8 }}>💡 {wotd.fun_fact}</p>}
            <button style={btn(C.purple + "22", C.purple, { width: "100%", padding: "8px" })} onClick={addWotdToLibrary}>+ Add to Library</button>
          </>
        ) : <div style={{ color: C.muted, fontSize: 13 }}>Couldn't load today's word</div>}
      </div>

      {/* Weekly XP chart */}
      {sessionHistory.length > 0 && (
        <div style={card()}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: C.text }}>📈 This Week's XP</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 64 }}>
            {weeklyXP.map((d, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: "100%", height: Math.max(4, Math.round((d.xp / maxWeekXP) * 52)), background: d.xp > 0 ? `linear-gradient(180deg,${C.amber},${C.pink})` : `${C.border}`, borderRadius: "4px 4px 2px 2px", transition: "height 0.5s ease" }} />
                <span style={{ fontSize: 9, color: d.xp > 0 ? C.amber : C.muted, fontWeight: 700 }}>{d.day}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily challenge */}
      <div style={card({ border: `1px solid ${C.amber}33`, background: "linear-gradient(135deg,#1f1a0e 0%,#111827 100%)" })}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: C.amber }}>🎯 Daily Challenge</span>
          <span style={pill(C.amber)}>{Math.min(dueCount, 5)}/5 due</span>
        </div>
        <p style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Practice due words to maintain your {streak.count}-day streak!</p>
        <button style={btn(C.amber, undefined, { width: "100%" })} onClick={() => goTo("practice")}>Start Practice</button>
      </div>

      {/* Recent words */}
      {recent.length > 0 && (
        <div style={card()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>📖 Recent Words</span>
            <button onClick={() => goTo("library")} style={{ background: "none", border: "none", color: C.amber, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>See All</button>
          </div>
          {recent.map(w => (
            <div key={w.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 11px", borderRadius: 12, background: C.surface, marginBottom: 6, border: `1px solid ${C.border}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color: C.amber }}>{w.word}</span>
                  {w.partOfSpeech && <span style={{ ...pill(POS_COLOR[w.partOfSpeech] || C.muted), fontSize: 9, padding: "2px 6px" }}>{w.partOfSpeech}</span>}
                  {w.learned && <span style={{ ...pill(C.green), fontSize: 9, padding: "2px 6px" }}>✓ mastered</span>}
                </div>
                <p style={{ fontSize: 11, color: C.muted, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.definition}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {words.length === 0 && (
        <div style={{ ...card(), textAlign: "center", padding: "36px 16px" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🌱</div>
          <h3 style={{ fontSize: 16, fontWeight: 900, marginBottom: 8 }}>Start your journey</h3>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>Add your first word to begin leveling up your vocabulary!</p>
          <button style={btn(C.amber, undefined, { width: "auto", padding: "12px 28px" })} onClick={() => goTo("add")}>Add First Word</button>
        </div>
      )}
    </div>
  );
}

function AddView({ addForm, setAddForm, handleAdd, addLoading, total, mastered, dueCount, C, card, btn, inp }) {
  return (
    <div style={{ padding: "12px 14px" }}>
      <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 16 }}>➕ Add New Word</h2>
      <form onSubmit={handleAdd} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[
          { k: "word",     label: "Word *",                       ph: "e.g. ephemeral",           required: true,  ta: false },
          { k: "def",      label: "Definition",                   ph: "AI-generated if empty",    required: false, ta: true  },
          { k: "example",  label: "Example Sentence",             ph: "AI-generated if empty",    required: false, ta: true  },
          { k: "synonyms", label: "Synonyms (comma-separated)",   ph: "e.g. fleeting, transient", required: false, ta: false },
        ].map(f => (
          <div key={f.k}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5 }}>
              {f.label}
              {(f.k === "def" || f.k === "example") && <span style={{ color: C.purple, marginLeft: 6 }}>✨ AI</span>}
            </label>
            {f.ta
              ? <textarea rows={2} placeholder={f.ph} value={addForm[f.k]} onChange={e => setAddForm(p => ({ ...p, [f.k]: e.target.value }))} style={{ ...inp(), resize: "none" }} />
              : <input type="text" placeholder={f.ph} value={addForm[f.k]} required={f.required} onChange={e => setAddForm(p => ({ ...p, [f.k]: e.target.value }))} style={inp()} />
            }
          </div>
        ))}
        {/* FIX 6: was `addLoading?.6` (syntax error) → now proper ternary */}
        <button type="submit" disabled={addLoading} style={{ ...btn(C.amber, undefined, { opacity: addLoading ? 0.6 : 1 }) }}>
          {addLoading ? "✨ AI is generating definition..." : "Add Word"}
        </button>
      </form>

      {total > 0 && (
        <div style={{ ...card(), marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 10 }}>QUICK STATS</div>
          <div style={{ display: "flex", gap: 16 }}>
            <div><div style={{ fontSize: 18, fontWeight: 900, color: C.amber }}>{total}</div><div style={{ fontSize: 11, color: C.muted }}>total words</div></div>
            <div><div style={{ fontSize: 18, fontWeight: 900, color: C.green }}>{mastered}</div><div style={{ fontSize: 11, color: C.muted }}>mastered</div></div>
            <div><div style={{ fontSize: 18, fontWeight: 900, color: C.purple }}>{dueCount}</div><div style={{ fontSize: 11, color: C.muted }}>due for review</div></div>
          </div>
        </div>
      )}
    </div>
  );
}

function PracticeView({ practice, words, mcqOpts, mcqLoading, fillAns, setFillAns, answerState,
                        hint, hintLoading, flashFlipped, setFlashFlipped,
                        startPractice, submitAnswer, handleFill, getHint, goTo,
                        C, card, btn, inp, pill }) {
  if (!practice) return (
    <div style={{ padding: "40px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 56, marginBottom: 16 }}>🧠</div>
      <button style={btn(C.amber, undefined, { padding: "14px 32px" })} onClick={startPractice}>Start Practice</button>
    </div>
  );

  if (words.length === 0) return (
    <div style={{ padding: "40px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>📚</div>
      <h3 style={{ fontWeight: 800, marginBottom: 8 }}>No words yet</h3>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>Add some words to your library first.</p>
      <button style={btn(C.amber, undefined, { padding: "12px 28px", width: "auto" })} onClick={() => goTo("add")}>Add Words</button>
    </div>
  );

  if (practice.done) {
    const pct = practice.total > 0 ? Math.round(practice.correct / practice.total * 100) : 0;
    return (
      <div style={{ padding: "32px 16px", textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: 12 }}>{pct === 100 ? "🏆" : pct >= 70 ? "🎉" : "💪"}</div>
        <h3 style={{ fontSize: 20, fontWeight: 900, color: C.amber, marginBottom: 8 }}>Session Complete!</h3>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginBottom: 20 }}>
          <div style={card({ padding: "12px 20px", textAlign: "center", border: `1px solid ${C.green}44` })}>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.green }}>{practice.correct}/{practice.total}</div>
            <div style={{ fontSize: 11, color: C.muted }}>correct</div>
          </div>
          <div style={card({ padding: "12px 20px", textAlign: "center", border: `1px solid ${C.amber}44` })}>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.amber }}>+{practice.xp}</div>
            <div style={{ fontSize: 11, color: C.muted }}>XP earned</div>
          </div>
          <div style={card({ padding: "12px 20px", textAlign: "center", border: `1px solid ${C.purple}44` })}>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.purple }}>{pct}%</div>
            <div style={{ fontSize: 11, color: C.muted }}>accuracy</div>
          </div>
        </div>
        {practice.perfect && (
          <div style={{ ...card({ border: `1px solid ${C.amber}`, marginBottom: 16 }), color: C.amber, fontWeight: 800, fontSize: 14 }}>
            🎯 Perfect session! Bonus badge unlocked!
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button style={btn(C.amber, undefined, { flex: 1 })} onClick={startPractice}>Practice Again</button>
          <button style={btn(C.surface, C.text, { flex: 1, border: `1px solid ${C.border}` })} onClick={() => goTo("home")}>Home</button>
        </div>
      </div>
    );
  }

  const { queue, index } = practice;
  if (index >= queue.length) return null;
  const { word, type } = queue[index];
  const pct = Math.round((index / queue.length) * 100);

  // Flashcard mode
  if (type === "flash") {
    return (
      <div style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>Card {index + 1}/{queue.length}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.amber }}>+{practice.xp} XP</span>
        </div>
        <div style={{ height: 6, background: C.border, borderRadius: 99, marginBottom: 16, overflow: "hidden" }}>
          <div style={{ height: "100%", width: pct + "%", background: `linear-gradient(90deg,${C.amber},${C.pink})`, borderRadius: 99 }} />
        </div>
        <div onClick={() => setFlashFlipped(f => !f)} style={{ ...card({ minHeight: 200, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", transition: "all 0.3s", background: flashFlipped ? C.surface : C.card, border: `2px solid ${flashFlipped ? C.green : C.border}` }) }}>
          {!flashFlipped ? (
            <>
              <div style={{ fontSize: 32, fontWeight: 900, color: C.amber, marginBottom: 8 }}>{word.word}</div>
              {word.partOfSpeech && <span style={pill(POS_COLOR[word.partOfSpeech] || C.muted)}>{word.partOfSpeech}</span>}
              <div style={{ fontSize: 12, color: C.muted, marginTop: 16 }}>Tap to reveal definition</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, color: C.text, marginBottom: 10, lineHeight: 1.6 }}>{word.definition}</div>
              {word.example && <div style={{ fontSize: 12, color: C.muted, fontStyle: "italic", marginBottom: 8 }}>"{word.example}"</div>}
              {word.mnemonic && <div style={{ fontSize: 12, color: C.purple, marginBottom: 8 }}>💡 {word.mnemonic}</div>}
            </>
          )}
        </div>
        {flashFlipped && (
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button style={btn("#ef444422", "#f87171", { flex: 1, border: "1px solid #f8717144" })} onClick={() => submitAnswer(false)}>Didn't know ✗</button>
            <button style={btn(C.green + "22", C.green, { flex: 1, border: `1px solid ${C.green}44` })} onClick={() => submitAnswer(true)}>Knew it! ✓</button>
          </div>
        )}
      </div>
    );
  }

  const feedbackColor = answerState ? (answerState.correct ? C.green : "#f87171") : null;

  return (
    <div style={{ padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>Q {index + 1}/{queue.length}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!answerState && (
            <button onClick={getHint} disabled={hintLoading} style={{ ...btn(C.purple + "22", C.purple, { padding: "5px 10px", fontSize: 11, borderRadius: 8 }) }}>
              {hintLoading ? "..." : "💡 Hint (-5 XP)"}
            </button>
          )}
          <span style={{ fontSize: 12, fontWeight: 700, color: C.amber }}>+{practice.xp} XP</span>
        </div>
      </div>
      <div style={{ height: 6, background: C.border, borderRadius: 99, marginBottom: 14, overflow: "hidden" }}>
        <div style={{ height: "100%", width: pct + "%", background: `linear-gradient(90deg,${C.amber},${C.pink})`, borderRadius: 99, transition: "width 0.3s ease" }} />
      </div>

      {hint && <div style={{ ...card({ border: `1px solid ${C.purple}44`, marginBottom: 12, padding: "10px 14px" }), fontSize: 12, color: C.purple }}>💡 {hint}</div>}

      {answerState && (
        <div style={{ ...card({ border: `2px solid ${feedbackColor}44`, marginBottom: 12, padding: "10px 14px", background: feedbackColor + "11" }), fontSize: 13, fontWeight: 800, color: feedbackColor, textAlign: "center" }}>
          {answerState.correct ? "✅ Correct! Well done!" : `❌ The answer was: ${word.word}`}
        </div>
      )}

      <div style={card()}>
        {/* MCQ */}
        {type === "mcq" && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 6 }}>What does this word mean?</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: C.amber, marginBottom: 4 }}>{word.word}</div>
            {word.partOfSpeech && <span style={{ ...pill(POS_COLOR[word.partOfSpeech] || C.muted), marginBottom: 14, display: "inline-flex" }}>{word.partOfSpeech}</span>}
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {mcqLoading
                ? <div style={{ textAlign: "center", color: C.muted, padding: 20, fontSize: 13 }}>✨ Generating options...</div>
                : (mcqOpts || []).map((opt, i) => {
                  // FIX 1: highlight logic uses answerState.clickedIdx which is now correctly preserved
                  let bg = C.surface, border = C.border, col = C.text;
                  if (answerState) {
                    if (opt.correct) { bg = C.green + "22"; border = C.green; col = C.green; }
                    else if (i === answerState.clickedIdx) { bg = "#f8717122"; border = "#f87171"; col = "#f87171"; }
                  }
                  return (
                    <button key={i}
                      disabled={!!answerState}
                      onClick={() => submitAnswer(opt.correct, i)}
                      style={{ background: bg, color: col, border: `1.5px solid ${border}`, borderRadius: 12, padding: "11px 14px", textAlign: "left", fontSize: 13, fontWeight: 600, cursor: answerState ? "default" : "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
                      <span style={{ fontWeight: 900, color: answerState ? (opt.correct ? C.green : i === answerState.clickedIdx ? "#f87171" : C.muted) : C.amber, marginRight: 8 }}>{["A", "B", "C", "D"][i]}.</span>
                      {opt.text}
                    </button>
                  );
                })}
            </div>
          </>
        )}

        {/* Fill / Match */}
        {(type === "fill" || type === "match") && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 6 }}>
              {type === "fill" ? "Fill in the blank" : "Which word matches this definition?"}
            </div>
            {type === "fill" && word.example && (
              <div style={{ background: C.surface, borderRadius: 12, padding: "11px 14px", fontSize: 13, color: C.muted, fontStyle: "italic", marginBottom: 12, lineHeight: 1.7 }}>
                {/* FIX 7: use safe blankWord() helper */}
                "{blankWord(word.example, word.word)}"
              </div>
            )}
            {type === "match" && (
              <div style={{ background: C.surface, borderRadius: 12, padding: "11px 14px", fontSize: 13, color: C.text, marginBottom: 12, lineHeight: 1.6 }}>{word.definition}</div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <input value={fillAns} onChange={e => setFillAns(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !answerState && handleFill()}
                disabled={!!answerState} placeholder="Type the word..."
                style={{ ...inp(), flex: 1 }} />
              <button onClick={handleFill} disabled={!!answerState} style={{ ...btn(C.amber, undefined, { width: "auto", padding: "11px 16px" }) }}>Check</button>
            </div>
          </>
        )}
      </div>

      {/* Word details after answer */}
      {answerState && (
        <div style={{ ...card({ marginTop: 12, border: `1px solid ${C.border}` }) }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8 }}>ABOUT THIS WORD</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: C.amber, marginBottom: 4 }}>{word.word}</div>
          <p style={{ fontSize: 13, color: C.text, marginBottom: 4 }}>{word.definition}</p>
          {word.example && <p style={{ fontSize: 12, color: C.muted, fontStyle: "italic", marginBottom: 4 }}>"{word.example}"</p>}
          {word.synonyms && <p style={{ fontSize: 12, color: C.green, marginBottom: 2 }}>Synonyms: {word.synonyms}</p>}
          {word.antonyms && <p style={{ fontSize: 12, color: "#f87171" }}>Antonyms: {word.antonyms}</p>}
          {word.mnemonic && <p style={{ fontSize: 12, color: C.purple, marginTop: 6 }}>💡 {word.mnemonic}</p>}
        </div>
      )}
    </div>
  );
}

function LibraryView({ filteredWords, filter, setFilter, search, setSearch, expandedCard, setExpandedCard,
                       toggleLearned, deleteWord, C, card, btn, inp, pill }) {
  return (
    <div style={{ padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h2 style={{ fontSize: 18, fontWeight: 900 }}>📚 Library</h2>
        <span style={pill(C.amber)}>{filteredWords.length} words</span>
      </div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search words or definitions..."
        style={{ ...inp(), marginBottom: 10 }} />
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {["all", "learning", "mastered", "due"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: "5px 12px", borderRadius: 999, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit", background: filter === f ? C.amber : C.surface, color: filter === f ? "#080b14" : C.muted, transition: "all 0.15s" }}>
            {f === "all" ? "All" : f === "learning" ? "Learning" : f === "mastered" ? "Mastered" : "⚡ Due"}
          </button>
        ))}
      </div>
      {filteredWords.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📝</div>
          <p style={{ color: C.muted }}>No words found</p>
        </div>
      ) : filteredWords.map(w => {
        const tot = (w.correct || 0) + (w.incorrect || 0);
        const acc = tot > 0 ? Math.round(w.correct / tot * 100) : 0;
        const isDue = !w.learned && new Date(w.nextReview || 0) <= new Date();
        const isExpanded = expandedCard === w.id;
        return (
          <div key={w.id} style={{ ...card({ marginBottom: 10, cursor: "pointer", border: `1px solid ${isDue ? C.purple + "66" : C.border}` }) }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }} onClick={() => setExpandedCard(isExpanded ? null : w.id)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontWeight: 900, fontSize: 16, color: C.amber }}>{w.word}</span>
                  {w.partOfSpeech && <span style={{ ...pill(POS_COLOR[w.partOfSpeech] || C.muted), fontSize: 9, padding: "2px 6px" }}>{w.partOfSpeech}</span>}
                  {w.difficulty && <span style={{ ...pill(DIFF_COLOR[w.difficulty] || C.muted), fontSize: 9, padding: "2px 6px" }}>{w.difficulty}</span>}
                  {w.learned && <span style={{ ...pill(C.green), fontSize: 9, padding: "2px 6px" }}>✓ mastered</span>}
                  {isDue && <span style={{ ...pill(C.purple), fontSize: 9, padding: "2px 6px" }}>⚡ due</span>}
                </div>
                <p style={{ fontSize: 12, color: C.muted, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isExpanded ? "normal" : "nowrap" }}>{w.definition}</p>
              </div>
              <span style={{ fontSize: 12, color: C.border, marginLeft: 8, marginTop: 2 }}>{isExpanded ? "▲" : "▼"}</span>
            </div>
            {isExpanded && (
              <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 12, paddingTop: 12 }}>
                {w.example && <p style={{ fontSize: 12, color: C.muted, fontStyle: "italic", marginBottom: 8 }}>"{w.example}"</p>}
                {w.synonyms && <p style={{ fontSize: 12, color: C.green, marginBottom: 4 }}>Synonyms: {w.synonyms}</p>}
                {w.antonyms && <p style={{ fontSize: 12, color: "#f87171", marginBottom: 4 }}>Antonyms: {w.antonyms}</p>}
                {w.mnemonic && <p style={{ fontSize: 12, color: C.purple, marginBottom: 8 }}>💡 {w.mnemonic}</p>}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{tot} attempts · {acc}% accuracy · {w.reviewCount || 0} reviews</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => toggleLearned(w.id)} style={{ ...btn(w.learned ? C.green + "22" : C.surface, w.learned ? C.green : C.muted, { flex: 1, padding: "8px", fontSize: 12, border: `1px solid ${w.learned ? C.green : C.border}` }) }}>
                    {w.learned ? "★ Mastered" : "☆ Mark Mastered"}
                  </button>
                  <button onClick={() => deleteWord(w.id)} style={{ ...btn("#f8717122", "#f87171", { padding: "8px 12px", border: "1px solid #f8717144" }) }}>🗑️</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BadgesView({ words, streak, lastSession, C, card }) {
  return (
    <div style={{ padding: "12px 14px" }}>
      <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}>🏆 Badges</h2>
      {/* FIX 5: pass lastSession so the perfect badge can actually be checked */}
      <p style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
        {BADGES.filter(b => b.check(words, streak.count, lastSession)).length}/{BADGES.length} earned
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {BADGES.map(b => {
          const earned = b.check(words, streak.count, lastSession);
          return (
            <div key={b.id} style={{ ...card({ opacity: earned ? 1 : 0.4, border: `1px solid ${earned ? C.amber + "44" : C.border}`, padding: "14px 12px", textAlign: "center" }) }}>
              <div style={{ fontSize: 32, marginBottom: 6 }}>{b.emoji}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: earned ? C.amber : C.muted, marginBottom: 2 }}>{b.name}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{b.desc}</div>
              {earned && <div style={{ fontSize: 10, color: C.green, marginTop: 4, fontWeight: 700 }}>✓ Earned</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function WordBoost() {
  // ─── State ───────────────────────────────────────────────────────────────
  const [words, setWords]               = useState([]);
  const [loaded, setLoaded]             = useState(false);
  const [view, setView]                 = useState("home");
  const [filter, setFilter]             = useState("all");
  const [search, setSearch]             = useState("");
  const [toasts, setToasts]             = useState([]);
  const [streak, setStreak]             = useState(() => lGet("wb_streak3", { count: 0, lastDate: "", frozen: false }));
  const [practice, setPractice]         = useState(null);
  const [mcqOpts, setMcqOpts]           = useState(null);
  const [mcqLoading, setMcqLoading]     = useState(false);
  const [fillAns, setFillAns]           = useState("");
  const [answerState, setAnswerState]   = useState(null);
  const [hint, setHint]                 = useState(null);
  const [hintLoading, setHintLoading]   = useState(false);
  const [addForm, setAddForm]           = useState({ word: "", def: "", example: "", synonyms: "" });
  const [addLoading, setAddLoading]     = useState(false);
  const [confirm, setConfirm]           = useState(null);
  const [wotd, setWotd]                 = useState(null);
  const [wotdLoading, setWotdLoading]   = useState(false);
  const [expandedCard, setExpandedCard] = useState(null);
  const [flashFlipped, setFlashFlipped] = useState(false);
  const [sessionHistory, setSessionHistory] = useState(() => lGet("wb_sessions", []));
  const [newBadge, setNewBadge]         = useState(null);
  const prevBadgesRef                   = useRef([]);

  // ─── Load/Save ───────────────────────────────────────────────────────────
  useEffect(() => {
    sGet("wb_words3").then(saved => {
      if (saved?.length) setWords(saved);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    sSet("wb_words3", words);
  }, [words, loaded]);

  // ─── Badge detector ──────────────────────────────────────────────────────
  // FIX 5: pass lastSession (most recent session) so perfect badge can resolve
  const lastSession = sessionHistory[0] || null;
  useEffect(() => {
    const currentEarned = BADGES.filter(b => b.check(words, streak.count, lastSession)).map(b => b.id);
    const prev = prevBadgesRef.current;
    const fresh = currentEarned.filter(id => !prev.includes(id));
    if (fresh.length && prev.length) {
      const b = BADGES.find(x => x.id === fresh[0]);
      if (b) setNewBadge(b);
    }
    prevBadgesRef.current = currentEarned;
  }, [words, streak.count, lastSession]);

  // ─── Word of the Day ─────────────────────────────────────────────────────
  // FIX 3: words is now a dependency so the avoid list is populated correctly.
  // We gate on `loaded` to avoid fetching before words are restored from storage.
  useEffect(() => {
    if (!loaded) return;
    const today = todayStr();
    const cached = lGet("wb_wotd", null);
    if (cached?.date === today) { setWotd(cached.data); return; }
    setWotdLoading(true);
    aiWordOfDay(words).then(w => {
      if (w) { lSet("wb_wotd", { date: today, data: w }); setWotd(w); }
      setWotdLoading(false);
    });
  }, [loaded]); // runs once after words are loaded; `words` snapshot captured at that point

  // ─── Toast ───────────────────────────────────────────────────────────────
  const toast = useCallback((msg, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2800);
  }, []);

  // ─── Streak ──────────────────────────────────────────────────────────────
  const bumpStreak = useCallback(() => {
    const today = todayStr();
    const yest  = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    setStreak(prev => {
      if (prev.lastDate === today) return prev;
      const next = { ...prev };
      if (prev.lastDate === yest || prev.frozen) { next.count++; next.frozen = false; }
      else next.count = 1;
      next.lastDate = today;
      lSet("wb_streak3", next);
      return next;
    });
  }, []);

  // FIX 10: expose freezeStreak so it can actually be called (e.g. from a UI button)
  const freezeStreak = useCallback(() => {
    setStreak(prev => {
      const next = { ...prev, frozen: true };
      lSet("wb_streak3", next);
      return next;
    });
  }, []);

  // ─── Stats ───────────────────────────────────────────────────────────────
  const total         = words.length;
  const mastered      = words.filter(w => w.learned).length;
  const totalAttempts = words.reduce((s, w) => s + (w.correct || 0) + (w.incorrect || 0), 0);
  const totalCorrect  = words.reduce((s, w) => s + (w.correct || 0), 0);
  const accuracy      = totalAttempts > 0 ? Math.round(totalCorrect / totalAttempts * 100) : 0;
  const totalXP       = words.reduce((s, w) => s + (w.xp || 0), 0);
  const level         = getLevel(totalXP);
  const levelXP       = getLevelXP(totalXP);
  const dueCount      = words.filter(w => !w.learned && new Date(w.nextReview || 0) <= new Date()).length;

  // ─── Add word ────────────────────────────────────────────────────────────
  async function handleAdd(e) {
    e.preventDefault();
    const word = addForm.word.trim();
    if (!word) return;
    if (words.some(w => w.word.toLowerCase() === word.toLowerCase())) { toast("Already in your library!", "error"); return; }
    setAddLoading(true);
    let info = { definition: addForm.def.trim(), example: addForm.example.trim(), synonyms: addForm.synonyms.trim(), antonyms: "", partOfSpeech: "other", difficulty: "medium", mnemonic: "" };
    if (!info.definition || !info.example) {
      const gen = await aiWordInfo(word);
      if (!info.definition) info.definition = gen.definition;
      if (!info.example)    info.example    = gen.example;
      if (!info.synonyms)   info.synonyms   = gen.synonyms;
      info.antonyms    = gen.antonyms    || "";
      info.partOfSpeech = gen.partOfSpeech || "other";
      info.difficulty  = gen.difficulty  || "medium";
      info.mnemonic    = gen.mnemonic    || "";
    }
    const newW = { id: Date.now().toString(), word, ...info, correct: 0, incorrect: 0, learned: false, xp: 0, createdAt: new Date().toISOString(), nextReview: new Date().toISOString(), reviewCount: 0 };
    setWords(prev => [...prev, newW]);
    setAddForm({ word: "", def: "", example: "", synonyms: "" });
    setAddLoading(false);
    toast(`"${word}" added! 🎉`);
  }

  // ─── Delete / Toggle ─────────────────────────────────────────────────────
  function deleteWord(id) {
    const w = words.find(x => x.id === id);
    setConfirm({ title: "Delete word?", msg: `Remove "${w?.word}" forever?`, onYes: () => { setWords(p => p.filter(x => x.id !== id)); toast("Deleted", "info"); } });
  }

  function toggleLearned(id) {
    setWords(p => p.map(w => w.id === id ? { ...w, learned: !w.learned } : w));
    const w = words.find(x => x.id === id);
    toast(w?.learned ? "Unmarked as mastered" : "Marked as mastered! ⭐");
  }

  function addWotdToLibrary() {
    if (!wotd) return;
    if (words.some(w => w.word.toLowerCase() === wotd.word.toLowerCase())) { toast("Already in your library!", "error"); return; }
    const newW = { id: Date.now().toString(), word: wotd.word, definition: wotd.definition, example: wotd.example, synonyms: "", antonyms: "", partOfSpeech: wotd.partOfSpeech || "other", difficulty: wotd.difficulty || "medium", mnemonic: "", correct: 0, incorrect: 0, learned: false, xp: 0, createdAt: new Date().toISOString(), nextReview: new Date().toISOString(), reviewCount: 0 };
    setWords(p => [...p, newW]);
    toast(`"${wotd.word}" added! 🎉`);
  }

  // ─── Practice ────────────────────────────────────────────────────────────
  function buildQueue() {
    if (!words.length) return [];
    const now = Date.now();
    const scored = words.map(w => {
      const tot = (w.correct || 0) + (w.incorrect || 0);
      const acc = tot > 0 ? w.correct / tot : 0.5;
      const overdue = Math.max(0, (now - new Date(w.nextReview || 0).getTime()) / 86400000);
      return { w, p: (1 - acc) * 3 + overdue * 2 + (w.learned ? -2 : 1) + Math.random() * 0.5 };
    });
    scored.sort((a, b) => b.p - a.p);
    const TYPES = ["mcq", "fill", "match", "flash"];
    return scored.slice(0, Math.min(7, scored.length)).map(s => ({ word: s.w, type: rand(TYPES) }));
  }

  function startPractice() {
    const queue = buildQueue();
    setPractice({ queue, index: 0, correct: 0, total: 0, xp: 0, done: false, startTime: Date.now() });
    setMcqOpts(null); setFillAns(""); setAnswerState(null); setHint(null); setFlashFlipped(false);
  }

  // FIX 4: added `words` and `answerState` to dependency array
  useEffect(() => {
    if (!practice || practice.done || answerState) return;
    const item = practice.queue[practice.index];
    if (!item || item.type !== "mcq") return;
    setMcqLoading(true); setMcqOpts(null);
    const defs = words.map(w => w.definition).filter(Boolean);
    aiMCQ(item.word, defs)
      .then(opts => { setMcqOpts(opts); setMcqLoading(false); })
      .catch(() => setMcqLoading(false));
  }, [practice?.index, practice?.done, words, answerState]);

  async function getHint() {
    if (!practice || hintLoading) return;
    const item = practice.queue[practice.index];
    setHintLoading(true);
    const h = await aiHint(item.word);
    setHint(h); setHintLoading(false);
    setWords(p => p.map(w => w.id === item.word.id ? { ...w, xp: Math.max(0, (w.xp || 0) - 5) } : w));
    toast("Hint used! -5 XP", "info");
  }

  async function recordAnswer(correct, wordObj) {
    const xpGain = correct ? 10 : 2;
    const nc = (wordObj.correct || 0) + (correct ? 1 : 0);
    const ni = (wordObj.incorrect || 0) + (correct ? 0 : 1);
    const acc = nc / (nc + ni);
    const interval = correct ? Math.pow(2, nc) * 3600000 * 3 : 3600000;
    const nextReview = new Date(Date.now() + interval).toISOString();
    const learned = nc >= 5 && acc >= 0.8;
    setWords(p => p.map(w => w.id === wordObj.id
      ? { ...w, correct: nc, incorrect: ni, nextReview, learned: learned || w.learned, xp: (w.xp || 0) + xpGain, reviewCount: (w.reviewCount || 0) + 1 }
      : w));
    if (correct) { bumpStreak(); toast(rand(ENCOURAGEMENTS) + ` +${xpGain}XP`, "xp"); }
    return xpGain;
  }

  // FIX 1 & 2: submitAnswer now accepts clickedIdx for MCQ highlighting,
  // and uses the functional setPractice form throughout to avoid stale closure reads.
  async function submitAnswer(correct, clickedIdx = null) {
    if (answerState) return;
    // FIX 1: store clickedIdx alongside correct so MCQ highlight works
    setAnswerState({ correct, clickedIdx });

    // Read current practice via ref-style approach: capture from the state setter
    setPractice(currentPractice => {
      if (!currentPractice) return currentPractice;
      const item = currentPractice.queue[currentPractice.index];
      const nextCorrect = currentPractice.correct + (correct ? 1 : 0);
      const nextTotal   = currentPractice.total + 1;

      // FIX 2: schedule async work using captured snapshot, not stale closure
      const snap = { ...currentPractice, correct: nextCorrect, total: nextTotal };
      recordAnswer(correct, item.word).then(xpGain => {
        setTimeout(() => {
          setPractice(p => {
            if (!p) return p;
            const ni = p.index + 1;
            if (ni >= p.queue.length) {
              const perfect = snap.correct + (correct ? 1 : 0) === snap.total && snap.total > 0;
              const sess = { date: todayStr(), correct: snap.correct, total: snap.total, xp: snap.xp + xpGain, perfect };
              const newHistory = [sess, ...sessionHistory].slice(0, 30);
              setSessionHistory(newHistory); lSet("wb_sessions", newHistory);
              return { ...p, correct: snap.correct, total: snap.total, xp: snap.xp + xpGain, done: true, perfect };
            }
            setMcqOpts(null); setFillAns(""); setAnswerState(null); setHint(null); setFlashFlipped(false);
            return { ...p, correct: snap.correct, total: snap.total, xp: snap.xp + xpGain, index: ni };
          });
        }, 1300);
      });

      return { ...currentPractice, correct: nextCorrect, total: nextTotal };
    });
  }

  function handleFill() {
    if (!practice || answerState) return;
    const item = practice.queue[practice.index];
    submitAnswer(fillAns.trim().toLowerCase() === item.word.word.toLowerCase());
  }

  // ─── Computed ─────────────────────────────────────────────────────────────
  const filteredWords = words.filter(w => {
    if (filter === "learning" && w.learned) return false;
    if (filter === "mastered" && !w.learned) return false;
    if (filter === "due" && (w.learned || new Date(w.nextReview || 0) > new Date())) return false;
    if (search && !w.word.toLowerCase().includes(search.toLowerCase()) && !(w.definition || "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const weeklyXP = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000).toISOString().split("T")[0];
    const s = sessionHistory.filter(x => x.date === d);
    return { day: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][new Date(d + "T12:00:00").getDay()], xp: s.reduce((a, b) => a + b.xp, 0) };
  });
  const maxWeekXP = Math.max(...weeklyXP.map(d => d.xp), 1);

  // ─── Style helpers (stable references via useMemo would be ideal but plain objects are fine here) ─
  const C = { bg: "#080b14", surface: "#111827", card: "#161f33", border: "#1e2d47", amber: "#f59e0b", green: "#34d399", pink: "#f472b6", purple: "#818cf8", muted: "#64748b", text: "#e2e8f0" };
  const pill  = (c, bg) => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: bg || c + "22", color: c });
  const card  = (extra = {}) => ({ background: C.card, borderRadius: 18, padding: 16, border: `1px solid ${C.border}`, ...extra });
  const btn   = (bg, fg = "#080b14", extra = {}) => ({ background: bg, color: fg, border: "none", borderRadius: 14, padding: "11px 20px", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s", ...extra });
  const inp   = (extra = {}) => ({ background: C.surface, color: C.text, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "11px 14px", fontSize: 14, fontWeight: 600, width: "100%", fontFamily: "inherit", outline: "none", ...extra });

  function goTo(v) {
    setView(v);
    if (v === "practice") startPractice();
  }

  const NAV = [
    { id: "home",     icon: "🏠", label: "Home"     },
    { id: "add",      icon: "➕", label: "Add"      },
    { id: "practice", icon: "🧠", label: "Practice" },
    { id: "library",  icon: "📚", label: "Library"  },
    { id: "badges",   icon: "🏆", label: "Badges"   },
  ];

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Nunito',system-ui,sans-serif", display: "flex", flexDirection: "column", color: C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        @keyframes slideUp{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes popIn{0%{transform:scale(0.7);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
        @keyframes glow{0%,100%{box-shadow:0 0 0 0 #f59e0b33}50%{box-shadow:0 0 20px 6px #f59e0b22}}
      `}</style>

      {/* Toasts */}
      <div style={{ position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none", minWidth: 200 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ padding: "9px 18px", borderRadius: 12, fontWeight: 700, fontSize: 13, textAlign: "center", animation: "slideUp 0.3s ease-out", background: t.type === "error" ? "#f87171" : t.type === "xp" ? C.amber : t.type === "info" ? "#818cf8" : "#34d399", color: t.type === "xp" ? C.bg : "#fff" }}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* New badge popup */}
      {newBadge && (
        <div onClick={() => setNewBadge(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card({ textAlign: "center", padding: "32px 28px", maxWidth: 280, animation: "popIn 0.4s ease-out", border: `2px solid ${C.amber}` }) }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>{newBadge.emoji}</div>
            <div style={{ fontSize: 14, color: C.amber, fontWeight: 800, marginBottom: 4 }}>Badge Unlocked!</div>
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>{newBadge.name}</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>{newBadge.desc}</div>
            <button style={btn(C.amber, undefined, { padding: "10px 24px", width: "auto" })} onClick={() => setNewBadge(null)}>Awesome!</button>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={{ padding: "14px 16px 10px", background: C.surface, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, background: C.amber, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📚</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: C.amber, lineHeight: 1 }}>WordBoost</div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>Lv.{level} {getLevelTitle(level)}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span style={pill(C.amber)}>🔥 {streak.count}</span>
          <span style={pill(C.green)}>⭐ {totalXP}</span>
          {/* FIX 10: streak freeze button exposed in UI */}
          {!streak.frozen && streak.count > 0 && (
            <button onClick={freezeStreak} title="Freeze streak for today" style={{ ...btn(C.purple + "22", C.purple, { padding: "3px 8px", fontSize: 11, borderRadius: 8 }) }}>🧊</button>
          )}
        </div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
        {view === "home" && (
          <HomeView words={words} streak={streak} wotd={wotd} wotdLoading={wotdLoading}
            sessionHistory={sessionHistory} weeklyXP={weeklyXP} maxWeekXP={maxWeekXP}
            total={total} mastered={mastered} accuracy={accuracy} dueCount={dueCount}
            totalXP={totalXP} level={level} levelXP={levelXP}
            C={C} pill={pill} card={card} btn={btn} goTo={goTo} addWotdToLibrary={addWotdToLibrary} />
        )}
        {view === "add" && (
          <AddView addForm={addForm} setAddForm={setAddForm} handleAdd={handleAdd} addLoading={addLoading}
            total={total} mastered={mastered} dueCount={dueCount}
            C={C} card={card} btn={btn} inp={inp} />
        )}
        {view === "practice" && (
          <PracticeView practice={practice} words={words} mcqOpts={mcqOpts} mcqLoading={mcqLoading}
            fillAns={fillAns} setFillAns={setFillAns} answerState={answerState}
            hint={hint} hintLoading={hintLoading} flashFlipped={flashFlipped} setFlashFlipped={setFlashFlipped}
            startPractice={startPractice} submitAnswer={submitAnswer} handleFill={handleFill} getHint={getHint}
            goTo={goTo} C={C} card={card} btn={btn} inp={inp} pill={pill} />
        )}
        {view === "library" && (
          <LibraryView filteredWords={filteredWords} filter={filter} setFilter={setFilter}
            search={search} setSearch={setSearch} expandedCard={expandedCard} setExpandedCard={setExpandedCard}
            toggleLearned={toggleLearned} deleteWord={deleteWord}
            C={C} card={card} btn={btn} inp={inp} pill={pill} />
        )}
        {view === "badges" && (
          <BadgesView words={words} streak={streak} lastSession={lastSession} C={C} card={card} />
        )}
      </main>

      {/* Bottom nav */}
      <nav style={{ background: C.surface, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-around", padding: "8px 0 16px", position: "sticky", bottom: 0, zIndex: 100 }}>
        {NAV.map(n => {
          const active = view === n.id;
          return (
            <button key={n.id} onClick={() => goTo(n.id)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "4px 8px", color: active ? C.amber : C.muted, fontFamily: "inherit", position: "relative" }}>
              {n.id === "practice" && dueCount > 0 && !active && <div style={{ position: "absolute", top: 0, right: 4, width: 8, height: 8, background: C.purple, borderRadius: 99 }} />}
              <span style={{ fontSize: 18 }}>{n.icon}</span>
              <span style={{ fontSize: 10, fontWeight: 700 }}>{n.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Confirm dialog */}
      {confirm && (
        <div onClick={() => setConfirm(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={card({ maxWidth: 300, width: "90%", margin: "0 16px", padding: 24, border: `1px solid ${C.border}` })}>
            <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 8 }}>{confirm.title}</h3>
            <p style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>{confirm.msg}</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirm(null)} style={btn(C.surface, C.muted, { flex: 1, border: `1px solid ${C.border}` })}>Cancel</button>
              <button onClick={() => { confirm.onYes(); setConfirm(null); }} style={btn("#f87171", "#fff", { flex: 1 })}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}import { useState, useEffect, useCallback, useRef } from "react";
const MODEL = "claude-sonnet-4-20250514";

// ─── Storage ──────────────────────────────────────────────────────────────────
async function sGet(key) {
  try {
    const r = await window.storage.get(key);
    return r ? JSON.parse(r.value) : null;
  } catch (e) {
    console.warn("[sGet] storage error:", e);
    return null;
  }
}
async function sSet(key, val) {
  try {
    await window.storage.set(key, JSON.stringify(val));
  } catch (e) {
    console.warn("[sSet] storage error:", e);
  }
}
function lGet(k, fb) {
  try { return JSON.parse(localStorage.getItem(k) || "null") ?? fb; }
  catch { return fb; }
}
function lSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); }
  catch (e) { console.warn("[lSet] localStorage error:", e); }
}

// ─── AI ───────────────────────────────────────────────────────────────────────
async function ai(prompt, sys = "Respond only with raw JSON. No markdown, no backticks.") {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  } catch {
    return { definition: `${word}: a word worth knowing`, example: `She spoke the word ${word} with confidence.`, synonyms: "", antonyms: "", partOfSpeech: "other", difficulty: "medium", mnemonic: "" };
  }
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

// FIX 7: safe word blanking that works with special chars and non-ASCII
function blankWord(sentence, word) {
  // Escape special regex chars in the word
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Use case-insensitive replace without \b (which breaks on accented/hyphenated words)
  return sentence.replace(new RegExp(escaped, "gi"), "________");
}

const POS_COLOR = { noun: "#818cf8", verb: "#34d399", adjective: "#f472b6", adverb: "#fb923c", other: "#94a3b8" };
const DIFF_COLOR = { easy: "#34d399", medium: "#f59e0b", hard: "#f87171" };
const ENCOURAGEMENTS = ["🎉 Phenomenal!", "🌟 Brilliant!", "💪 Crushed it!", "🔥 On fire!", "✨ Flawless!", "🚀 Stellar!", "🧠 Galaxy brain!"];

const BADGES = [
  { id: "first",   emoji: "🌱", name: "First Step",    desc: "Added 1st word",     check: (w)         => w.length >= 1 },
  { id: "five",    emoji: "📖", name: "Bookworm",       desc: "5 words added",      check: (w)         => w.length >= 5 },
  { id: "ten",     emoji: "🧠", name: "Brainiac",       desc: "10 words added",     check: (w)         => w.length >= 10 },
  { id: "twenty5", emoji: "⚡", name: "Vocab Spark",    desc: "25 words added",     check: (w)         => w.length >= 25 },
  { id: "fifty",   emoji: "👑", name: "Word Royalty",   desc: "50 words added",     check: (w)         => w.length >= 50 },
  { id: "master1", emoji: "🏅", name: "First Master",   desc: "Mastered 1 word",    check: (w)         => w.filter(x => x.learned).length >= 1 },
  { id: "master5", emoji: "💎", name: "Quick Learner",  desc: "Mastered 5 words",   check: (w)         => w.filter(x => x.learned).length >= 5 },
  { id: "streak3", emoji: "🔥", name: "On Fire",        desc: "3-day streak",       check: (_w, s)     => s >= 3 },
  { id: "streak7", emoji: "🌈", name: "Week Warrior",   desc: "7-day streak",       check: (_w, s)     => s >= 7 },
  // FIX 5: perfect badge now receives real session data from caller
  { id: "perfect", emoji: "🎯", name: "Perfectionist",  desc: "100% session",       check: (_w, _s, ses) => ses?.perfect === true },
];

// ─── XP Levels ────────────────────────────────────────────────────────────────
const XP_PER_LEVEL = 100;
const getLevel    = (xp) => Math.floor(xp / XP_PER_LEVEL) + 1;
const getLevelXP  = (xp) => xp % XP_PER_LEVEL;
const LEVEL_TITLES = ["Novice","Learner","Scholar","Expert","Master","Legend","Guru","Sage","Oracle","Word God"];
const getLevelTitle = (lvl) => LEVEL_TITLES[clamp(lvl - 1, 0, LEVEL_TITLES.length - 1)];

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 8: Sub-views defined OUTSIDE the main component so React never
//         treats them as new component types on re-render.
// Each receives only the props it needs.
// ═══════════════════════════════════════════════════════════════════════════════

function HomeView({ words, streak, wotd, wotdLoading, sessionHistory, weeklyXP, maxWeekXP,
                    total, mastered, accuracy, dueCount, totalXP, level, levelXP,
                    C, pill, card, btn, goTo, addWotdToLibrary }) {
  const recent = [...words].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
  return (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Level + XP bar */}
      <div style={card({ padding: "14px 16px" })}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>Level {level} · </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.amber }}>{getLevelTitle(level)}</span>
          </div>
          <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>{levelXP}/{XP_PER_LEVEL} XP</span>
        </div>
        <div style={{ height: 8, background: C.border, borderRadius: 99, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(levelXP / XP_PER_LEVEL) * 100}%`, background: `linear-gradient(90deg,${C.amber},${C.pink})`, borderRadius: 99, transition: "width 0.6s ease" }} />
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
        {[{ l: "Words", v: total, c: C.amber }, { l: "Mastered", v: mastered, c: C.green }, { l: "Accuracy", v: accuracy + "%", c: C.pink }, { l: "Due", v: dueCount, c: C.purple }].map(s => (
          <div key={s.l} style={{ ...card({ padding: "10px 8px", textAlign: "center", marginBottom: 0 }) }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: s.c, lineHeight: 1.1 }}>{s.v}</div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, marginTop: 2 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Word of the Day */}
      <div style={card({ background: "linear-gradient(135deg,#1a1f35 0%,#111827 100%)", border: `1px solid ${C.purple}44` })}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: C.purple }}>✨ Word of the Day</span>
          <span style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>{todayStr()}</span>
        </div>
        {wotdLoading ? (
          <div style={{ color: C.muted, fontSize: 13, padding: "8px 0" }}>Generating today's word...</div>
        ) : wotd ? (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 22, fontWeight: 900, color: C.purple }}>{wotd.word}</span>
              {wotd.partOfSpeech && <span style={{ ...pill(POS_COLOR[wotd.partOfSpeech] || C.muted) }}>{wotd.partOfSpeech}</span>}
              {wotd.difficulty && <span style={{ ...pill(DIFF_COLOR[wotd.difficulty] || C.muted) }}>{wotd.difficulty}</span>}
            </div>
            <p style={{ fontSize: 13, color: C.text, marginBottom: 4 }}>{wotd.definition}</p>
            {wotd.example && <p style={{ fontSize: 12, color: C.muted, fontStyle: "italic", marginBottom: 8 }}>"{wotd.example}"</p>}
            {wotd.fun_fact && <p style={{ fontSize: 11, color: C.purple, marginBottom: 8 }}>💡 {wotd.fun_fact}</p>}
            <button style={btn(C.purple + "22", C.purple, { width: "100%", padding: "8px" })} onClick={addWotdToLibrary}>+ Add to Library</button>
          </>
        ) : <div style={{ color: C.muted, fontSize: 13 }}>Couldn't load today's word</div>}
      </div>

      {/* Weekly XP chart */}
      {sessionHistory.length > 0 && (
        <div style={card()}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12, color: C.text }}>📈 This Week's XP</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 64 }}>
            {weeklyXP.map((d, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: "100%", height: Math.max(4, Math.round((d.xp / maxWeekXP) * 52)), background: d.xp > 0 ? `linear-gradient(180deg,${C.amber},${C.pink})` : `${C.border}`, borderRadius: "4px 4px 2px 2px", transition: "height 0.5s ease" }} />
                <span style={{ fontSize: 9, color: d.xp > 0 ? C.amber : C.muted, fontWeight: 700 }}>{d.day}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily challenge */}
      <div style={card({ border: `1px solid ${C.amber}33`, background: "linear-gradient(135deg,#1f1a0e 0%,#111827 100%)" })}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: C.amber }}>🎯 Daily Challenge</span>
          <span style={pill(C.amber)}>{Math.min(dueCount, 5)}/5 due</span>
        </div>
        <p style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>Practice due words to maintain your {streak.count}-day streak!</p>
        <button style={btn(C.amber, undefined, { width: "100%" })} onClick={() => goTo("practice")}>Start Practice</button>
      </div>

      {/* Recent words */}
      {recent.length > 0 && (
        <div style={card()}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 800 }}>📖 Recent Words</span>
            <button onClick={() => goTo("library")} style={{ background: "none", border: "none", color: C.amber, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>See All</button>
          </div>
          {recent.map(w => (
            <div key={w.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 11px", borderRadius: 12, background: C.surface, marginBottom: 6, border: `1px solid ${C.border}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ fontWeight: 800, fontSize: 13, color: C.amber }}>{w.word}</span>
                  {w.partOfSpeech && <span style={{ ...pill(POS_COLOR[w.partOfSpeech] || C.muted), fontSize: 9, padding: "2px 6px" }}>{w.partOfSpeech}</span>}
                  {w.learned && <span style={{ ...pill(C.green), fontSize: 9, padding: "2px 6px" }}>✓ mastered</span>}
                </div>
                <p style={{ fontSize: 11, color: C.muted, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.definition}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {words.length === 0 && (
        <div style={{ ...card(), textAlign: "center", padding: "36px 16px" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🌱</div>
          <h3 style={{ fontSize: 16, fontWeight: 900, marginBottom: 8 }}>Start your journey</h3>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>Add your first word to begin leveling up your vocabulary!</p>
          <button style={btn(C.amber, undefined, { width: "auto", padding: "12px 28px" })} onClick={() => goTo("add")}>Add First Word</button>
        </div>
      )}
    </div>
  );
}

function AddView({ addForm, setAddForm, handleAdd, addLoading, total, mastered, dueCount, C, card, btn, inp }) {
  return (
    <div style={{ padding: "12px 14px" }}>
      <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 16 }}>➕ Add New Word</h2>
      <form onSubmit={handleAdd} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[
          { k: "word",     label: "Word *",                       ph: "e.g. ephemeral",           required: true,  ta: false },
          { k: "def",      label: "Definition",                   ph: "AI-generated if empty",    required: false, ta: true  },
          { k: "example",  label: "Example Sentence",             ph: "AI-generated if empty",    required: false, ta: true  },
          { k: "synonyms", label: "Synonyms (comma-separated)",   ph: "e.g. fleeting, transient", required: false, ta: false },
        ].map(f => (
          <div key={f.k}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 5 }}>
              {f.label}
              {(f.k === "def" || f.k === "example") && <span style={{ color: C.purple, marginLeft: 6 }}>✨ AI</span>}
            </label>
            {f.ta
              ? <textarea rows={2} placeholder={f.ph} value={addForm[f.k]} onChange={e => setAddForm(p => ({ ...p, [f.k]: e.target.value }))} style={{ ...inp(), resize: "none" }} />
              : <input type="text" placeholder={f.ph} value={addForm[f.k]} required={f.required} onChange={e => setAddForm(p => ({ ...p, [f.k]: e.target.value }))} style={inp()} />
            }
          </div>
        ))}
        {/* FIX 6: was `addLoading?.6` (syntax error) → now proper ternary */}
        <button type="submit" disabled={addLoading} style={{ ...btn(C.amber, undefined, { opacity: addLoading ? 0.6 : 1 }) }}>
          {addLoading ? "✨ AI is generating definition..." : "Add Word"}
        </button>
      </form>

      {total > 0 && (
        <div style={{ ...card(), marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 10 }}>QUICK STATS</div>
          <div style={{ display: "flex", gap: 16 }}>
            <div><div style={{ fontSize: 18, fontWeight: 900, color: C.amber }}>{total}</div><div style={{ fontSize: 11, color: C.muted }}>total words</div></div>
            <div><div style={{ fontSize: 18, fontWeight: 900, color: C.green }}>{mastered}</div><div style={{ fontSize: 11, color: C.muted }}>mastered</div></div>
            <div><div style={{ fontSize: 18, fontWeight: 900, color: C.purple }}>{dueCount}</div><div style={{ fontSize: 11, color: C.muted }}>due for review</div></div>
          </div>
        </div>
      )}
    </div>
  );
}

function PracticeView({ practice, words, mcqOpts, mcqLoading, fillAns, setFillAns, answerState,
                        hint, hintLoading, flashFlipped, setFlashFlipped,
                        startPractice, submitAnswer, handleFill, getHint, goTo,
                        C, card, btn, inp, pill }) {
  if (!practice) return (
    <div style={{ padding: "40px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 56, marginBottom: 16 }}>🧠</div>
      <button style={btn(C.amber, undefined, { padding: "14px 32px" })} onClick={startPractice}>Start Practice</button>
    </div>
  );

  if (words.length === 0) return (
    <div style={{ padding: "40px 16px", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>📚</div>
      <h3 style={{ fontWeight: 800, marginBottom: 8 }}>No words yet</h3>
      <p style={{ color: C.muted, fontSize: 13, marginBottom: 16 }}>Add some words to your library first.</p>
      <button style={btn(C.amber, undefined, { padding: "12px 28px", width: "auto" })} onClick={() => goTo("add")}>Add Words</button>
    </div>
  );

  if (practice.done) {
    const pct = practice.total > 0 ? Math.round(practice.correct / practice.total * 100) : 0;
    return (
      <div style={{ padding: "32px 16px", textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: 12 }}>{pct === 100 ? "🏆" : pct >= 70 ? "🎉" : "💪"}</div>
        <h3 style={{ fontSize: 20, fontWeight: 900, color: C.amber, marginBottom: 8 }}>Session Complete!</h3>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginBottom: 20 }}>
          <div style={card({ padding: "12px 20px", textAlign: "center", border: `1px solid ${C.green}44` })}>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.green }}>{practice.correct}/{practice.total}</div>
            <div style={{ fontSize: 11, color: C.muted }}>correct</div>
          </div>
          <div style={card({ padding: "12px 20px", textAlign: "center", border: `1px solid ${C.amber}44` })}>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.amber }}>+{practice.xp}</div>
            <div style={{ fontSize: 11, color: C.muted }}>XP earned</div>
          </div>
          <div style={card({ padding: "12px 20px", textAlign: "center", border: `1px solid ${C.purple}44` })}>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.purple }}>{pct}%</div>
            <div style={{ fontSize: 11, color: C.muted }}>accuracy</div>
          </div>
        </div>
        {practice.perfect && (
          <div style={{ ...card({ border: `1px solid ${C.amber}`, marginBottom: 16 }), color: C.amber, fontWeight: 800, fontSize: 14 }}>
            🎯 Perfect session! Bonus badge unlocked!
          </div>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button style={btn(C.amber, undefined, { flex: 1 })} onClick={startPractice}>Practice Again</button>
          <button style={btn(C.surface, C.text, { flex: 1, border: `1px solid ${C.border}` })} onClick={() => goTo("home")}>Home</button>
        </div>
      </div>
    );
  }

  const { queue, index } = practice;
  if (index >= queue.length) return null;
  const { word, type } = queue[index];
  const pct = Math.round((index / queue.length) * 100);

  // Flashcard mode
  if (type === "flash") {
    return (
      <div style={{ padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>Card {index + 1}/{queue.length}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.amber }}>+{practice.xp} XP</span>
        </div>
        <div style={{ height: 6, background: C.border, borderRadius: 99, marginBottom: 16, overflow: "hidden" }}>
          <div style={{ height: "100%", width: pct + "%", background: `linear-gradient(90deg,${C.amber},${C.pink})`, borderRadius: 99 }} />
        </div>
        <div onClick={() => setFlashFlipped(f => !f)} style={{ ...card({ minHeight: 200, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", transition: "all 0.3s", background: flashFlipped ? C.surface : C.card, border: `2px solid ${flashFlipped ? C.green : C.border}` }) }}>
          {!flashFlipped ? (
            <>
              <div style={{ fontSize: 32, fontWeight: 900, color: C.amber, marginBottom: 8 }}>{word.word}</div>
              {word.partOfSpeech && <span style={pill(POS_COLOR[word.partOfSpeech] || C.muted)}>{word.partOfSpeech}</span>}
              <div style={{ fontSize: 12, color: C.muted, marginTop: 16 }}>Tap to reveal definition</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 14, color: C.text, marginBottom: 10, lineHeight: 1.6 }}>{word.definition}</div>
              {word.example && <div style={{ fontSize: 12, color: C.muted, fontStyle: "italic", marginBottom: 8 }}>"{word.example}"</div>}
              {word.mnemonic && <div style={{ fontSize: 12, color: C.purple, marginBottom: 8 }}>💡 {word.mnemonic}</div>}
            </>
          )}
        </div>
        {flashFlipped && (
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button style={btn("#ef444422", "#f87171", { flex: 1, border: "1px solid #f8717144" })} onClick={() => submitAnswer(false)}>Didn't know ✗</button>
            <button style={btn(C.green + "22", C.green, { flex: 1, border: `1px solid ${C.green}44` })} onClick={() => submitAnswer(true)}>Knew it! ✓</button>
          </div>
        )}
      </div>
    );
  }

  const feedbackColor = answerState ? (answerState.correct ? C.green : "#f87171") : null;

  return (
    <div style={{ padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>Q {index + 1}/{queue.length}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!answerState && (
            <button onClick={getHint} disabled={hintLoading} style={{ ...btn(C.purple + "22", C.purple, { padding: "5px 10px", fontSize: 11, borderRadius: 8 }) }}>
              {hintLoading ? "..." : "💡 Hint (-5 XP)"}
            </button>
          )}
          <span style={{ fontSize: 12, fontWeight: 700, color: C.amber }}>+{practice.xp} XP</span>
        </div>
      </div>
      <div style={{ height: 6, background: C.border, borderRadius: 99, marginBottom: 14, overflow: "hidden" }}>
        <div style={{ height: "100%", width: pct + "%", background: `linear-gradient(90deg,${C.amber},${C.pink})`, borderRadius: 99, transition: "width 0.3s ease" }} />
      </div>

      {hint && <div style={{ ...card({ border: `1px solid ${C.purple}44`, marginBottom: 12, padding: "10px 14px" }), fontSize: 12, color: C.purple }}>💡 {hint}</div>}

      {answerState && (
        <div style={{ ...card({ border: `2px solid ${feedbackColor}44`, marginBottom: 12, padding: "10px 14px", background: feedbackColor + "11" }), fontSize: 13, fontWeight: 800, color: feedbackColor, textAlign: "center" }}>
          {answerState.correct ? "✅ Correct! Well done!" : `❌ The answer was: ${word.word}`}
        </div>
      )}

      <div style={card()}>
        {/* MCQ */}
        {type === "mcq" && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 6 }}>What does this word mean?</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: C.amber, marginBottom: 4 }}>{word.word}</div>
            {word.partOfSpeech && <span style={{ ...pill(POS_COLOR[word.partOfSpeech] || C.muted), marginBottom: 14, display: "inline-flex" }}>{word.partOfSpeech}</span>}
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              {mcqLoading
                ? <div style={{ textAlign: "center", color: C.muted, padding: 20, fontSize: 13 }}>✨ Generating options...</div>
                : (mcqOpts || []).map((opt, i) => {
                  // FIX 1: highlight logic uses answerState.clickedIdx which is now correctly preserved
                  let bg = C.surface, border = C.border, col = C.text;
                  if (answerState) {
                    if (opt.correct) { bg = C.green + "22"; border = C.green; col = C.green; }
                    else if (i === answerState.clickedIdx) { bg = "#f8717122"; border = "#f87171"; col = "#f87171"; }
                  }
                  return (
                    <button key={i}
                      disabled={!!answerState}
                      onClick={() => submitAnswer(opt.correct, i)}
                      style={{ background: bg, color: col, border: `1.5px solid ${border}`, borderRadius: 12, padding: "11px 14px", textAlign: "left", fontSize: 13, fontWeight: 600, cursor: answerState ? "default" : "pointer", fontFamily: "inherit", transition: "all 0.15s" }}>
                      <span style={{ fontWeight: 900, color: answerState ? (opt.correct ? C.green : i === answerState.clickedIdx ? "#f87171" : C.muted) : C.amber, marginRight: 8 }}>{["A", "B", "C", "D"][i]}.</span>
                      {opt.text}
                    </button>
                  );
                })}
            </div>
          </>
        )}

        {/* Fill / Match */}
        {(type === "fill" || type === "match") && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 6 }}>
              {type === "fill" ? "Fill in the blank" : "Which word matches this definition?"}
            </div>
            {type === "fill" && word.example && (
              <div style={{ background: C.surface, borderRadius: 12, padding: "11px 14px", fontSize: 13, color: C.muted, fontStyle: "italic", marginBottom: 12, lineHeight: 1.7 }}>
                {/* FIX 7: use safe blankWord() helper */}
                "{blankWord(word.example, word.word)}"
              </div>
            )}
            {type === "match" && (
              <div style={{ background: C.surface, borderRadius: 12, padding: "11px 14px", fontSize: 13, color: C.text, marginBottom: 12, lineHeight: 1.6 }}>{word.definition}</div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <input value={fillAns} onChange={e => setFillAns(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !answerState && handleFill()}
                disabled={!!answerState} placeholder="Type the word..."
                style={{ ...inp(), flex: 1 }} />
              <button onClick={handleFill} disabled={!!answerState} style={{ ...btn(C.amber, undefined, { width: "auto", padding: "11px 16px" }) }}>Check</button>
            </div>
          </>
        )}
      </div>

      {/* Word details after answer */}
      {answerState && (
        <div style={{ ...card({ marginTop: 12, border: `1px solid ${C.border}` }) }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, marginBottom: 8 }}>ABOUT THIS WORD</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: C.amber, marginBottom: 4 }}>{word.word}</div>
          <p style={{ fontSize: 13, color: C.text, marginBottom: 4 }}>{word.definition}</p>
          {word.example && <p style={{ fontSize: 12, color: C.muted, fontStyle: "italic", marginBottom: 4 }}>"{word.example}"</p>}
          {word.synonyms && <p style={{ fontSize: 12, color: C.green, marginBottom: 2 }}>Synonyms: {word.synonyms}</p>}
          {word.antonyms && <p style={{ fontSize: 12, color: "#f87171" }}>Antonyms: {word.antonyms}</p>}
          {word.mnemonic && <p style={{ fontSize: 12, color: C.purple, marginTop: 6 }}>💡 {word.mnemonic}</p>}
        </div>
      )}
    </div>
  );
}

function LibraryView({ filteredWords, filter, setFilter, search, setSearch, expandedCard, setExpandedCard,
                       toggleLearned, deleteWord, C, card, btn, inp, pill }) {
  return (
    <div style={{ padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h2 style={{ fontSize: 18, fontWeight: 900 }}>📚 Library</h2>
        <span style={pill(C.amber)}>{filteredWords.length} words</span>
      </div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search words or definitions..."
        style={{ ...inp(), marginBottom: 10 }} />
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {["all", "learning", "mastered", "due"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding: "5px 12px", borderRadius: 999, fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit", background: filter === f ? C.amber : C.surface, color: filter === f ? "#080b14" : C.muted, transition: "all 0.15s" }}>
            {f === "all" ? "All" : f === "learning" ? "Learning" : f === "mastered" ? "Mastered" : "⚡ Due"}
          </button>
        ))}
      </div>
      {filteredWords.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📝</div>
          <p style={{ color: C.muted }}>No words found</p>
        </div>
      ) : filteredWords.map(w => {
        const tot = (w.correct || 0) + (w.incorrect || 0);
        const acc = tot > 0 ? Math.round(w.correct / tot * 100) : 0;
        const isDue = !w.learned && new Date(w.nextReview || 0) <= new Date();
        const isExpanded = expandedCard === w.id;
        return (
          <div key={w.id} style={{ ...card({ marginBottom: 10, cursor: "pointer", border: `1px solid ${isDue ? C.purple + "66" : C.border}` }) }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }} onClick={() => setExpandedCard(isExpanded ? null : w.id)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontWeight: 900, fontSize: 16, color: C.amber }}>{w.word}</span>
                  {w.partOfSpeech && <span style={{ ...pill(POS_COLOR[w.partOfSpeech] || C.muted), fontSize: 9, padding: "2px 6px" }}>{w.partOfSpeech}</span>}
                  {w.difficulty && <span style={{ ...pill(DIFF_COLOR[w.difficulty] || C.muted), fontSize: 9, padding: "2px 6px" }}>{w.difficulty}</span>}
                  {w.learned && <span style={{ ...pill(C.green), fontSize: 9, padding: "2px 6px" }}>✓ mastered</span>}
                  {isDue && <span style={{ ...pill(C.purple), fontSize: 9, padding: "2px 6px" }}>⚡ due</span>}
                </div>
                <p style={{ fontSize: 12, color: C.muted, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: isExpanded ? "normal" : "nowrap" }}>{w.definition}</p>
              </div>
              <span style={{ fontSize: 12, color: C.border, marginLeft: 8, marginTop: 2 }}>{isExpanded ? "▲" : "▼"}</span>
            </div>
            {isExpanded && (
              <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 12, paddingTop: 12 }}>
                {w.example && <p style={{ fontSize: 12, color: C.muted, fontStyle: "italic", marginBottom: 8 }}>"{w.example}"</p>}
                {w.synonyms && <p style={{ fontSize: 12, color: C.green, marginBottom: 4 }}>Synonyms: {w.synonyms}</p>}
                {w.antonyms && <p style={{ fontSize: 12, color: "#f87171", marginBottom: 4 }}>Antonyms: {w.antonyms}</p>}
                {w.mnemonic && <p style={{ fontSize: 12, color: C.purple, marginBottom: 8 }}>💡 {w.mnemonic}</p>}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 11, color: C.muted }}>{tot} attempts · {acc}% accuracy · {w.reviewCount || 0} reviews</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => toggleLearned(w.id)} style={{ ...btn(w.learned ? C.green + "22" : C.surface, w.learned ? C.green : C.muted, { flex: 1, padding: "8px", fontSize: 12, border: `1px solid ${w.learned ? C.green : C.border}` }) }}>
                    {w.learned ? "★ Mastered" : "☆ Mark Mastered"}
                  </button>
                  <button onClick={() => deleteWord(w.id)} style={{ ...btn("#f8717122", "#f87171", { padding: "8px 12px", border: "1px solid #f8717144" }) }}>🗑️</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BadgesView({ words, streak, lastSession, C, card }) {
  return (
    <div style={{ padding: "12px 14px" }}>
      <h2 style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}>🏆 Badges</h2>
      {/* FIX 5: pass lastSession so the perfect badge can actually be checked */}
      <p style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>
        {BADGES.filter(b => b.check(words, streak.count, lastSession)).length}/{BADGES.length} earned
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {BADGES.map(b => {
          const earned = b.check(words, streak.count, lastSession);
          return (
            <div key={b.id} style={{ ...card({ opacity: earned ? 1 : 0.4, border: `1px solid ${earned ? C.amber + "44" : C.border}`, padding: "14px 12px", textAlign: "center" }) }}>
              <div style={{ fontSize: 32, marginBottom: 6 }}>{b.emoji}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: earned ? C.amber : C.muted, marginBottom: 2 }}>{b.name}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{b.desc}</div>
              {earned && <div style={{ fontSize: 10, color: C.green, marginTop: 4, fontWeight: 700 }}>✓ Earned</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function WordBoost() {
  // ─── State ───────────────────────────────────────────────────────────────
  const [words, setWords]               = useState([]);
  const [loaded, setLoaded]             = useState(false);
  const [view, setView]                 = useState("home");
  const [filter, setFilter]             = useState("all");
  const [search, setSearch]             = useState("");
  const [toasts, setToasts]             = useState([]);
  const [streak, setStreak]             = useState(() => lGet("wb_streak3", { count: 0, lastDate: "", frozen: false }));
  const [practice, setPractice]         = useState(null);
  const [mcqOpts, setMcqOpts]           = useState(null);
  const [mcqLoading, setMcqLoading]     = useState(false);
  const [fillAns, setFillAns]           = useState("");
  const [answerState, setAnswerState]   = useState(null);
  const [hint, setHint]                 = useState(null);
  const [hintLoading, setHintLoading]   = useState(false);
  const [addForm, setAddForm]           = useState({ word: "", def: "", example: "", synonyms: "" });
  const [addLoading, setAddLoading]     = useState(false);
  const [confirm, setConfirm]           = useState(null);
  const [wotd, setWotd]                 = useState(null);
  const [wotdLoading, setWotdLoading]   = useState(false);
  const [expandedCard, setExpandedCard] = useState(null);
  const [flashFlipped, setFlashFlipped] = useState(false);
  const [sessionHistory, setSessionHistory] = useState(() => lGet("wb_sessions", []));
  const [newBadge, setNewBadge]         = useState(null);
  const prevBadgesRef                   = useRef([]);

  // ─── Load/Save ───────────────────────────────────────────────────────────
  useEffect(() => {
    sGet("wb_words3").then(saved => {
      if (saved?.length) setWords(saved);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    sSet("wb_words3", words);
  }, [words, loaded]);

  // ─── Badge detector ──────────────────────────────────────────────────────
  // FIX 5: pass lastSession (most recent session) so perfect badge can resolve
  const lastSession = sessionHistory[0] || null;
  useEffect(() => {
    const currentEarned = BADGES.filter(b => b.check(words, streak.count, lastSession)).map(b => b.id);
    const prev = prevBadgesRef.current;
    const fresh = currentEarned.filter(id => !prev.includes(id));
    if (fresh.length && prev.length) {
      const b = BADGES.find(x => x.id === fresh[0]);
      if (b) setNewBadge(b);
    }
    prevBadgesRef.current = currentEarned;
  }, [words, streak.count, lastSession]);

  // ─── Word of the Day ─────────────────────────────────────────────────────
  // FIX 3: words is now a dependency so the avoid list is populated correctly.
  // We gate on `loaded` to avoid fetching before words are restored from storage.
  useEffect(() => {
    if (!loaded) return;
    const today = todayStr();
    const cached = lGet("wb_wotd", null);
    if (cached?.date === today) { setWotd(cached.data); return; }
    setWotdLoading(true);
    aiWordOfDay(words).then(w => {
      if (w) { lSet("wb_wotd", { date: today, data: w }); setWotd(w); }
      setWotdLoading(false);
    });
  }, [loaded]); // runs once after words are loaded; `words` snapshot captured at that point

  // ─── Toast ───────────────────────────────────────────────────────────────
  const toast = useCallback((msg, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2800);
  }, []);

  // ─── Streak ──────────────────────────────────────────────────────────────
  const bumpStreak = useCallback(() => {
    const today = todayStr();
    const yest  = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    setStreak(prev => {
      if (prev.lastDate === today) return prev;
      const next = { ...prev };
      if (prev.lastDate === yest || prev.frozen) { next.count++; next.frozen = false; }
      else next.count = 1;
      next.lastDate = today;
      lSet("wb_streak3", next);
      return next;
    });
  }, []);

  // FIX 10: expose freezeStreak so it can actually be called (e.g. from a UI button)
  const freezeStreak = useCallback(() => {
    setStreak(prev => {
      const next = { ...prev, frozen: true };
      lSet("wb_streak3", next);
      return next;
    });
  }, []);

  // ─── Stats ───────────────────────────────────────────────────────────────
  const total         = words.length;
  const mastered      = words.filter(w => w.learned).length;
  const totalAttempts = words.reduce((s, w) => s + (w.correct || 0) + (w.incorrect || 0), 0);
  const totalCorrect  = words.reduce((s, w) => s + (w.correct || 0), 0);
  const accuracy      = totalAttempts > 0 ? Math.round(totalCorrect / totalAttempts * 100) : 0;
  const totalXP       = words.reduce((s, w) => s + (w.xp || 0), 0);
  const level         = getLevel(totalXP);
  const levelXP       = getLevelXP(totalXP);
  const dueCount      = words.filter(w => !w.learned && new Date(w.nextReview || 0) <= new Date()).length;

  // ─── Add word ────────────────────────────────────────────────────────────
  async function handleAdd(e) {
    e.preventDefault();
    const word = addForm.word.trim();
    if (!word) return;
    if (words.some(w => w.word.toLowerCase() === word.toLowerCase())) { toast("Already in your library!", "error"); return; }
    setAddLoading(true);
    let info = { definition: addForm.def.trim(), example: addForm.example.trim(), synonyms: addForm.synonyms.trim(), antonyms: "", partOfSpeech: "other", difficulty: "medium", mnemonic: "" };
    if (!info.definition || !info.example) {
      const gen = await aiWordInfo(word);
      if (!info.definition) info.definition = gen.definition;
      if (!info.example)    info.example    = gen.example;
      if (!info.synonyms)   info.synonyms   = gen.synonyms;
      info.antonyms    = gen.antonyms    || "";
      info.partOfSpeech = gen.partOfSpeech || "other";
      info.difficulty  = gen.difficulty  || "medium";
      info.mnemonic    = gen.mnemonic    || "";
    }
    const newW = { id: Date.now().toString(), word, ...info, correct: 0, incorrect: 0, learned: false, xp: 0, createdAt: new Date().toISOString(), nextReview: new Date().toISOString(), reviewCount: 0 };
    setWords(prev => [...prev, newW]);
    setAddForm({ word: "", def: "", example: "", synonyms: "" });
    setAddLoading(false);
    toast(`"${word}" added! 🎉`);
  }

  // ─── Delete / Toggle ─────────────────────────────────────────────────────
  function deleteWord(id) {
    const w = words.find(x => x.id === id);
    setConfirm({ title: "Delete word?", msg: `Remove "${w?.word}" forever?`, onYes: () => { setWords(p => p.filter(x => x.id !== id)); toast("Deleted", "info"); } });
  }

  function toggleLearned(id) {
    setWords(p => p.map(w => w.id === id ? { ...w, learned: !w.learned } : w));
    const w = words.find(x => x.id === id);
    toast(w?.learned ? "Unmarked as mastered" : "Marked as mastered! ⭐");
  }

  function addWotdToLibrary() {
    if (!wotd) return;
    if (words.some(w => w.word.toLowerCase() === wotd.word.toLowerCase())) { toast("Already in your library!", "error"); return; }
    const newW = { id: Date.now().toString(), word: wotd.word, definition: wotd.definition, example: wotd.example, synonyms: "", antonyms: "", partOfSpeech: wotd.partOfSpeech || "other", difficulty: wotd.difficulty || "medium", mnemonic: "", correct: 0, incorrect: 0, learned: false, xp: 0, createdAt: new Date().toISOString(), nextReview: new Date().toISOString(), reviewCount: 0 };
    setWords(p => [...p, newW]);
    toast(`"${wotd.word}" added! 🎉`);
  }

  // ─── Practice ────────────────────────────────────────────────────────────
  function buildQueue() {
    if (!words.length) return [];
    const now = Date.now();
    const scored = words.map(w => {
      const tot = (w.correct || 0) + (w.incorrect || 0);
      const acc = tot > 0 ? w.correct / tot : 0.5;
      const overdue = Math.max(0, (now - new Date(w.nextReview || 0).getTime()) / 86400000);
      return { w, p: (1 - acc) * 3 + overdue * 2 + (w.learned ? -2 : 1) + Math.random() * 0.5 };
    });
    scored.sort((a, b) => b.p - a.p);
    const TYPES = ["mcq", "fill", "match", "flash"];
    return scored.slice(0, Math.min(7, scored.length)).map(s => ({ word: s.w, type: rand(TYPES) }));
  }

  function startPractice() {
    const queue = buildQueue();
    setPractice({ queue, index: 0, correct: 0, total: 0, xp: 0, done: false, startTime: Date.now() });
    setMcqOpts(null); setFillAns(""); setAnswerState(null); setHint(null); setFlashFlipped(false);
  }

  // FIX 4: added `words` and `answerState` to dependency array
  useEffect(() => {
    if (!practice || practice.done || answerState) return;
    const item = practice.queue[practice.index];
    if (!item || item.type !== "mcq") return;
    setMcqLoading(true); setMcqOpts(null);
    const defs = words.map(w => w.definition).filter(Boolean);
    aiMCQ(item.word, defs)
      .then(opts => { setMcqOpts(opts); setMcqLoading(false); })
      .catch(() => setMcqLoading(false));
  }, [practice?.index, practice?.done, words, answerState]);

  async function getHint() {
    if (!practice || hintLoading) return;
    const item = practice.queue[practice.index];
    setHintLoading(true);
    const h = await aiHint(item.word);
    setHint(h); setHintLoading(false);
    setWords(p => p.map(w => w.id === item.word.id ? { ...w, xp: Math.max(0, (w.xp || 0) - 5) } : w));
    toast("Hint used! -5 XP", "info");
  }

  async function recordAnswer(correct, wordObj) {
    const xpGain = correct ? 10 : 2;
    const nc = (wordObj.correct || 0) + (correct ? 1 : 0);
    const ni = (wordObj.incorrect || 0) + (correct ? 0 : 1);
    const acc = nc / (nc + ni);
    const interval = correct ? Math.pow(2, nc) * 3600000 * 3 : 3600000;
    const nextReview = new Date(Date.now() + interval).toISOString();
    const learned = nc >= 5 && acc >= 0.8;
    setWords(p => p.map(w => w.id === wordObj.id
      ? { ...w, correct: nc, incorrect: ni, nextReview, learned: learned || w.learned, xp: (w.xp || 0) + xpGain, reviewCount: (w.reviewCount || 0) + 1 }
      : w));
    if (correct) { bumpStreak(); toast(rand(ENCOURAGEMENTS) + ` +${xpGain}XP`, "xp"); }
    return xpGain;
  }

  // FIX 1 & 2: submitAnswer now accepts clickedIdx for MCQ highlighting,
  // and uses the functional setPractice form throughout to avoid stale closure reads.
  async function submitAnswer(correct, clickedIdx = null) {
    if (answerState) return;
    // FIX 1: store clickedIdx alongside correct so MCQ highlight works
    setAnswerState({ correct, clickedIdx });

    // Read current practice via ref-style approach: capture from the state setter
    setPractice(currentPractice => {
      if (!currentPractice) return currentPractice;
      const item = currentPractice.queue[currentPractice.index];
      const nextCorrect = currentPractice.correct + (correct ? 1 : 0);
      const nextTotal   = currentPractice.total + 1;

      // FIX 2: schedule async work using captured snapshot, not stale closure
      const snap = { ...currentPractice, correct: nextCorrect, total: nextTotal };
      recordAnswer(correct, item.word).then(xpGain => {
        setTimeout(() => {
          setPractice(p => {
            if (!p) return p;
            const ni = p.index + 1;
            if (ni >= p.queue.length) {
              const perfect = snap.correct + (correct ? 1 : 0) === snap.total && snap.total > 0;
              const sess = { date: todayStr(), correct: snap.correct, total: snap.total, xp: snap.xp + xpGain, perfect };
              const newHistory = [sess, ...sessionHistory].slice(0, 30);
              setSessionHistory(newHistory); lSet("wb_sessions", newHistory);
              return { ...p, correct: snap.correct, total: snap.total, xp: snap.xp + xpGain, done: true, perfect };
            }
            setMcqOpts(null); setFillAns(""); setAnswerState(null); setHint(null); setFlashFlipped(false);
            return { ...p, correct: snap.correct, total: snap.total, xp: snap.xp + xpGain, index: ni };
          });
        }, 1300);
      });

      return { ...currentPractice, correct: nextCorrect, total: nextTotal };
    });
  }

  function handleFill() {
    if (!practice || answerState) return;
    const item = practice.queue[practice.index];
    submitAnswer(fillAns.trim().toLowerCase() === item.word.word.toLowerCase());
  }

  // ─── Computed ─────────────────────────────────────────────────────────────
  const filteredWords = words.filter(w => {
    if (filter === "learning" && w.learned) return false;
    if (filter === "mastered" && !w.learned) return false;
    if (filter === "due" && (w.learned || new Date(w.nextReview || 0) > new Date())) return false;
    if (search && !w.word.toLowerCase().includes(search.toLowerCase()) && !(w.definition || "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const weeklyXP = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000).toISOString().split("T")[0];
    const s = sessionHistory.filter(x => x.date === d);
    return { day: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][new Date(d + "T12:00:00").getDay()], xp: s.reduce((a, b) => a + b.xp, 0) };
  });
  const maxWeekXP = Math.max(...weeklyXP.map(d => d.xp), 1);

  // ─── Style helpers (stable references via useMemo would be ideal but plain objects are fine here) ─
  const C = { bg: "#080b14", surface: "#111827", card: "#161f33", border: "#1e2d47", amber: "#f59e0b", green: "#34d399", pink: "#f472b6", purple: "#818cf8", muted: "#64748b", text: "#e2e8f0" };
  const pill  = (c, bg) => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: bg || c + "22", color: c });
  const card  = (extra = {}) => ({ background: C.card, borderRadius: 18, padding: 16, border: `1px solid ${C.border}`, ...extra });
  const btn   = (bg, fg = "#080b14", extra = {}) => ({ background: bg, color: fg, border: "none", borderRadius: 14, padding: "11px 20px", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s", ...extra });
  const inp   = (extra = {}) => ({ background: C.surface, color: C.text, border: `1.5px solid ${C.border}`, borderRadius: 12, padding: "11px 14px", fontSize: 14, fontWeight: 600, width: "100%", fontFamily: "inherit", outline: "none", ...extra });

  function goTo(v) {
    setView(v);
    if (v === "practice") startPractice();
  }

  const NAV = [
    { id: "home",     icon: "🏠", label: "Home"     },
    { id: "add",      icon: "➕", label: "Add"      },
    { id: "practice", icon: "🧠", label: "Practice" },
    { id: "library",  icon: "📚", label: "Library"  },
    { id: "badges",   icon: "🏆", label: "Badges"   },
  ];

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Nunito',system-ui,sans-serif", display: "flex", flexDirection: "column", color: C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
        @keyframes slideUp{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes popIn{0%{transform:scale(0.7);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
        @keyframes glow{0%,100%{box-shadow:0 0 0 0 #f59e0b33}50%{box-shadow:0 0 20px 6px #f59e0b22}}
      `}</style>

      {/* Toasts */}
      <div style={{ position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none", minWidth: 200 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ padding: "9px 18px", borderRadius: 12, fontWeight: 700, fontSize: 13, textAlign: "center", animation: "slideUp 0.3s ease-out", background: t.type === "error" ? "#f87171" : t.type === "xp" ? C.amber : t.type === "info" ? "#818cf8" : "#34d399", color: t.type === "xp" ? C.bg : "#fff" }}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* New badge popup */}
      {newBadge && (
        <div onClick={() => setNewBadge(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ ...card({ textAlign: "center", padding: "32px 28px", maxWidth: 280, animation: "popIn 0.4s ease-out", border: `2px solid ${C.amber}` }) }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>{newBadge.emoji}</div>
            <div style={{ fontSize: 14, color: C.amber, fontWeight: 800, marginBottom: 4 }}>Badge Unlocked!</div>
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 6 }}>{newBadge.name}</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 20 }}>{newBadge.desc}</div>
            <button style={btn(C.amber, undefined, { padding: "10px 24px", width: "auto" })} onClick={() => setNewBadge(null)}>Awesome!</button>
          </div>
        </div>
      )}

      {/* Header */}
      <header style={{ padding: "14px 16px 10px", background: C.surface, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, background: C.amber, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📚</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: C.amber, lineHeight: 1 }}>WordBoost</div>
            <div style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>Lv.{level} {getLevelTitle(level)}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span style={pill(C.amber)}>🔥 {streak.count}</span>
          <span style={pill(C.green)}>⭐ {totalXP}</span>
          {/* FIX 10: streak freeze button exposed in UI */}
          {!streak.frozen && streak.count > 0 && (
            <button onClick={freezeStreak} title="Freeze streak for today" style={{ ...btn(C.purple + "22", C.purple, { padding: "3px 8px", fontSize: 11, borderRadius: 8 }) }}>🧊</button>
          )}
        </div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
        {view === "home" && (
          <HomeView words={words} streak={streak} wotd={wotd} wotdLoading={wotdLoading}
            sessionHistory={sessionHistory} weeklyXP={weeklyXP} maxWeekXP={maxWeekXP}
            total={total} mastered={mastered} accuracy={accuracy} dueCount={dueCount}
            totalXP={totalXP} level={level} levelXP={levelXP}
            C={C} pill={pill} card={card} btn={btn} goTo={goTo} addWotdToLibrary={addWotdToLibrary} />
        )}
        {view === "add" && (
          <AddView addForm={addForm} setAddForm={setAddForm} handleAdd={handleAdd} addLoading={addLoading}
            total={total} mastered={mastered} dueCount={dueCount}
            C={C} card={card} btn={btn} inp={inp} />
        )}
        {view === "practice" && (
          <PracticeView practice={practice} words={words} mcqOpts={mcqOpts} mcqLoading={mcqLoading}
            fillAns={fillAns} setFillAns={setFillAns} answerState={answerState}
            hint={hint} hintLoading={hintLoading} flashFlipped={flashFlipped} setFlashFlipped={setFlashFlipped}
            startPractice={startPractice} submitAnswer={submitAnswer} handleFill={handleFill} getHint={getHint}
            goTo={goTo} C={C} card={card} btn={btn} inp={inp} pill={pill} />
        )}
        {view === "library" && (
          <LibraryView filteredWords={filteredWords} filter={filter} setFilter={setFilter}
            search={search} setSearch={setSearch} expandedCard={expandedCard} setExpandedCard={setExpandedCard}
            toggleLearned={toggleLearned} deleteWord={deleteWord}
            C={C} card={card} btn={btn} inp={inp} pill={pill} />
        )}
        {view === "badges" && (
          <BadgesView words={words} streak={streak} lastSession={lastSession} C={C} card={card} />
        )}
      </main>

      {/* Bottom nav */}
      <nav style={{ background: C.surface, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-around", padding: "8px 0 16px", position: "sticky", bottom: 0, zIndex: 100 }}>
        {NAV.map(n => {
          const active = view === n.id;
          return (
            <button key={n.id} onClick={() => goTo(n.id)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "4px 8px", color: active ? C.amber : C.muted, fontFamily: "inherit", position: "relative" }}>
              {n.id === "practice" && dueCount > 0 && !active && <div style={{ position: "absolute", top: 0, right: 4, width: 8, height: 8, background: C.purple, borderRadius: 99 }} />}
              <span style={{ fontSize: 18 }}>{n.icon}</span>
              <span style={{ fontSize: 10, fontWeight: 700 }}>{n.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Confirm dialog */}
      {confirm && (
        <div onClick={() => setConfirm(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={card({ maxWidth: 300, width: "90%", margin: "0 16px", padding: 24, border: `1px solid ${C.border}` })}>
            <h3 style={{ fontWeight: 900, fontSize: 16, marginBottom: 8 }}>{confirm.title}</h3>
            <p style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>{confirm.msg}</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirm(null)} style={btn(C.surface, C.muted, { flex: 1, border: `1px solid ${C.border}` })}>Cancel</button>
              <button onClick={() => { confirm.onYes(); setConfirm(null); }} style={btn("#f87171", "#fff", { flex: 1 })}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
