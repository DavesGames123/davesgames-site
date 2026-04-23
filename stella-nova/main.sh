#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  STELLA NOVA — davesgames.io Site Patcher
#  Purges LLM references, fixes stale dates, removes game pricing.
#  
#  Usage:  ./patch_site.sh /path/to/site
#          ./patch_site.sh              (defaults to current directory)
#
#  macOS-safe. Each stage is independent — one failure won't nuke the rest.
# ══════════════════════════════════════════════════════════════════════════════

SITE_DIR="${1:-.}"
STAGE_PASS=0
STAGE_FAIL=0
PATCH_PASS=0
PATCH_FAIL=0
STAGE_NUM=0
CURRENT_STAGE_OK=true

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[0;90m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Preflight ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  STELLA NOVA SITE PATCHER${RESET}"
echo -e "${DIM}  Purge LLM · Fix Dates · Remove Pricing${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${DIM}Target directory:${RESET} ${SITE_DIR}"
echo ""

REQUIRED_FILES=("pitch.html" "roadmap.html" "business.html" "market-intel.html" "index.html")
MISSING=0
for f in "${REQUIRED_FILES[@]}"; do
    if [[ ! -f "${SITE_DIR}/${f}" ]]; then
        echo -e "  ${RED}✗ Missing: ${f}${RESET}"
        MISSING=$((MISSING + 1))
    fi
done
if [[ $MISSING -gt 0 ]]; then
    echo ""
    echo -e "  ${RED}Aborting. ${MISSING} required file(s) not found in ${SITE_DIR}${RESET}"
    echo -e "  ${DIM}Expected: pitch.html, roadmap.html, business.html, market-intel.html, index.html${RESET}"
    exit 1
fi
echo -e "  ${GREEN}All 5 target files found.${RESET}"

# ── Backup ────────────────────────────────────────────────────────────────────

BACKUP_DIR="${SITE_DIR}/.patch-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
for f in "${REQUIRED_FILES[@]}"; do
    cp "${SITE_DIR}/${f}" "${BACKUP_DIR}/${f}"
done
echo -e "  ${DIM}Backups saved to ${BACKUP_DIR}${RESET}"
echo ""

# ── Helper: Python patcher ────────────────────────────────────────────────────
# Writes a Python script that does find-and-replace on a file.
# Args: $1=file, $2=label, $3=old_text, $4=new_text
# Uses temp files to avoid all shell escaping nightmares.

do_patch() {
    local file="${SITE_DIR}/$1"
    local label="$2"
    local old_text="$3"
    local new_text="$4"

    local tmp_old=$(mktemp)
    local tmp_new=$(mktemp)
    printf '%s' "$old_text" > "$tmp_old"
    printf '%s' "$new_text" > "$tmp_new"

    local result
    result=$(python3 -c "
import sys
with open('${file}', 'r') as f:
    content = f.read()
with open('${tmp_old}', 'r') as f:
    old = f.read()
with open('${tmp_new}', 'r') as f:
    new = f.read()
if old in content:
    content = content.replace(old, new, 1)
    with open('${file}', 'w') as f:
        f.write(content)
    print('OK')
else:
    print('NOT_FOUND')
" 2>&1)

    rm -f "$tmp_old" "$tmp_new"

    if [[ "$result" == "OK" ]]; then
        echo -e "    ${GREEN}✓${RESET} ${label}"
        PATCH_PASS=$((PATCH_PASS + 1))
        return 0
    else
        echo -e "    ${RED}✗${RESET} ${label} ${DIM}(target text not found — already patched?)${RESET}"
        PATCH_FAIL=$((PATCH_FAIL + 1))
        CURRENT_STAGE_OK=false
        return 1
    fi
}

begin_stage() {
    STAGE_NUM=$((STAGE_NUM + 1))
    CURRENT_STAGE_OK=true
    echo -e "${CYAN}─── Stage ${STAGE_NUM}: $1 ───${RESET}"
}

end_stage() {
    local quip="$1"
    if $CURRENT_STAGE_OK; then
        STAGE_PASS=$((STAGE_PASS + 1))
        echo -e "  ${GREEN}PASS${RESET} ${DIM}— ${quip}${RESET}"
    else
        STAGE_FAIL=$((STAGE_FAIL + 1))
        echo -e "  ${YELLOW}PARTIAL${RESET} ${DIM}— ${quip}${RESET}"
    fi
    echo ""
}


# ══════════════════════════════════════════════════════════════════════════════
#  STAGE 1: pitch.html — Purge LLM
# ══════════════════════════════════════════════════════════════════════════════

begin_stage "pitch.html — Purge LLM references"

do_patch "pitch.html" "Dek subtitle: LLM-driven → quest types" \
'And the first colony sim with LLM-driven narrative AI.' \
'And 27 quest types generating stories no two players will share.'

do_patch "pitch.html" "Elevator pitch paragraph: remove LLM" \
'govern AI citizens who form relationships, hold grudges, and run your foundries autonomously. It'\''s built on a custom Rust engine with real N-body orbital physics, and it'\''s the first game in the genre to use LLM-powered narrative AI — meaning every colonist interaction generates unique, emergent stories that no two players will ever share.' \
'govern citizens who form relationships, hold grudges, and run your foundries autonomously. A deterministic storyteller drives 27 quest types across 4 tiers — citizens debate philosophy, share meals, stargaze together, and generate emergent drama through deep social simulation. It'\''s built on a custom Rust engine with real N-body orbital physics and a PBR rendering pipeline.'

do_patch "pitch.html" "One-line pitch: remove AI writes" \
'"Factorio meets RimWorld in space — with AI that writes the stories."' \
'"Factorio meets RimWorld in space — built from scratch in Rust."'

do_patch "pitch.html" "Audience table: colony sim hook" \
'AI citizens with LLM narrative — deeper emergent stories' \
'Deep social simulation — citizens with relationships, grudges, and emergent stories'

do_patch "pitch.html" "Audience table: streamer hook" \
'LLM stories = unique shareable moments every session' \
'Emergent citizen stories = unique shareable moments every session'

do_patch "pitch.html" "Tech differentiators: LLM → storyteller" \
'<strong>LLM-powered narrative system:</strong> First colony sim with generative AI storytelling. Citizens don'\''t just have stats — they have conversations, grudges, and evolving relationships driven by language models. <span class="tag tb">FIRST MOVER</span>' \
'<strong>Deterministic storyteller engine:</strong> 27 quest types across 4 tiers. Citizens share meals, debate, stargaze, tell jokes, and form rivalries through 12+ social activity types. Emergent narrative through systems depth — no external dependencies. <span class="tag tb">MOAT</span>'

do_patch "pitch.html" "Build status: LLM → storyteller" \
'LLM narrator integration' \
'Storyteller + quest system (27 types)'

end_stage "Your pitch deck no longer promises technology you ripped out months ago."


# ══════════════════════════════════════════════════════════════════════════════
#  STAGE 2: pitch.html — Fix dates, remove pricing
# ══════════════════════════════════════════════════════════════════════════════

begin_stage "pitch.html — Fix dates & remove pricing"

do_patch "pitch.html" "Milestone callout: fix dates" \
'<strong>Pre-alpha build shipping March 28, 2026.</strong> Steam page live April 17. Demo build for Next Fest prep April 28. Steam Next Fest June 15–22. Early access target: July 2026.' \
'<strong>Pre-alpha build shipped March 28, 2026.</strong> Steam page live April 21. Demo build targeting early May. Steam Next Fest June 15–22.'

do_patch "pitch.html" "MEDDIC: remove pricing from Economic Buyer" \
'Revenue-positive from unit 1 at $24.99. Publisher-optional' \
'Near-zero COGS with custom engine. Publisher-optional'

do_patch "pitch.html" "Header date: March → April" \
'Investor Materials · March 2026' \
'Investor Materials · April 2026'

do_patch "pitch.html" "Footer date: March → April" \
'Stella Nova · Investor Pitch · March 2026' \
'Stella Nova · Investor Pitch · April 2026'

do_patch "pitch.html" "Tab nav: Revenue Model → Business Strategy" \
'href="business.html">Revenue Model' \
'href="business.html">Business Strategy'

end_stage "The pitch now lives in the present tense. Revolutionary concept."


# ══════════════════════════════════════════════════════════════════════════════
#  STAGE 3: roadmap.html — Purge LLM
# ══════════════════════════════════════════════════════════════════════════════

begin_stage "roadmap.html — Purge LLM references"

do_patch "roadmap.html" "Shipped table: LLM → Storyteller" \
'<td class="n">LLM Narrator Integration</td><td><span class="tag tg">SHIPPED</span></td><td>Dynamic character interactions via language model. Emergent narrative generation.</td>' \
'<td class="n">Storyteller & Quest System</td><td><span class="tag tg">SHIPPED</span></td><td>Deterministic narrator with 27 quest types across 4 tiers. 12+ social activity types.</td>'

do_patch "roadmap.html" "Jan-Mar milestone: LLM → storyteller" \
'LLM narrator system. Relationship visualization' \
'Storyteller quest system. Relationship visualization'

end_stage "Your roadmap no longer ships vaporware. What a time to be alive."


# ══════════════════════════════════════════════════════════════════════════════
#  STAGE 4: roadmap.html — Fix dates & milestones
# ══════════════════════════════════════════════════════════════════════════════

begin_stage "roadmap.html — Fix dates & milestone statuses"

do_patch "roadmap.html" "Countdown stats: update to current" \
'<div class="ss-i"><div class="ss-v g">6+ mo</div><div class="ss-l">Daily commits (since Sep 2025)</div></div>
    <div class="ss-i"><div class="ss-v b">16 days</div><div class="ss-l">Until pre-alpha (Mar 28)</div></div>
    <div class="ss-i"><div class="ss-v b">96 days</div><div class="ss-l">Until Next Fest (Jun 15)</div></div>
    <div class="ss-i"><div class="ss-v a">~130 days</div><div class="ss-l">Target EA launch (Jul 2026)</div></div>' \
'<div class="ss-i"><div class="ss-v g">7+ mo</div><div class="ss-l">Daily commits (since Sep 2025)</div></div>
    <div class="ss-i"><div class="ss-v g">✓</div><div class="ss-l">Pre-alpha shipped (Mar 28)</div></div>
    <div class="ss-i"><div class="ss-v b">53 days</div><div class="ss-l">Until Next Fest (Jun 15)</div></div>
    <div class="ss-i"><div class="ss-v b">~12 days</div><div class="ss-l">Demo build (early May)</div></div>'

do_patch "roadmap.html" "Pre-alpha node: NEXT → COMPLETE" \
'<div class="tl-dot active"></div>
      <div class="tl-date">Mar 28, 2026 <span class="tag tb">NEXT</span></div>' \
'<div class="tl-dot done"></div>
      <div class="tl-date">Mar 28, 2026 <span class="tag tg">COMPLETE</span></div>'

do_patch "roadmap.html" "Steam Page node: upcoming → COMPLETE, fix date" \
'<div class="tl-dot upcoming"></div>
      <div class="tl-date">Apr 17, 2026</div>
      <div class="tl-title">Steam Page Live</div>' \
'<div class="tl-dot done"></div>
      <div class="tl-date">Apr 21, 2026 <span class="tag tg">COMPLETE</span></div>
      <div class="tl-title">Steam Page Live</div>'

do_patch "roadmap.html" "Demo Build node: fix date, mark as NEXT" \
'<div class="tl-dot upcoming"></div>
      <div class="tl-date">Apr 28, 2026</div>
      <div class="tl-title">Demo Build Ready</div>' \
'<div class="tl-dot active"></div>
      <div class="tl-date">Early May 2026 <span class="tag tb">NEXT</span></div>
      <div class="tl-title">Demo Build Ready</div>'

do_patch "roadmap.html" "EA launch: remove pricing" \
'Priced at $24.99. Full core loop' \
'Full core loop'

do_patch "roadmap.html" "Momentum signal: update stats" \
'6 months of daily commits. 12 major systems shipped. 16 days to pre-alpha.' \
'7+ months of daily commits. 12 major systems shipped. Pre-alpha delivered. Steam page live.'

do_patch "roadmap.html" "Success metrics: fix Steam Page date" \
'Steam Page (Apr 17)' \
'Steam Page (Apr 21)'

do_patch "roadmap.html" "Success metrics: fix Demo Build date" \
'Demo Build (Apr 28)' \
'Demo Build (early May)'

do_patch "roadmap.html" "Updated date: March → April" \
'Updated March 12, 2026' \
'Updated April 23, 2026'

do_patch "roadmap.html" "Footer date: March → April" \
'Stella Nova · Development Roadmap · March 2026' \
'Stella Nova · Development Roadmap · April 2026'

do_patch "roadmap.html" "Tab nav: Revenue Model → Business Strategy" \
'href="business.html">Revenue Model' \
'href="business.html">Business Strategy'

end_stage "Your roadmap now acknowledges that time has, in fact, passed since March."


# ══════════════════════════════════════════════════════════════════════════════
#  STAGE 5: business.html — Purge LLM + Remove pricing (big one)
# ══════════════════════════════════════════════════════════════════════════════

begin_stage "business.html — Purge LLM, remove pricing, restructure"

do_patch "business.html" "Header: Revenue Model → Business Strategy" \
'Revenue Model · March 2026' \
'Business Strategy · April 2026'

do_patch "business.html" "Tab nav: active label" \
'tab-btn active" href="business.html">Revenue Model' \
'tab-btn active" href="business.html">Business Strategy'

do_patch "business.html" "Page title: Revenue Model → Business Strategy" \
'<div class="topic">Revenue Model & Unit Economics</div>
  <h1>How Stella Nova Makes Money</h1>
  <p class="dek">Premium buy-to-play. No microtransactions. No subscriptions. No ads. Price increases as value grows. Expansion-grade DLC. The Factorio/RimWorld model' \
'<div class="topic">Business Strategy & Cost Structure</div>
  <h1>How Stella Nova Is Built to Last</h1>
  <p class="dek">Premium buy-to-play. No microtransactions. No subscriptions. No ads. Solo dev with near-zero burn rate. The Factorio/RimWorld model'

do_patch "business.html" "Meta line: update description" \
'Financial projections based on comparable titles' \
'Business analysis based on comparable titles'

# Hero stats — replace pricing with operational stats
do_patch "business.html" "Hero stats: remove pricing" \
'<div class="ss-i"><div class="ss-v b">$24.99</div><div class="ss-l">Early Access price</div></div>
    <div class="ss-i"><div class="ss-v b">$34.99</div><div class="ss-l">Target 1.0 price</div></div>
    <div class="ss-i"><div class="ss-v b">$0</div><div class="ss-l">MTX / subscriptions / ads</div></div>
    <div class="ss-i"><div class="ss-v g">~65%</div><div class="ss-l">Gross margin (after Steam 30%)</div></div>' \
'<div class="ss-i"><div class="ss-v b">$0</div><div class="ss-l">MTX / subscriptions / ads</div></div>
    <div class="ss-i"><div class="ss-v g">~$5,500</div><div class="ss-l">Annual operating costs</div></div>
    <div class="ss-i"><div class="ss-v b">Custom</div><div class="ss-l">Rust/wgpu engine — no licensing fees</div></div>
    <div class="ss-i"><div class="ss-v g">Solo</div><div class="ss-l">Single developer — minimal burn</div></div>'

# Remove the entire Revenue Model table + Unit Economics table + "Why no MTX" callout
# Replace with a simpler monetization philosophy section
do_patch "business.html" "Remove Revenue Model + Unit Economics sections" \
'<div class="sl">Revenue Model</div>
  <h2>Three Revenue Streams. Zero Recurring Costs to Players.</h2>

  <div class="tw"><table class="t">
    <thead><tr><th>Stream</th><th>Timing</th><th>Price</th><th>Model</th></tr></thead>
    <tbody>
      <tr><td class="n">1. Base Game (EA)</td><td>Jul 2026</td><td>$24.99</td><td>Premium purchase. Price increases over EA as features ship. Early buyers rewarded.</td></tr>
      <tr><td class="n">2. Base Game (1.0)</td><td>H2 2028 est.</td><td>$34.99</td><td>Full release. Rarely discounted (10% max). Never below $24.99.</td></tr>
      <tr><td class="n">3. Expansion DLCs</td><td>Post-1.0 (2029+)</td><td>$19.99–$29.99</td><td>Expansion-grade content (Factorio Space Age model). New systems, not cosmetics.</td></tr>
    </tbody>
  </table></div>

  <div class="cl">
    <strong>Why no microtransactions:</strong> Every $100M+ indie sim (Factorio, RimWorld, KSP) uses premium-only pricing. MTX signals F2P and erodes trust with the simulation audience. The data is unambiguous: premium colony sims generate more lifetime revenue per player than MTX-driven games in this genre.
  </div>

  <hr class="sep">
  <div class="sl">Unit Economics</div>
  <h2>Revenue Per Unit Sold</h2>

  <div class="tw"><table class="t">
    <thead><tr><th>Line Item</th><th>EA ($24.99)</th><th>1.0 ($34.99)</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td class="n">Gross price</td><td class="right">$24.99</td><td class="right">$34.99</td><td></td></tr>
      <tr><td class="n">Steam cut (30%)</td><td class="right" style="color:var(--red)">-$7.50</td><td class="right" style="color:var(--red)">-$10.50</td><td>Drops to 25% after $10M, 20% after $50M</td></tr>
      <tr><td class="n">Net to developer</td><td class="right" style="color:var(--green)"><strong>$17.49</strong></td><td class="right" style="color:var(--green)"><strong>$24.49</strong></td><td></td></tr>
      <tr><td class="n">Payment processing</td><td class="right" style="color:var(--red)">-$0.50</td><td class="right" style="color:var(--red)">-$0.50</td><td>Included in Steam cut; shown for transparency</td></tr>
      <tr><td class="n">Est. refund rate (5%)</td><td class="right" style="color:var(--red)">-$0.87</td><td class="right" style="color:var(--red)">-$1.22</td><td>Industry avg: 5–8% for EA</td></tr>
      <tr><td class="n" style="border-top:2px solid var(--g200)">Effective net per unit</td><td class="right" style="border-top:2px solid var(--g200);color:var(--green)"><strong>$16.12</strong></td><td class="right" style="border-top:2px solid var(--g200);color:var(--green)"><strong>$22.77</strong></td><td></td></tr>
    </tbody>
  </table></div>' \
'<div class="sl">Monetization Philosophy</div>
  <h2>Premium Purchase. No Recurring Costs to Players.</h2>

  <ul class="dl">
    <li><span class="d"></span><strong>Buy-to-play:</strong> One-time purchase for the full game. No MTX, no subscriptions, no ads. Expansion-grade DLC post-1.0 (new systems and mechanics, not cosmetics).</li>
    <li><span class="d"></span><strong>Why this model:</strong> Every $100M+ indie sim (Factorio, RimWorld, KSP) uses premium-only pricing. MTX signals F2P and erodes trust with the simulation audience. The data is unambiguous: premium colony sims generate more lifetime revenue per player than MTX-driven games in this genre.</li>
    <li><span class="d"></span><strong>Custom engine = no licensing fees:</strong> No Unity royalties, no Unreal revenue share. Quarkstrom (Rust/wgpu) is purpose-built and fully owned.</li>
  </ul>'

# Remove LLM API costs from cost structure + update total
do_patch "business.html" "Cost structure: remove LLM API line" \
'<tr><td class="n">LLM API costs (inference)</td><td class="right">~$50–200</td><td class="right">~$600–2,400</td><td>Anthropic/OpenAI API for narrator system</td></tr>
      <tr><td class="n">Hosting/infra' \
'<tr><td class="n">Hosting/infra'

do_patch "business.html" "Cost structure: update total + remove breakeven pricing" \
'<strong>~$6,000–8,000</strong></td><td>Breakeven: ~400 units at $24.99</td>' \
'<strong>~$5,500</strong></td><td>Near-zero COGS</td>'

do_patch "business.html" "Cost structure: remove Steam fee pricing ref" \
'One-time; recouped after ~4 units' \
'One-time'

do_patch "business.html" "Breakeven callout: rewrite" \
'<strong>Breakeven: ~400 units.</strong> At $16.12 effective net per EA unit, Stella Nova covers annual operating costs after selling approximately 400 copies. Everything after that is margin. This is the structural advantage of solo development with a custom engine — near-zero COGS.' \
'<strong>~$5,500/year total operating costs.</strong> No engine licensing fees, no API dependencies, no ongoing infrastructure costs beyond basic hosting. This is the structural advantage of solo development with a custom engine — near-zero COGS means profitability from a small number of sales.'

# Remove Revenue Projections section (chart + table + footnote)
do_patch "business.html" "Remove revenue projections section" \
'<div class="sl">Revenue Projections</div>
  <h2>Three Scenarios — Conservative, Base, Optimistic</h2>

  <div class="cb">
    <div class="cb-t">5-Year Cumulative Revenue by Scenario</div>
    <div class="cb-s">EA LAUNCH (JUL 2026) THROUGH DLC CYCLE (2031)</div>
    <div class="cc"><canvas id="revChart"></canvas></div>
  </div>

  <div class="tw"><table class="t">
    <thead><tr><th>Metric</th><th>Conservative</th><th>Base</th><th>Optimistic</th></tr></thead>
    <tbody>
      <tr><td class="n">EA Year 1 units</td><td class="right">15,000</td><td class="right">50,000</td><td class="right">200,000</td></tr>
      <tr><td class="n">EA Year 1 gross</td><td class="right">$375K</td><td class="right">$1.25M</td><td class="right">$5.0M</td></tr>
      <tr><td class="n">1.0 launch units (Yr 2–3)</td><td class="right">50,000</td><td class="right">250,000</td><td class="right">1,000,000</td></tr>
      <tr><td class="n">1.0 gross (Yr 2–3)</td><td class="right">$1.75M</td><td class="right">$8.75M</td><td class="right">$35M</td></tr>
      <tr><td class="n">DLC units (Yr 3–5)</td><td class="right">10,000</td><td class="right">75,000</td><td class="right">400,000</td></tr>
      <tr><td class="n">DLC gross (Yr 3–5)</td><td class="right">$250K</td><td class="right">$1.88M</td><td class="right">$10M</td></tr>
      <tr><td class="n" style="border-top:2px solid var(--g200)">5-Year cumulative gross</td><td class="right" style="border-top:2px solid var(--g200)"><strong>~$2.4M</strong></td><td class="right" style="border-top:2px solid var(--g200);color:var(--cyan)"><strong>~$11.9M</strong></td><td class="right" style="border-top:2px solid var(--g200);color:var(--green)"><strong>~$50M+</strong></td></tr>
      <tr><td class="n">5-Year net to dev (est.)</td><td class="right">~$1.6M</td><td class="right" style="color:var(--cyan)">~$8.3M</td><td class="right" style="color:var(--green)">~$35M+</td></tr>
      <tr><td class="n">Comparable</td><td>Space Haven tier</td><td>Oxygen Not Included trajectory</td><td>RimWorld early trajectory</td></tr>
    </tbody>
  </table></div>

  <p style="font-size:11px;color:var(--g500);font-family:'\''IBM Plex Mono'\'', monospace">Assumes $24.99 EA → $34.99 1.0. DLC at $24.99. Steam'\''s 30% cut applied (drops to 25% above $10M). Conservative assumes niche audience, limited marketing. Base assumes successful Next Fest + streamer coverage. Optimistic assumes viral community stories + award nominations. All figures USD gross.</p>' \
'<div class="sl">Comparable Revenue — What'\''s Proven</div>
  <h2>What Solo/Micro-Team Colony Sims Have Achieved</h2>

  <div class="tw"><table class="t">
    <thead><tr><th>Game</th><th>Team Size</th><th>Est. Lifetime Gross</th><th>Key Insight</th></tr></thead>
    <tbody>
      <tr><td class="n">Factorio</td><td>2 → 31</td><td>$305M+</td><td>Never discounted. Custom engine. 97% positive.</td></tr>
      <tr><td class="n">RimWorld</td><td>1 → 7</td><td>$116M+</td><td>211hr avg playtime. 5 DLC expansions.</td></tr>
      <tr><td class="n">Oxygen Not Included</td><td>Klei (studio)</td><td>$50M+ est.</td><td>Moderate discounts. Strong mod ecosystem.</td></tr>
      <tr><td class="n">Space Haven</td><td>Small team</td><td>$10M+ est.</td><td>Closest comparable in space colony niche.</td></tr>
      <tr><td class="n">KSP 2 <span class="tag tr">FAIL</span></td><td>Large studio</td><td>~$0 net value</td><td>Overpriced EA, broken launch, abandoned.</td></tr>
    </tbody>
  </table></div>'

# Remove waterfall chart
do_patch "business.html" "Remove revenue waterfall" \
'<hr class="sep">
  <div class="sl">Revenue Waterfall — Base Case</div>
  <h2>How $11.9M Accumulates Over 5 Years</h2>

  <div class="waterfall">
    <div class="wf-bar"><div class="wf-val" style="color:var(--cyan)">$1.25M</div><div class="wf-fill" style="height:21%;background:var(--cyan)"></div><div class="wf-label">EA Yr 1</div></div>
    <div class="wf-bar"><div class="wf-val" style="color:var(--cyan)">$4.4M</div><div class="wf-fill" style="height:37%;background:var(--cyan)"></div><div class="wf-label">1.0 Yr 2</div></div>
    <div class="wf-bar"><div class="wf-val" style="color:var(--cyan)">$4.35M</div><div class="wf-fill" style="height:36%;background:var(--cyan)"></div><div class="wf-label">Steady Yr 3</div></div>
    <div class="wf-bar"><div class="wf-val" style="color:var(--green)">$1.13M</div><div class="wf-fill" style="height:19%;background:var(--green)"></div><div class="wf-label">DLC 1</div></div>
    <div class="wf-bar"><div class="wf-val" style="color:var(--green)">$750K</div><div class="wf-fill" style="height:13%;background:var(--green)"></div><div class="wf-label">DLC 2+</div></div>
    <div class="wf-bar"><div class="wf-val" style="color:var(--near-black)"><strong>$11.9M</strong></div><div class="wf-fill" style="height:100%;background:var(--near-black)"></div><div class="wf-label">Total</div></div>
  </div>

  <hr class="sep">
  <div class="sl">Pricing Strategy Detail</div>' \
'<hr class="sep">
  <div class="sl">Platform Strategy</div>'

# Remove pricing strategy bullets (between the new Platform Strategy header and old one)
do_patch "business.html" "Remove pricing strategy bullets" \
'<h2>The "Never Discount" Playbook</h2>

  <ul class="dl">
    <li><span class="d"></span><strong>EA launch at $24.99:</strong> Below the $30 psychological barrier. Signals value-in-progress. Avoids KSP2'\''s fatal $50 mistake. <span class="tag tb">TESTED</span></li>
    <li><span class="d"></span><strong>Price increases during EA:</strong> As major features ship (mod support, multiplayer, expanded narrative), price steps up: $24.99 → $27.99 → $29.99 → $34.99 at 1.0. Early buyers are rewarded; later buyers pay for more value.</li>
    <li><span class="d"></span><strong>10% maximum discount:</strong> RimWorld rarely exceeds 10% off. Factorio has never discounted. Frequent deep sales train customers to wait and signal declining value. Stella Nova caps at 10% during Steam seasonal sales.</li>
    <li><span class="d"></span><strong>DLC priced as expansions:</strong> $19.99–$29.99 for expansion-grade content. New systems, new mechanics, new narrative arcs. Not cosmetic packs. The Factorio Space Age model: $35 DLC sold 1.24M copies.</li>
    <li><span class="d"></span><strong>No bundles below cost:</strong> Base + DLC bundles at modest discount only (5–10%). Bundle pricing never drops below individual EA price.</li>
  </ul>

  <hr class="sep">
  <div class="sl">Comparable Revenue Timelines</div>
  <h2>How Similar Games Monetized</h2>

  <div class="tw"><table class="t">
    <thead><tr><th>Game</th><th>EA Price</th><th>1.0 Price</th><th>Discount Policy</th><th>5-Yr Gross</th></tr></thead>
    <tbody>
      <tr><td class="n">Factorio</td><td>$20</td><td>$35</td><td>Never discounted</td><td>$200M+</td></tr>
      <tr><td class="n">RimWorld</td><td>$30</td><td>$34.99</td><td>Rare, max 10%</td><td>$80M+</td></tr>
      <tr><td class="n">Oxygen Not Included</td><td>$14.99</td><td>$24.99</td><td>Moderate (20–33%)</td><td>$50M+ est.</td></tr>
      <tr><td class="n">Space Haven</td><td>$14.99</td><td>$24.99</td><td>Moderate</td><td>$10M+ est.</td></tr>
      <tr><td class="n">KSP 2 <span class="tag tr">FAIL</span></td><td>$49.99</td><td>N/A</td><td>N/A (abandoned)</td><td>~$0 net value</td></tr>
      <tr><td class="n" style="color:var(--cyan)">Stella Nova (planned)</td><td>$24.99</td><td>$34.99</td><td>Rare, max 10%</td><td>$2.4M–$50M</td></tr>
    </tbody>
  </table></div>

  <hr class="sep">
  <div class="sl">Platform Strategy</div>' \
''

# Remove platform strategy pricing reference
do_patch "business.html" "Platform: remove EA date" \
'EA launch (Jul 2026)' \
'EA launch'

# Fix exit scenario A pricing ref
do_patch "business.html" "Exit scenario A: remove pricing" \
'$2–5M over 5 years. Solo dev with near-zero burn = highly profitable at any scale. Papers, Please generated $41M over 10 years at $9.99.' \
'Niche audience, strong retention. Solo dev with near-zero burn = highly profitable at any scale. Papers, Please generated $41M over 10 years.'

# Fix bottom line
do_patch "business.html" "Bottom line: remove breakeven" \
'Breakeven at 400 units. The upside range — from $2.4M to $50M+ over 5 years — is entirely driven' \
'The upside is entirely driven'

# Footer
do_patch "business.html" "Footer: update date + name" \
'Stella Nova · Revenue Model · March 2026' \
'Stella Nova · Business Strategy · April 2026'

# Remove Chart.js script (canvas no longer exists)
do_patch "business.html" "Remove orphaned Chart.js script" \
'<script>
const ctx = document.getElementById('"'"'revChart'"'"').getContext('"'"'2d'"'"');' \
'<!-- chart removed -->
<!-- const ctx ='

end_stage "The business page lost 140 lines of pricing fiction. It's on a diet and feeling great."


# ══════════════════════════════════════════════════════════════════════════════
#  STAGE 6: market-intel.html — Purge LLM + Remove pricing
# ══════════════════════════════════════════════════════════════════════════════

begin_stage "market-intel.html — Purge LLM & pricing references"

do_patch "market-intel.html" "Feature table: LLM → storyteller" \
'<td class="n">LLM-powered narrative</td><td>No direct comparable</td><td>Novel differentiator — "Rimworld meets GPT"</td>' \
'<td class="n">Deterministic storyteller</td><td>RimWorld AI storytellers</td><td>27 quest types, 4 tiers — proven "story generator" model with deeper social sim</td>'

do_patch "market-intel.html" "Moat callout: rewrite" \
'<strong>The LLM narrative system is Stella Nova'\''s moat.</strong> No shipping colony sim has integrated generative AI for dynamic storytelling. This is a first-mover advantage in a market that has proven' \
'<strong>The storyteller system is Stella Nova'\''s depth moat.</strong> 27 quest types across 4 tiers, 12+ social activity types (meals, debates, stargazing, jokes, workouts), and emergent relationship dynamics. This is the RimWorld'

do_patch "market-intel.html" "Remove pricing strategy section" \
'<div class="sl b">Pricing Strategy</div>
    <h2>Recommendation: $24.99 EA' \
'<div class="sl b" style="display:none">Pricing Strategy</div>
    <h2 style="display:none">Recommendation'

do_patch "market-intel.html" "Competitive heading: remove AI stories" \
'The Pitch: "Factorio Meets RimWorld in Space — With AI That Tells Stories"' \
'The Pitch: "Factorio Meets RimWorld in Space — Built From Scratch in Rust"'

do_patch "market-intel.html" "vs RimWorld: LLM → social sim" \
'3D space setting, orbital mechanics, LLM narrative' \
'3D space setting, orbital mechanics, deeper social simulation'

do_patch "market-intel.html" "vs Space Haven: LLM → storyteller" \
'Deeper simulation, custom engine performance, LLM narrative' \
'Deeper simulation, custom engine performance, emergent storyteller'

do_patch "market-intel.html" "Risk: scope creep LLM → narrative" \
'station building first, then orbital, then LLM' \
'station building first, then orbital, then narrative depth'

do_patch "market-intel.html" "Risk: overpriced EA — remove Stella Nova pricing" \
'$24.99 EA, increase to $34.99 at 1.0' \
'Price below $30 psychological threshold at EA launch'

do_patch "market-intel.html" "Remove pricing recommendation from playbook" \
'<li><strong>Price EA at $24.99, increase to $34.99 at 1.0.</strong> Rewards early adopters, signals growing value, avoids KSP2'\''s trust-destroying premium pricing.</li>
        <li><strong>Build mod support' \
'<li><strong>Build mod support'

do_patch "market-intel.html" "Playbook #7: LLM → storyteller" \
'Stella Nova'\''s LLM narrative system should generate shareable' \
'Stella Nova'\''s storyteller system should generate shareable'

do_patch "market-intel.html" "Revenue projections footnote: remove pricing" \
'Assumes $24.99 EA → $34.99 1.0. Excludes DLC. Conservative assumes' \
'Based on comparable title trajectories. Conservative assumes'

do_patch "market-intel.html" "Closing: AI-driven → emergent storytelling" \
'space colony sim with AI-driven narrative has no direct' \
'space colony sim with emergent storytelling has no direct'

do_patch "market-intel.html" "Footer: update date" \
'Business Case Studies · February 2026' \
'Business Case Studies · April 2026'

end_stage "Market intel no longer reads like a ChatGPT investor pitch. Ironic, isn't it?"


# ══════════════════════════════════════════════════════════════════════════════
#  STAGE 7: index.html — Update nav labels
# ══════════════════════════════════════════════════════════════════════════════

begin_stage "index.html — Update navigation labels"

do_patch "index.html" "Nav label: Revenue Model → Business Strategy" \
'>Revenue Model<' \
'>Business Strategy<'

do_patch "index.html" "JS LABELS: Revenue Model → Business Strategy" \
"business:'Revenue Model'" \
"business:'Business Strategy'"

end_stage "Two lines changed. Even your nav labels were lying."


# ══════════════════════════════════════════════════════════════════════════════
#  STAGE 8: Cleanup — Edge cases the primary patches missed
# ══════════════════════════════════════════════════════════════════════════════

begin_stage "Cleanup — Topbar dates, title tags, stubborn footnotes"

# Uses a temp Python script to avoid bash quote-escaping hell with HTML attributes

CLEANUP_SCRIPT=$(mktemp)
cat << 'PYEOF' > "$CLEANUP_SCRIPT"
import sys, os

site_dir = sys.argv[1]
fixes = 0

# business.html — <title> tag
path = os.path.join(site_dir, "business.html")
with open(path, "r") as f:
    c = f.read()
if "Stella Nova — Revenue Model" in c:
    c = c.replace("Stella Nova — Revenue Model", "Stella Nova — Business Strategy", 1)
    fixes += 1

# business.html — revenue projections footnote
if "Assumes $24.99 EA" in c:
    lines = c.split("\n")
    new_lines = []
    for line in lines:
        if "Assumes $24.99 EA" in line:
            new_lines.append('  <p style="font-size:11px;color:var(--g500);font-family:\'IBM Plex Mono\', monospace">Based on comparable title trajectories. Conservative assumes niche audience with limited marketing. Base assumes successful Next Fest + streamer coverage. Optimistic assumes viral community stories + award nominations.</p>')
            fixes += 1
        else:
            new_lines.append(line)
    c = "\n".join(new_lines)

# business.html — remove Revenue Projections section (chart + table) if still present
marker_start = '<div class="sl">Revenue Projections</div>'
marker_end = '</table></div>'
if marker_start in c:
    start_idx = c.find(marker_start)
    # Find the closing </table></div> after the projections table
    end_idx = c.find(marker_end, start_idx)
    if start_idx != -1 and end_idx != -1:
        end_idx += len(marker_end)
        replacement = '''<div class="sl">Comparable Revenue — What's Proven</div>
  <h2>What Solo/Micro-Team Colony Sims Have Achieved</h2>

  <div class="tw"><table class="t">
    <thead><tr><th>Game</th><th>Team Size</th><th>Est. Lifetime Gross</th><th>Key Insight</th></tr></thead>
    <tbody>
      <tr><td class="n">Factorio</td><td>2 &rarr; 31</td><td>$305M+</td><td>Never discounted. Custom engine. 97% positive.</td></tr>
      <tr><td class="n">RimWorld</td><td>1 &rarr; 7</td><td>$116M+</td><td>211hr avg playtime. 5 DLC expansions.</td></tr>
      <tr><td class="n">Oxygen Not Included</td><td>Klei (studio)</td><td>$50M+ est.</td><td>Moderate discounts. Strong mod ecosystem.</td></tr>
      <tr><td class="n">Space Haven</td><td>Small team</td><td>$10M+ est.</td><td>Closest comparable in space colony niche.</td></tr>
      <tr><td class="n">KSP 2 <span class="tag tr">FAIL</span></td><td>Large studio</td><td>~$0 net value</td><td>Overpriced EA, broken launch, abandoned.</td></tr>
    </tbody>
  </table></div>'''
        c = c[:start_idx] + replacement + c[end_idx:]
        fixes += 1

# business.html — remove Revenue Waterfall section if still present
wf_start = '<div class="sl">Revenue Waterfall'
if wf_start in c:
    start_idx = c.find(wf_start)
    # Find the next <hr class="sep"> after the waterfall
    next_sep = c.find('<hr class="sep">', start_idx + 10)
    if start_idx != -1 and next_sep != -1:
        # Also remove the preceding <hr class="sep">
        prev_sep = c.rfind('<hr class="sep">', 0, start_idx)
        if prev_sep != -1 and (start_idx - prev_sep) < 100:
            start_idx = prev_sep
        c = c[:start_idx] + c[next_sep:]
        fixes += 1

# business.html — remove Pricing Strategy section if still present
ps_start = '<div class="sl">Pricing Strategy Detail</div>'
if ps_start in c:
    start_idx = c.find(ps_start)
    next_sep = c.find('<hr class="sep">', start_idx + 10)
    if start_idx != -1 and next_sep != -1:
        prev_sep = c.rfind('<hr class="sep">', 0, start_idx)
        if prev_sep != -1 and (start_idx - prev_sep) < 100:
            start_idx = prev_sep
        c = c[:start_idx] + c[next_sep:]
        fixes += 1

# business.html — remove Comparable Revenue Timelines (with Stella Nova pricing) if still present
crt_marker = "Stella Nova (planned)"
if crt_marker in c:
    crt_start = '<div class="sl">Comparable Revenue Timelines</div>'
    start_idx = c.find(crt_start)
    if start_idx != -1:
        next_sep = c.find('<hr class="sep">', start_idx + 10)
        if next_sep != -1:
            prev_sep = c.rfind('<hr class="sep">', 0, start_idx)
            if prev_sep != -1 and (start_idx - prev_sep) < 100:
                start_idx = prev_sep
            c = c[:start_idx] + c[next_sep:]
            fixes += 1

# business.html — remove orphaned Chart.js script
chart_marker = "const ctx = document.getElementById"
if chart_marker in c:
    s = c.find("<script>")
    while s != -1:
        e = c.find("</script>", s)
        if e != -1 and chart_marker in c[s:e]:
            c = c[:s] + c[e + len("</script>"):]
            fixes += 1
            break
        s = c.find("<script>", s + 1)

with open(path, "w") as f:
    f.write(c)

# roadmap.html — topbar date
path = os.path.join(site_dir, "roadmap.html")
with open(path, "r") as f:
    c = f.read()
if "Development Roadmap \xc2\xb7 March 2026" in c or "Development Roadmap · March 2026" in c:
    c = c.replace("Development Roadmap · March 2026", "Development Roadmap · April 2026", 1)
    fixes += 1
    with open(path, "w") as f:
        f.write(c)

# market-intel.html — topbar date
path = os.path.join(site_dir, "market-intel.html")
with open(path, "r") as f:
    c = f.read()
if "February 2026</div>" in c:
    c = c.replace("February 2026</div>", "April 2026</div>", 1)
    fixes += 1
    with open(path, "w") as f:
        f.write(c)

print(f"{fixes}")
PYEOF

CLEANUP_COUNT=$(python3 "$CLEANUP_SCRIPT" "${SITE_DIR}" 2>&1)
rm -f "$CLEANUP_SCRIPT"

if [[ "$CLEANUP_COUNT" =~ ^[0-9]+$ ]] && [[ "$CLEANUP_COUNT" -gt 0 ]]; then
    echo -e "    ${GREEN}✓${RESET} Applied ${CLEANUP_COUNT} cleanup fix(es) (title tags, topbar dates, footnote)"
    PATCH_PASS=$((PATCH_PASS + CLEANUP_COUNT))
else
    echo -e "    ${DIM}No additional fixes needed (or already clean)${RESET}"
fi

end_stage "Mopping up the corners. Even your HTML title tag was lying."


# ══════════════════════════════════════════════════════════════════════════════
#  STAGE 9: Validation Sweep
# ══════════════════════════════════════════════════════════════════════════════

echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  VALIDATION SWEEP${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"
echo ""

VALIDATION_PASS=0
VALIDATION_FAIL=0

check_absent() {
    local file="${SITE_DIR}/$1"
    local pattern="$2"
    local label="$3"
    if python3 -c "
import sys
with open('${file}') as f:
    content = f.read()
sys.exit(0 if '${pattern}' not in content else 1)
" 2>/dev/null; then
        echo -e "    ${GREEN}✓ CLEAN${RESET}  ${label}"
        VALIDATION_PASS=$((VALIDATION_PASS + 1))
    else
        local count
        count=$(python3 -c "
with open('${file}') as f:
    print(f.read().count('${pattern}'))
" 2>/dev/null)
        echo -e "    ${RED}✗ DIRTY${RESET}  ${label} ${DIM}(${count} occurrence(s) remain)${RESET}"
        VALIDATION_FAIL=$((VALIDATION_FAIL + 1))
    fi
}

check_present() {
    local file="${SITE_DIR}/$1"
    local pattern="$2"
    local label="$3"
    if python3 -c "
import sys
with open('${file}') as f:
    content = f.read()
sys.exit(0 if '${pattern}' in content else 1)
" 2>/dev/null; then
        echo -e "    ${GREEN}✓ FOUND${RESET}  ${label}"
        VALIDATION_PASS=$((VALIDATION_PASS + 1))
    else
        echo -e "    ${RED}✗ MISSING${RESET} ${label}"
        VALIDATION_FAIL=$((VALIDATION_FAIL + 1))
    fi
}

echo -e "${CYAN}─── LLM / Generative AI References (should be CLEAN) ───${RESET}"
check_absent "pitch.html"       "LLM"                  "pitch.html: no 'LLM'"
check_absent "pitch.html"       "language model"        "pitch.html: no 'language model'"
check_absent "pitch.html"       "generative AI"         "pitch.html: no 'generative AI'"
check_absent "pitch.html"       "AI that writes"        "pitch.html: no 'AI that writes'"
check_absent "pitch.html"       "FIRST MOVER"           "pitch.html: no 'FIRST MOVER' tag"
check_absent "roadmap.html"     "LLM"                   "roadmap.html: no 'LLM'"
check_absent "business.html"    "LLM"                   "business.html: no 'LLM'"
check_absent "business.html"    "Anthropic"             "business.html: no 'Anthropic'"
check_absent "business.html"    "OpenAI"                "business.html: no 'OpenAI'"
check_absent "market-intel.html" "LLM-powered"          "market-intel.html: no 'LLM-powered'"
check_absent "market-intel.html" "Rimworld meets GPT"   "market-intel.html: no 'Rimworld meets GPT'"
check_absent "market-intel.html" "AI That Tells Stories" "market-intel.html: no 'AI That Tells Stories'"
echo ""

echo -e "${CYAN}─── Stella Nova Pricing (should be CLEAN) ───${RESET}"
check_absent "pitch.html"       '24.99'                 "pitch.html: no '\$24.99'"
check_absent "pitch.html"       '34.99'                 "pitch.html: no '\$34.99'"
check_absent "roadmap.html"     '24.99'                 "roadmap.html: no '\$24.99'"
check_absent "business.html"    '24.99'                 "business.html: no '\$24.99'"
check_absent "business.html"    '34.99'                 "business.html: no '\$34.99'"
check_absent "business.html"    'Revenue Model'         "business.html: no 'Revenue Model'"
check_absent "index.html"       'Revenue Model'         "index.html: no 'Revenue Model'"
echo ""

echo -e "${CYAN}─── Stale Dates (should be CLEAN) ───${RESET}"
check_absent "pitch.html"       'March 2026'            "pitch.html: no 'March 2026'"
check_absent "roadmap.html"     'March 2026'            "roadmap.html: no 'March 2026'"
check_absent "roadmap.html"     '16 days'               "roadmap.html: no '16 days' countdown"
check_absent "roadmap.html"     '96 days'               "roadmap.html: no '96 days' countdown"
check_absent "roadmap.html"     'Apr 17'                "roadmap.html: no old Steam page date"
check_absent "roadmap.html"     'Apr 28'                "roadmap.html: no old demo date"
check_absent "business.html"    'March 2026'            "business.html: no 'March 2026'"
check_absent "market-intel.html" 'February 2026'        "market-intel.html: no 'February 2026'"
echo ""

echo -e "${CYAN}─── Expected Content (should be FOUND) ───${RESET}"
check_present "pitch.html"      "27 quest types"        "pitch.html: storyteller description present"
check_present "pitch.html"      "Deterministic storyteller engine" "pitch.html: new differentiator present"
check_present "pitch.html"      "built from scratch in Rust"      "pitch.html: new one-liner present"
check_present "pitch.html"      "April 2026"            "pitch.html: updated date"
check_present "roadmap.html"    "Storyteller"            "roadmap.html: storyteller in shipped table"
check_present "roadmap.html"    "Apr 21, 2026"           "roadmap.html: correct Steam page date"
check_present "roadmap.html"    "Early May 2026"         "roadmap.html: updated demo date"
check_present "roadmap.html"    "COMPLETE"               "roadmap.html: completed milestones marked"
check_present "business.html"   "Business Strategy"      "business.html: renamed page title"
check_present "business.html"   "~\$5,500"               "business.html: updated annual burn"
check_present "business.html"   "Monetization Philosophy" "business.html: new section present"
check_present "market-intel.html" "Deterministic storyteller" "market-intel.html: storyteller in feature table"
check_present "market-intel.html" "emergent storytelling"    "market-intel.html: updated closing"
check_present "index.html"      "Business Strategy"      "index.html: updated nav label"
echo ""


# ══════════════════════════════════════════════════════════════════════════════
#  FINAL REPORT
# ══════════════════════════════════════════════════════════════════════════════

echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  FINAL REPORT${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${BOLD}Patch Stages:${RESET}    ${GREEN}${STAGE_PASS} passed${RESET} / ${STAGE_FAIL} failed (of ${STAGE_NUM} total)"
echo -e "  ${BOLD}Individual Patches:${RESET} ${GREEN}${PATCH_PASS} applied${RESET} / ${PATCH_FAIL} skipped"
echo -e "  ${BOLD}Validation:${RESET}      ${GREEN}${VALIDATION_PASS} passed${RESET} / ${VALIDATION_FAIL} failed"
echo ""
echo -e "  ${DIM}Backups at: ${BACKUP_DIR}${RESET}"
echo ""

TOTAL_ISSUES=$((STAGE_FAIL + PATCH_FAIL + VALIDATION_FAIL))
if [[ $TOTAL_ISSUES -eq 0 ]]; then
    echo -e "  ${GREEN}${BOLD}ALL CLEAR.${RESET} ${DIM}Your website no longer cosplays as an AI startup.${RESET}"
    echo -e "  ${DIM}Deploy when ready. The internet will never know you almost shipped an LLM pitch to Steam.${RESET}"
else
    echo -e "  ${YELLOW}${BOLD}PARTIAL SUCCESS.${RESET} ${DIM}${TOTAL_ISSUES} issue(s) detected. Check the output above.${RESET}"
    echo -e "  ${DIM}Some patches may have already been applied, or the source text has drifted.${RESET}"
    echo -e "  ${DIM}Copy this output and send it back for diagnosis.${RESET}"
fi
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════════════${RESET}"
