import { useState } from 'react';
import { ui } from '../core.js';
import { useStore } from '../store.js';
import { LESSONS } from '../lessons.js';

function Blocks({ blocks }) {
  return (
    <div className="prose">
      {blocks.map((b, i) => {
        if (b.h) return <h3 key={i}>{b.h}</h3>;
        if (b.list) return <ul key={i}>{b.list.map((li, j) => <li key={j}>{li}</li>)}</ul>;
        return <p key={i}>{b.p}</p>;
      })}
    </div>
  );
}

function Quiz({ lesson }) {
  const s = useStore(ui);
  const answers = (s.quiz[lesson.id] || {});
  const pick = (qi, oi) => {
    if (answers[qi] != null) return;
    const next = { ...answers, [qi]: oi };
    const allRight = lesson.quiz.every((q, i) => next[i] === q.answer);
    ui.set((st) => ({
      quiz: { ...st.quiz, [lesson.id]: next },
      lessonsDone: allRight ? { ...st.lessonsDone, [lesson.id]: true } : st.lessonsDone,
    }));
  };
  const reset = () => ui.set((st) => ({ quiz: { ...st.quiz, [lesson.id]: {} } }));
  const answered = Object.keys(answers).length;
  const wrong = lesson.quiz.some((q, i) => answers[i] != null && answers[i] !== q.answer);
  return (
    <div className="card">
      <h2>Check yourself</h2>
      <div className="quiz">
        {lesson.quiz.map((q, qi) => (
          <div className="q" key={qi}>
            <b>{q.q}</b>
            {q.options.map((o, oi) => {
              const chosen = answers[qi];
              const cls = chosen == null ? '' : oi === q.answer ? 'right' : oi === chosen ? 'wrong' : '';
              return (
                <button key={oi} className={`opt ${cls}`} disabled={chosen != null} onClick={() => pick(qi, oi)}>{o}</button>
              );
            })}
            {answers[qi] != null && <p className="why">{answers[qi] === q.answer ? 'Correct. ' : 'Not quite. '}{q.why}</p>}
          </div>
        ))}
      </div>
      {answered === lesson.quiz.length && (
        <div className="inline">
          <span className={wrong ? 'warn' : 'up'}>{wrong ? 'Some answers were wrong.' : 'Lesson complete.'}</span>
          {wrong && <button className="btn small" onClick={reset}>Try again</button>}
        </div>
      )}
    </div>
  );
}

export default function Learn() {
  const s = useStore(ui);
  const [id, setId] = useState(LESSONS[0].id);
  const lesson = LESSONS.find((l) => l.id === id);
  const done = LESSONS.filter((l) => s.lessonsDone[l.id]).length;

  const tryIt = () => {
    const t = lesson.tryIt;
    if (t.view) ui.set({ view: t.view });
    else ui.set((st) => ({ view: 'trade', symbol: t.symbol || st.symbol, tf: t.tf || st.tf, indicators: { ...st.indicators, ...(t.indicators || {}) } }));
  };

  return (
    <div className="page">
      <div className="page-in">
        <div>
          <h1>Learn to trade</h1>
          <p className="lead">Ten short lessons from the basics to risk management. Practise each one on the demo account as you go.</p>
          <div className="inline" style={{ marginTop: 10, maxWidth: 360 }}>
            <div className="progress" style={{ flex: 1 }}><i style={{ width: `${(done / LESSONS.length) * 100}%` }} /></div>
            <span className="mono muted">{done}/{LESSONS.length}</span>
          </div>
        </div>
        <div className="cols">
          <div className="lesson-list" role="list">
            {LESSONS.map((l, i) => (
              <button key={l.id} role="listitem" className={`lesson-item ${l.id === id ? 'on' : ''}`} onClick={() => setId(l.id)}>
                <b>{i + 1}. {l.title}</b>
                {s.lessonsDone[l.id] && <span className="tick" aria-label="Completed">✓</span>}
                <small>{l.level} · {l.minutes} min</small>
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <div className="card">
              <h2 style={{ fontSize: 20 }}>{lesson.title}</h2>
              <Blocks blocks={lesson.blocks} />
              <div className="bn" lang="bn"><b>সারকথা: </b>{lesson.bn}</div>
              <div className="inline">
                <button className="btn primary" onClick={tryIt}>{lesson.tryIt.label}</button>
              </div>
            </div>
            <Quiz lesson={lesson} key={lesson.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
