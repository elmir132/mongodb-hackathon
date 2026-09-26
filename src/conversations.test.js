import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, processPrompt } from './memory.js';
import { normalizeConversations, turnsForChat, titleConversation } from './conversations.js';
const persist = () => {};

test('legacy history migrates without losing replies, evidence, or traces', async () => {
  const old = await processPrompt(seedState(), 'When is the launch?', 'You', persist);
  const migrated = normalizeConversations(JSON.parse(JSON.stringify(old.state)));
  assert.equal(migrated.conversations.length, 1);
  assert.equal(turnsForChat(migrated)[0].answer, old.turn.answer);
  assert.deepEqual(turnsForChat(migrated)[0].trace, old.turn.trace);
  assert.deepEqual(migrated.facts, old.state.facts);
  assert.deepEqual(normalizeConversations(migrated), migrated);
});

test('chats isolate model history and correction targets but share project lessons', async () => {
  let state = normalizeConversations(seedState());
  const original = state.activeChatId;
  ({ state } = await processPrompt(state, 'The launch is Friday.', 'Marketing', persist));
  state = { ...state, activeChatId: 'second', conversations: [...state.conversations, { id: 'second', title: 'New chat' }] };
  let context;
  ({ state } = await processPrompt(state, 'The next release is Tuesday.', 'Marketing', persist, async value => { context = value; return { answer: 'Review', model: 'test' }; }));
  assert.equal(context.state.turns.length, 1);
  assert.equal(context.state.turns[0].chatId, 'second');
  assert.equal(context.state.facts.length, 4);
  state.activeChatId = original;
  ({ state } = await processPrompt(state, 'Engineering owns launch readiness for this project.', 'You', persist));
  assert.equal(turnsForChat(state).at(-1).selected.value, 'Monday, October 5th');
  state.activeChatId = 'second';
  const next = await processPrompt(state, 'When is the next release?', 'You', persist);
  assert.equal(next.turn.selected.value, 'Thursday');
  assert.ok(next.turn.applied);
  const restored = normalizeConversations(JSON.parse(JSON.stringify(next.state)));
  assert.equal(restored.activeChatId, 'second');
  assert.equal(turnsForChat(restored).length, 2);
  assert.equal(turnsForChat(restored, original).length, 2);
});

test('a provider failure retains the recorded turn in its originating chat', async () => {
  const state = normalizeConversations(seedState());
  let saved;
  await assert.rejects(processPrompt(state, 'Can you review this?', 'You', value => { saved = value; }, async () => { throw new Error('offline'); }), /offline/);
  assert.equal(saved.turns[0].chatId, state.activeChatId);
  assert.equal(saved.turns[0].answer, null);
  assert.equal(turnsForChat(saved, 'another-chat').length, 0);
});

test('new chats get a title from their first document or message', () => {
  const state = normalizeConversations(seedState());
  assert.equal(titleConversation(state, state.activeChatId, 'Review this', [{ name: 'Launch memo.md' }]).conversations[0].title, 'Launch memo');
  assert.equal(titleConversation(state, state.activeChatId, 'A quick question', []).conversations[0].title, 'A quick question');
});
