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
      ref: text, sourceRef: text, quote: text, subject: text,
      attribute: { type: 'string', enum: ['date', 'owner', 'budget', 'status'] },
      scope: text, value: text, validFrom: nullableText, validTo: nullableText,
    }), 8),
    relations: list(object({ claimRef: text, factId: text, type: { type: 'string', enum: ['contradiction', 'equivalent', 'revision'] } }), 24),
    relevantFactIds: list(text, 16),
  }),
  reviewNotes: list(object({ sourceRef: text, quote: text, comment: text }), 2),
});
