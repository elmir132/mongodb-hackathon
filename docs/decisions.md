# User decision log

Recorded September 26, 2026 from the product-design conversation. This records decisions and their supersession, rather than creating a second specification. [proposal.md](proposal.md) defines scope and ownership; [demo-flow.md](demo-flow.md) defines the current experience; [AGENTS.md](../AGENTS.md) guides future coding sessions.

## Decisions in conversation order

| ID | User decision | Current interpretation |
| --- | --- | --- |
| D01 | Build a fake version based on the repository to show what the product could look like. | An illustrative frontend is authorized. Label examples and distinguish demonstrated local behavior from unconnected production services. |
| D02 | Remove roughly 90% of the initial presentation: “less is more.” Keep the product name at the top and barely anything else. | Default to a minimal terminal. Reveal supporting detail deliberately. The percentage expresses design intent, not a numerical acceptance test. |
| D03 | Place an AI terminal in space with connections whose destinations are initially outside the view. Reveal information moving through those connections. | The terminal is the entry point; reveal the spatial network through the later explicit replay action (D07). |
| D04 | Make information flow dynamic based on the input, using glowing dots that can be tracked as they move and interact with conflicting information. | Animate recorded operations for that request, including saves and conflicts when present. Do not play an identical conflict story for every prompt or invent internal model reasoning. |
| D05 | Keep elements close together; start with the terminal filling most of the screen, then zoom out until it is about 20% so other elements and all paths are visible. | Keep destinations nearby and routes completely visible. D07 supersedes zooming automatically when a prompt is submitted. |
| D06 | Show saving explicitly. Marketing contributes new information, discovers a conflict, and resolves it. | Include original document/fact persistence and resolution persistence. D12 refines the entry into a natural memo review. |
| D07 | First ask the question and get the answer; then press a demo button to replay the internal information flow. | Conversation stays in the large terminal. Optional replay uses the completed request's recorded events without repeating writes or model calls. This replaces automatic processing-time camera movement. |
| D08 | The terminal must feel usable, with consistent margins all around, and work with any prompt. | Keep usable conversation, composer, scrolling, and equal outer padding. General responses use a real model; limited demo extraction is not universal understanding. |
| D09 | Stop using the Claude logo as Chronicle's logo: “we don't have a logo.” | Use the plain product name. Do not invent a brand mark or repurpose a provider symbol. |
| D10 | Update each part's internal functions as real services are supplied. Use floating elements with different depth and perspective to reveal layers. The existing bones are useful, but the current view is too simplified. | Evolve the compact scene toward service-specific operations with readable depth. A visual station does not establish a real integration. |
| D11 | Use OpenAI, with the user's Codex access for this demo. Show a model selector including Claude, and allow API-token connections to providers. | The demo may use the installed, signed-in Codex CLI. Provide model/provider selection and key connections. Provider flexibility is the goal; distinguish supported protocols from verified connections. |
| D12 | Make the demo natural: Marketing uploads a memo for AI review; it happens to say Friday. Compare it with something learned from Engineering a while ago. | Use a full memo with an incidental date and separately stored older Engineering evidence. The user need not name the conflict or supply both claims. Cite the older source and review the rest of the memo too. This replaces the contrived “Marketing says X, Engineering says Y” opening. |
| D13 | Log the chat decisions, apply them to docs and agents, pull the newest GitHub work, and push local changes. | Maintain this log and the canonical docs/AGENTS.md, preserve teammates' changes, and publish the current work on the existing repository branch. |

Later explicit refinements control whenever earlier requests conflict.

## Existing project decisions retained

The canonical docs already require one shared view for a 60-second first round and a five-minute finalist presentation; the complete correction → scoped precedent/policy update → reuse loop; and the existing ownership: Elmir owns resolution, Sahil owns storage/transport and hosts retrieval, Danny owns core retrieval and orchestration, and Maxime owns the frontend. Preserve prior facts and policies, distinguish retrieved candidates from evidence actually used, and verify persistence and scope. The interface direction does not reassign those responsibilities.

## Implementation choices, not additional user decisions

React/Vite, browser-local memory, CSS perspective and SVG paths, a temporary local rule adapter, `.txt`/`.md` attachments up to 100 KB, and a labeled example memo are current implementation choices. The sample dates, Atlas launch copy, specific model IDs, four visual stations, and API adapter details are not user mandates or proof of the integrated MVP.

Codex generation was tested live. API adapters require keys and separate verification. Atlas, Voyage, Vector Search, and backend event delivery are not connected to this frontend. Elmir's standalone Python resolution engine is present after syncing GitHub; its presence is distinct from frontend integration.

## Keeping this record current

Append subsequent decisions with their date and mark what they supersede. Apply them to the canonical docs and AGENTS.md in the same change. Preserve the original team proposal archive. Keep requirements, implementation choices, and verified capabilities distinct.
