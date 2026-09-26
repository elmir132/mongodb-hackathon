// Conversation transcripts are separate; facts and lessons belong to the project.
export const DEFAULT_CHAT_ID = 'chat-original';
export const turnsForChat = (state, chatId = state.activeChatId) => state.turns.filter(turn => (turn.chatId || DEFAULT_CHAT_ID) === chatId);
export function normalizeConversations(state) {
  const conversations = state.conversations?.length ? [...state.conversations] : [{ id: DEFAULT_CHAT_ID, title: state.turns.length ? 'Launch memo review' : 'New chat' }];
  for (const turn of state.turns) {
    const id = turn.chatId || DEFAULT_CHAT_ID;
    if (!conversations.some(chat => chat.id === id)) conversations.push({ id, title: turn.prompt.slice(0, 48) || 'Conversation' });
  }
  const activeChatId = conversations.some(chat => chat.id === state.activeChatId) ? state.activeChatId : conversations[0].id;
  return { ...state, conversations, activeChatId, turns: state.turns.map(turn => ({ ...turn, chatId: turn.chatId || DEFAULT_CHAT_ID })) };
}
export function titleConversation(state, chatId, prompt, attachments) {
  if (turnsForChat(state, chatId).length) return state;
  const title = (attachments[0]?.name.replace(/\.(md|txt)$/i, '') || prompt).replace(/\s+/g, ' ').slice(0, 48);
  return { ...state, conversations: state.conversations.map(chat => chat.id === chatId ? { ...chat, title } : chat) };
}
