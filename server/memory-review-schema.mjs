const text = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (items, maxItems) => ({ type: 'array', items, ...(maxItems ? { maxItems } : {}) });

// Shape enforcement complements evidence validation; it cannot establish truth
// or prove that the model found every claim.
export const MEMORY_REVIEW_SCHEMA = object({
  answer: text,
  conflictQuestion: { type: 'null' },
  memoryAnalysis: object({
    claims: list(object({
      ref: text, sourceRef: text, quote: text, contextQuote: nullableText, subject: text,
      attribute: { type: 'string', minLength: 1, maxLength: 80 },
      scope: text, value: text, validFrom: nullableText, validTo: nullableText,
    }), 8),
    relations: list(object({ claimRef: text, factId: nullableText, targetClaimRef: nullableText,
      type: { type: 'string', enum: ['contradiction', 'equivalent', 'revision', 'compatible', 'uncertain'] } }), 24),
    relevantFactIds: list(text, 16),
    unreviewed: list(object({ sourceRef: text, quote: text, reason: text }), 16),
  }),
  reviewNotes: list(object({ sourceRef: text, quote: text, comment: text }), 2),
});
