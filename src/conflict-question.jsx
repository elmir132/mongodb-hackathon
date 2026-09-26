import React, { useState } from 'react';
import AutoTextarea from './auto-textarea.jsx';
import { sourceLabel } from './memory.js';
import { canRememberAuthority, authorityLabel, fallbackConflictQuestion } from './conflict-review.js';
import './conflict-question.css';

export default function ConflictQuestion({ turn, busy, error, onAnswer, onDismiss }) {
  const [choice, setChoice] = useState('');
  const [reason, setReason] = useState('');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const selected = turn.candidates.find(fact => fact.id === choice);
  const canRemember = canRememberAuthority(turn, selected);
  const titleId = `conflict-title-${turn.id}`;
  const reasonId = `conflict-reason-${turn.id}`;
  const sourcesId = `conflict-sources-${turn.id}`;
  return <section className="conflict-question" aria-labelledby={titleId} onKeyDown={event => { if (event.key === 'Escape' && sourcesOpen) { event.stopPropagation(); setSourcesOpen(false); } }}>
    {sourcesOpen && <div className="conflict-sources" id={sourcesId} role="region" aria-label="Context files">
      {turn.candidates.map(fact => <div className="conflict-evidence" key={fact.id}><strong>{sourceLabel(fact)} · {fact.value}</strong><span>{fact.document || 'Project update'}{fact.sourceDate ? ` · ${fact.sourceDate}` : ''}</span><p>{fact.text?.replace(/^#{1,6}\s+/gm, '')}</p></div>)}
    </div>}
    <div className="conflict-question-content">
    <h3 id={titleId}>{(turn.conflictQuestion || fallbackConflictQuestion(turn.subject, turn.candidates))?.question}</h3>
    <form onSubmit={event => { event.preventDefault(); if (choice) onAnswer({ conflictTurnId: turn.id, factId: choice === 'unresolved' ? null : choice, reason: reason.trim(), rememberAuthority: canRemember && remember }); }}>
      <button className="conflict-sources-toggle" type="button" aria-expanded={sourcesOpen} aria-controls={sourcesId} onClick={() => setSourcesOpen(open => !open)}>{sourcesOpen ? 'Hide context files' : 'Show context files'} <span aria-hidden="true">{sourcesOpen ? '⌄' : '⌃'}</span></button>
      <fieldset disabled={busy}><legend className="sr-only">Resolve this conflict</legend>
        {turn.candidates.map(fact => <label className="conflict-option" key={fact.id}>
          <input type="radio" name={`conflict-choice-${turn.id}`} value={fact.id} checked={choice === fact.id} onChange={() => { setChoice(fact.id); setRemember(false); }}/>
          <span><strong>{fact.value}</strong><span className="conflict-source">{sourceLabel(fact)}{turn.selected?.id === fact.id ? turn.applied ? ' · Saved lesson' : ' · Current choice' : ''}</span></span>
        </label>)}
        <label className="conflict-option"><input type="radio" name={`conflict-choice-${turn.id}`} value="unresolved" checked={choice === 'unresolved'} onChange={() => setChoice('unresolved')}/><span><strong>Leave unresolved</strong><span className="conflict-source">I need more information</span></span></label>
      </fieldset>
      {canRemember && <label className="conflict-remember"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} disabled={busy}/><span>{authorityLabel(turn, selected)}</span></label>}
      <label className="sr-only" htmlFor={reasonId}>Additional context</label>
      <AutoTextarea id={reasonId} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} placeholder="Add context (optional)…" rows={1}/>
      {error && <p className="storage-error" role="alert">{error}</p>}
      <div className="conflict-question-actions"><button type="button" disabled={busy} onClick={onDismiss}>Skip for now</button><button type="submit" disabled={busy || !choice}>{busy ? 'Saving…' : 'Submit answer'}</button></div>
    </form>
    </div>
  </section>;
}
