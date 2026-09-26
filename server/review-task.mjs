// Shared by request construction and response composition. Source transformations
// must survive a memory finding, but cannot select the project's source of truth.
export function reviewTask(prompt, attachments = []) {
  const request = String(prompt).trim();
  const transform = /\b(?:translate|summari[sz]e|rewrite|rephrase)\b/i.exec(request);
  if (transform && (attachments.length || /[:“"\n]/.test(request))) {
    const kind = /^trans/i.test(transform[0]) ? 'translation' : /^summ/i.test(transform[0]) ? 'summary' : 'rewrite';
    return { kind, sourceTask: true, label: { translation: 'Translation of supplied text', summary: 'Summary of supplied text', rewrite: 'Rewrite of supplied text' }[kind] };
  }
  return { kind: attachments.length && /\b(?:review|check|feedback|critique|before I (?:share|send))\b/i.test(request) ? 'review' : 'answer', sourceTask: false };
}
