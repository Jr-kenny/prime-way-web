# DESIGN.md — Prime Way Web (bridge surface)

## Direction contract

THESIS: One calm card does the whole job. A bridge is a money movement,
not a dashboard, so the surface refuses the category default of
stat-covered landing pages, feature grids and marketing sections. The
visitor arrives, connects a wallet, moves money, watches it land.
Nothing else competes for attention.

OWN-WORLD: Prime Way's own identity, already settled in the mobile
app: near-black ink on warm off-white ground, white surfaces, hairline
borders, one blue reserved for the single primary action and for live
states, tabular numerals for every amount, drawn SVG icons in one
stroke weight, no gradients, no glass, no glow, no decoration. The
PRIME wordmark with its straight road underneath is the only brand
mark. Restraint is the palette: neutrals tinted warm plus one accent.

STORY: The visitor understands in seconds that this moves real money
across chains through Relay, sees exactly what they send, what arrives,
what it costs and how long it takes, signs in their own wallet, and
watches each real stage complete. They believe it because every number
comes from a live Relay quote and every stage from a live status check.

FIRST VIEWPORT: Header, 64px: PRIME+road left, Bridge / Activity tabs
centre-right, Connect button right. Below, one centred 520px card:
From network + token + amount with balance and Max, a centre swap
control, To network + token + estimated receive, then a live quote
panel (rate, fees, time), then the single primary button (Connect
wallet / Review bridge / Bridge). No hero, no stats, no sections
below the card except a one-line footer. Primary action sits at the
bottom of the card, full width, always visible.

FORM: Code-led Operate surface. seed: none (pinned). Pinned in the
user's words: "a mature, deliberate, premium product interface" that
communicates "financial credibility, technical sophistication,
reliability, simplicity, precision, confidence", with "no generic
AI-generated gradients, no excessive glassmorphism, no random glowing
borders, no excessive rounded cards, no unnecessary floating elements,
no decorative shapes without purpose, no oversized empty spaces, no
repetitive sections, no emoji used as product icons, no arbitrary
animations, no generic dashboard layouts, no fake transaction
statistics, no placeholder content presented as real functionality".

FINISH: unreviewed and undocumented is unfinished; this build ends
with the finish review, the verdict, DESIGN.md, and every shipping
raster carrying its provenance.

## Tokens

- Ground `#F4F4F1`, surface `#FFFFFF`, raised `#FAFAF8`
- Border `#E3E3DE`, border-strong `#CFCFC7`
- Ink `#121210`, secondary `#5C5C56`, muted `#8A8A82`
- Accent `#2547F4`, accent-hover `#1B38C4`, accent-soft `#EAF0FF`
- Success `#147A3E` / `#E7F4EB`, warning `#8A5A00` / `#FFF3D6`,
  error `#B42318` / `#FDECEA`
- Radius: card 14px, control 10px, chip 8px
- Type: system stack, tabular numerals for amounts. Base 15px,
  small 13px, tiny 12px, amount 28px semibold, receive 20px.
- Spacing scale: 4 / 8 / 12 / 16 / 20 / 24 / 32.
- Shadow: card `0 1px 2px rgba(16,16,12,.05)`;
  modal `0 8px 24px rgba(16,16,12,.12)`.

## Component rules

- Every control is 48px tall, 10px radius, 1px border, same padding.
- Hover darkens the border; focus shows a 2px accent ring.
- Disabled is flat muted text, never a fake action.
- Errors name the problem and the recovery in plain words.
- Loading states are inline (spinner + words), never a skeleton page.
- Icons are drawn SVG, 20px, stroke 1.5, one weight throughout.
- Chain and token icons come from Relay (`iconUrl` / `logoURI`);
  a missing icon falls back to an initial letter, never a broken image.
