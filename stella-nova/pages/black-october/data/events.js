// ============================================================================
//  BLACK OCTOBER  ·  data/events.js — the sourced event ledger
// ----------------------------------------------------------------------------
//  One object per event. Schema and rules: validate() in ../grow.js.
//  Check: node stella-nova/pages/black-october/tools/check-events.mjs
//  confidence: confirmed = a primary source states it, reported = news only,
//  disputed = the sources disagree or the claim is denied.
//  A link between threads is in related, not in parent.
//  Gathered 2026-10-22, extended 2026-10-23. Still going on at that date.
// ============================================================================
export const EVENTS = [
 {
  "id": "ai-patch-the-planet-launch",
  "thread": "ai-discovery",
  "parent": null,
  "t": "2026-06-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "Trail of Bits and OpenAI launch Patch the Planet",
  "summary": "Trail of Bits and OpenAI start a joint program to help critical open-source projects handle AI-speed vulnerability research. PHP is listed among participating projects.",
  "sources": [
   {
    "url": "https://trailofbits.com/patch-the-planet/",
    "publisher": "Trail of Bits",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "ai-calif-audit-start",
  "thread": "ai-discovery",
  "parent": "ai-patch-the-planet-launch",
  "t": "2026-07-30T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "Calif begins an AI-assisted audit of PHP under Patch the Planet",
  "summary": "Calif starts auditing the PHP interpreter after an invitation through OpenAI's Patch the Planet initiative, using an LLM companion and an AI agent for source review.",
  "sources": [
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   },
   {
    "url": "https://calif.io/php2shell/",
    "publisher": "Calif",
    "primary": true
   }
  ],
  "confidence": "disputed",
  "note": "The PHP Foundation dates the audit start to 30 July 2026; Calif's write-up says discovery work began on 1 August 2026."
 },
 {
  "id": "ai-calif-hash-post",
  "thread": "ai-discovery",
  "parent": "ai-calif-audit-start",
  "t": "2026-08-05T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "Calif researcher posts a hash commitment of a finding",
  "summary": "A Calif researcher posts a cryptographic hash of one finding on X, a way to prove the date of discovery without revealing it.",
  "sources": [
   {
    "url": "https://calif.io/php2shell/",
    "publisher": "Calif",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "ai-wiz-first-bug",
  "thread": "ai-discovery",
  "parent": "ai-patch-the-planet-launch",
  "t": "2026-08-19T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Wiz Research finds its first PHP memory-safety bug using AI models",
  "summary": "Wiz finds the first of its PHP bugs and confirms unauthenticated RCE against Drupal (20 Aug) and WordPress (21 Aug). Wiz says it used Wiz Atlas, Gemini 4 Argon and GPT-5.6 Sol.",
  "sources": [
   {
    "url": "https://www.wiz.io/blog/php2shell-php-rce",
    "publisher": "Wiz Research",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Wiz is an independent finder; the parent link only anchors it in the AI-discovery thread."
 },
 {
  "id": "ai-chainguard-harness",
  "thread": "ai-discovery",
  "parent": "ai-patch-the-planet-launch",
  "t": "2026-10-14T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "Chainguard launches an AI vulnerability-hunting harness",
  "summary": "Chainguard announces Chainguard Harness, described as vulnerability hunting and remediation powered by Claude Mythos 5.1.",
  "sources": [
   {
    "url": "https://www.chainguard.dev/unchained/rss.xml",
    "publisher": "Chainguard (Unchained RSS)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Context only. Chainguard has not said which model it used to find the PHP bugs; its CEO said only 'a frontier model'."
 },
 {
  "id": "ai-chainguard-finds-php",
  "thread": "ai-discovery",
  "parent": "ai-chainguard-harness",
  "t": "2026-10-17T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Chainguard says it found the same PHP bugs overnight with an AI model",
  "summary": "After hearing from one of the bug finders that something was coming in PHP, Chainguard says its team found the same memory-corruption bugs that night by prompting a frontier AI model.",
  "sources": [
   {
    "url": "https://www.theregister.com/security/2026/10/22/php-blames-supply-chain-security-biz-chainguard-for-putting-huge-chunks-of-the-web-at-risk/5304611",
    "publisher": "The Register",
    "primary": false
   },
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Company claim, not independently verified by The Register."
 },
 {
  "id": "ai-chainguard-joins-maintainers",
  "thread": "ai-discovery",
  "parent": "ai-chainguard-finds-php",
  "t": "2026-10-18T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "Chainguard starts working with PHP maintainers on patches",
  "summary": "Chainguard says it began working with PHP maintainers, confirmed some findings matched existing reports, and helped test patches.",
  "sources": [
   {
    "url": "https://www.theregister.com/security/2026/10/22/php-blames-supply-chain-security-biz-chainguard-for-putting-huge-chunks-of-the-web-at-risk/5304611",
    "publisher": "The Register",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "ai-openai-disclosure-post",
  "thread": "ai-discovery",
  "parent": "ai-patch-the-planet-launch",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "OpenAI publishes its Patch the Planet coordinated-disclosure post",
  "summary": "OpenAI's post on global response coordination says frontier AI helped find the PHP bugs; Axios quotes it: 'To our knowledge, frontier AI found these vulnerabilities before attackers did.'",
  "sources": [
   {
    "url": "https://openai.com/news/rss.xml",
    "publisher": "OpenAI news feed",
    "primary": true
   },
   {
    "url": "https://www.yahoo.com/news/world/articles/black-october-why-bugs-discovered-180131955.html",
    "publisher": "Axios via Yahoo News",
    "primary": false
   },
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "Post date from OpenAI's feed (21 Oct). The post page itself returned HTTP 403, so the quote comes from Axios. 404 Media says the post describes a 'Defender's Window' for governments and critical infrastructure.",
  "related": [
   "php-preannounce"
  ]
 },
 {
  "id": "ai-openai-defenders-policy",
  "thread": "ai-discovery",
  "parent": "ai-openai-disclosure-post",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "OpenAI publishes a policy blueprint on empowering cyber defenders",
  "summary": "OpenAI publishes 'Democratic governance of frontier AI, part II: Empowering cyber defenders', on safeguards and more resilient public institutions.",
  "sources": [
   {
    "url": "https://openai.com/news/rss.xml",
    "publisher": "OpenAI news feed",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Feed gives the date only."
 },
 {
  "id": "ai-calif-no-special-access",
  "thread": "ai-discovery",
  "parent": "ai-calif-audit-start",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Calif says no special harness or restricted model access was needed",
  "summary": "Calif's write-up says initial discovery used no special harness or restricted model access, and that an LLM then turned the bug pattern into a reusable skill to find related flaws.",
  "sources": [
   {
    "url": "https://calif.io/php2shell/",
    "publisher": "Calif",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Write-up dated 21 Oct."
 },
 {
  "id": "ai-phpf-report-flood",
  "thread": "ai-discovery",
  "parent": "ai-patch-the-planet-launch",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "PHP Foundation describes AI tooling and a flood of security reports",
  "summary": "The Foundation says Alpha-Omega scanned PHP with Anthropic's Claude Mythos earlier in 2026 and the team added OpenAI's Daybreak Red to validate reports; 15 CVEs since 1 July, over 100 invalid reports.",
  "sources": [
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "ai-wiz-model-credit",
  "thread": "ai-discovery",
  "parent": "ai-wiz-first-bug",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Wiz calls the PHP findings among the most severe in software history",
  "summary": "Wiz's write-up says the bugs 'rank among the most severe vulnerabilities discovered in PHP, and arguably in software history', and that AI helped researchers find the complex exploitation path.",
  "sources": [
   {
    "url": "https://www.wiz.io/blog/php2shell-php-rce",
    "publisher": "Wiz Research",
    "primary": true
   },
   {
    "url": "https://www.yahoo.com/news/world/articles/black-october-why-bugs-discovered-180131955.html",
    "publisher": "Axios via Yahoo News",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "ai-node-codex-credit",
  "thread": "ai-discovery",
  "parent": "ai-patch-the-planet-launch",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "OpenAI Codex Security credited for a Node.js Brotli RCE",
  "summary": "Node.js credits OpenAI Codex Security for CVE-2026-111497, a High-severity out-of-bounds write in the Brotli decoder fixed in the 21 Oct releases.",
  "sources": [
   {
    "url": "https://nodejs.org/en/blog/vulnerability/october-2026-security-releases",
    "publisher": "Node.js project",
    "primary": true
   },
   {
    "url": "https://cveawg.mitre.org/api/cve/CVE-2026-111497",
    "publisher": "CVE Program (cve.org API)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "related": [
   "node-oct21-release"
  ]
 },
 {
  "id": "ai-tob-codex-exploit",
  "thread": "ai-discovery",
  "parent": "ai-patch-the-planet-launch",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Trail of Bits says its PHP exploit was built in one day with Codex",
  "summary": "Trail of Bits' CEO tells 404 Media a staff member built the working exploit in one day with Codex, drawing on about ten years of security research experience.",
  "sources": [
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "reported",
  "related": [
   "php-guido-exploit"
  ]
 },
 {
  "id": "php-calif-report",
  "thread": "php2shell",
  "parent": null,
  "t": "2026-08-11T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Calif reports an unauthenticated RCE in PHP's out-of-memory handling",
  "summary": "Calif reports an unconditional remote code execution bug rooted in PHP's out-of-memory handling to the PHP security team, starting coordinated disclosure. The Foundation makes the fix its top priority.",
  "sources": [
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   },
   {
    "url": "https://calif.io/php2shell/",
    "publisher": "Calif",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "The Foundation notes first signs of this root cause were seen in 2024 after a Quarkslab audit, without a concrete attack vector."
 },
 {
  "id": "php-calif-poc-shared",
  "thread": "php2shell",
  "parent": "php-calif-report",
  "t": "2026-08-14T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Calif shares an RCE proof of concept with PHP",
  "summary": "Calif sends PHP a remote code execution proof of concept for the reported bug.",
  "sources": [
   {
    "url": "https://calif.io/php2shell/",
    "publisher": "Calif",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-poc-confirmed",
  "thread": "php2shell",
  "parent": "php-calif-poc-shared",
  "t": "2026-08-15T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "PHP confirms Calif's proof of concept works",
  "summary": "The PHP team confirms the Calif proof of concept.",
  "sources": [
   {
    "url": "https://calif.io/php2shell/",
    "publisher": "Calif",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-calif-second-bug",
  "thread": "php2shell",
  "parent": "php-calif-report",
  "t": "2026-08-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Calif reports a second PHP bug",
  "summary": "Calif reports a second bug to PHP.",
  "sources": [
   {
    "url": "https://calif.io/php2shell/",
    "publisher": "Calif",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-wiz-report",
  "thread": "php2shell",
  "parent": "php-calif-report",
  "t": "2026-08-24T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Wiz reports PHP attack vectors to the security team",
  "summary": "Wiz reports its PHP findings, including RCE paths against WordPress and Drupal images, to the PHP security team.",
  "sources": [
   {
    "url": "https://www.wiz.io/blog/php2shell-php-rce",
    "publisher": "Wiz Research",
    "primary": true
   },
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "related": [
   "ai-wiz-first-bug"
  ]
 },
 {
  "id": "php-openai-vectors",
  "thread": "php2shell",
  "parent": "php-calif-report",
  "t": "2026-09-18T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "OpenAI reports further out-of-memory attack vectors",
  "summary": "OpenAI, which had independently reported the same root cause, reports further attack vectors to the PHP security team.",
  "sources": [
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "The Foundation's post groups the Wiz and OpenAI reports together, so the pairing of dates and findings is slightly ambiguous."
 },
 {
  "id": "php-ack-coordinated-fix",
  "thread": "php2shell",
  "parent": "php-wiz-report",
  "t": "2026-09-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "PHP acknowledges Wiz's reports and starts a coordinated fix",
  "summary": "Per Wiz's timeline, the PHP team acknowledges the reports and begins a coordinated fix.",
  "sources": [
   {
    "url": "https://www.wiz.io/blog/php2shell-php-rce",
    "publisher": "Wiz Research",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-cve-reserved",
  "thread": "php2shell",
  "parent": "php-calif-report",
  "t": "2026-10-12T21:03:58Z",
  "tPrecision": "minute",
  "kind": "cve",
  "title": "PHP's CNA reserves CVE-2026-109618 and CVE-2026-109619",
  "summary": "The PHP CVE Numbering Authority reserves the two CVE IDs later published for the bugs.",
  "sources": [
   {
    "url": "https://cveawg.mitre.org/api/cve/CVE-2026-109618",
    "publisher": "CVE Program (cve.org API)",
    "primary": true
   },
   {
    "url": "https://cveawg.mitre.org/api/cve/CVE-2026-109619",
    "publisher": "CVE Program (cve.org API)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Reservation times 21:03:58Z and 21:04:00Z per the CVE records."
 },
 {
  "id": "php-whitehouse-aware",
  "thread": "php2shell",
  "parent": "php-cve-reserved",
  "t": "2026-10-16T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "White House later says it learned of the flaw on Friday 16 October",
  "summary": "The White House told reporters it became aware of the PHP issue on the Friday before the release.",
  "sources": [
   {
    "url": "https://www.rte.ie/news/world/2026/1021/1596231-eu-cybersecurity/",
    "publisher": "RTE News",
    "primary": false
   },
   {
    "url": "https://www.engadget.com/2293625/government-websites-in-the-eu-and-canada-taken-offline-over-php-vulnerability/",
    "publisher": "Engadget",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Sources say 'Friday'; 16 Oct 2026 is the Friday before the 21 Oct release."
 },
 {
  "id": "php-amazon-oct17-attempt",
  "thread": "php2shell",
  "parent": "php-cve-reserved",
  "t": "2026-10-17T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "Amazon honeypot logs a PHP2Shell exploit attempt four days early",
  "summary": "Amazon Threat Intelligence records an exploitation attempt against a MadPot honeypot from a commercial anonymization network. Amazon does not know how the actor got exploit information, or whether it would have worked.",
  "sources": [
   {
    "url": "https://aws.amazon.com/blogs/security/amazon-threat-intelligence-identifies-php2shell-exploitation-prior-to-public-disclosure-in-madpot/",
    "publisher": "AWS Security Blog",
    "primary": true
   },
   {
    "url": "https://www.jpcert.or.jp/at/2026/at260033.html",
    "publisher": "JPCERT/CC",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-rumors",
  "thread": "php2shell",
  "parent": "php-cve-reserved",
  "t": "2026-10-19T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "Rumors of a coming PHP security issue circulate",
  "summary": "The Register's timeline says rumors of a PHP security problem began circulating on Monday 19 October.",
  "sources": [
   {
    "url": "https://www.theregister.com/security/2026/10/22/php-blames-supply-chain-security-biz-chainguard-for-putting-huge-chunks-of-the-web-at-risk/5304611",
    "publisher": "The Register",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "php-cve-leak",
  "thread": "php2shell",
  "parent": "php-cve-reserved",
  "t": "2026-10-20T15:00:00Z",
  "tPrecision": "hour",
  "kind": "other",
  "title": "CVE IDs leak online with a wrong CVSS 10.0 and wrong date",
  "summary": "Both CVE IDs circulate on forums and social media, including Hacker News, claiming CVSS 10.0 and a 22 Oct release. The Foundation says no technical details leaked.",
  "sources": [
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   },
   {
    "url": "https://www.infosecurity-magazine.com/news/critical-php-vulnerabilities-leaked/",
    "publisher": "Infosecurity Magazine",
    "primary": false
   },
   {
    "url": "https://www.theregister.com/security/2026/10/22/php-blames-supply-chain-security-biz-chainguard-for-putting-huge-chunks-of-the-web-at-risk/5304611",
    "publisher": "The Register",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-preannounce",
  "thread": "php2shell",
  "parent": "php-cve-leak",
  "t": "2026-10-20T19:30:00Z",
  "tPrecision": "minute",
  "kind": "advisory",
  "title": "PHP pre-announces a critical release for 21 Oct 14:00 UTC",
  "summary": "php.net announces a security release on Wednesday 21 Oct at 14:00 UTC for two critical bugs rated CVSS v4.0 9.2, with an earlier release if details go public or exploitation appears.",
  "sources": [
   {
    "url": "https://www.php.net/archive/2026.php#2026-10-20-1",
    "publisher": "PHP Group (php.net)",
    "primary": true
   },
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   },
   {
    "url": "https://x.com/ThePHPF/status/2112633155631108544",
    "publisher": "The PHP Foundation (X)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/ThePHPF/status/2112633155631108544",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "The Foundation says the pre-announcement went out early at 19:30 UTC; its X post is timestamped 19:52:49 UTC. The release was originally set for 22 Oct and moved forward one day."
 },
 {
  "id": "php-calif-video",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-20T20:00:00Z",
  "tPrecision": "hour",
  "kind": "other",
  "title": "Calif mistakenly publishes a proof-of-concept video",
  "summary": "Calif publishes a video showing its proof of concept against several targets, then deletes it; copies spread.",
  "sources": [
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   },
   {
    "url": "https://www.euronews.com/2026/10/22/php-security-flaw-why-websites-across-europe-went-dark-and-what-it-means-for-you",
    "publisher": "Euronews",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-wmcs-offline",
  "thread": "php2shell",
  "parent": "php-cve-reserved",
  "t": "2026-10-20T12:00:00Z",
  "tPrecision": "day",
  "kind": "takedown",
  "title": "Wikimedia takes Cloud Services and supporting tools offline",
  "summary": "The Wikimedia Foundation takes Wikimedia Cloud Services, Toolforge PHP tools, Phabricator infrastructure, documentation and CI services offline as a precaution.",
  "sources": [
   {
    "url": "https://diff.wikimedia.org/2026/10/21/impact-of-php-vulnerabilities-on-wikimedia-cloud-services/",
    "publisher": "Wikimedia Foundation (Diff)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "The post says this followed the PHP advisory; no time of day is given."
 },
 {
  "id": "php-infra-advice",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-20T23:00:00Z",
  "tPrecision": "hour",
  "kind": "mitigation",
  "title": "PHP gives mitigation advice to some critical infrastructure providers",
  "summary": "PHP maintainers give mitigation advice to some critical infrastructure providers; the Foundation says this advice may have leaked.",
  "sources": [
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   },
   {
    "url": "https://www.theregister.com/security/2026/10/22/php-blames-supply-chain-security-biz-chainguard-for-putting-huge-chunks-of-the-web-at-risk/5304611",
    "publisher": "The Register",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-amazon-oct21-early",
  "thread": "php2shell",
  "parent": "php-calif-video",
  "t": "2026-10-21T02:00:00Z",
  "tPrecision": "hour",
  "kind": "exploitation",
  "title": "Amazon sees the first of several proof-of-concept exploits",
  "summary": "Amazon identifies the earliest of several PoC exploits around 02:00 UTC, followed by more attempts from anonymized infrastructure until 08:00 UTC, which it reads as several actors.",
  "sources": [
   {
    "url": "https://aws.amazon.com/blogs/security/amazon-threat-intelligence-identifies-php2shell-exploitation-prior-to-public-disclosure-in-madpot/",
    "publisher": "AWS Security Blog",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-cloudflare-default",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T03:02:00Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "Cloudflare turns on default WAF protection for all plans",
  "summary": "Cloudflare says customers on free and paid WAF plans are protected by default from 03:02 UTC, about nine hours before disclosure, after building rules since early October.",
  "sources": [
   {
    "url": "https://blog.cloudflare.com/php-vulnerabilities-waf-protection",
    "publisher": "Cloudflare",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-chainguard-images",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T07:41:00Z",
  "tPrecision": "minute",
  "kind": "patch",
  "title": "Chainguard publishes fixed PHP images six hours before release",
  "summary": "Chainguard ships publicly available built images containing the fix more than six hours before the coordinated 14:00 UTC release, after notifying the PHP disclosure channel.",
  "sources": [
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   },
   {
    "url": "https://www.theregister.com/security/2026/10/22/php-blames-supply-chain-security-biz-chainguard-for-putting-huge-chunks-of-the-web-at-risk/5304611",
    "publisher": "The Register",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "Fact of publication is not disputed; whether it was an embargo break is disputed (see the two statement events)."
 },
 {
  "id": "php-nl-offline",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T09:10:00Z",
  "tPrecision": "hour",
  "kind": "takedown",
  "title": "Dutch government portals go offline, including DigiD and MijnOverheid",
  "summary": "MijnOverheid, DigiD, the Tweede Kamer site, the NCSC's own site, the data protection authority and several news and education systems are offline by NOS's 11:10 CEST report.",
  "sources": [
   {
    "url": "https://nos.nl/artikel/2636055-websites-als-mijnoverheid-en-digid-offline-vanwege-lek-risico-op-hacks",
    "publisher": "NOS",
    "primary": false
   },
   {
    "url": "https://www.itmedia.co.jp/news/article/2610/22/2000002514/",
    "publisher": "ITmedia NEWS",
    "primary": false
   },
   {
    "url": "https://www.euronews.com/2026/10/22/php-security-flaw-why-websites-across-europe-went-dark-and-what-it-means-for-you",
    "publisher": "Euronews",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Time is NOS's first publication (11:10 CEST); the sites went down earlier that morning."
 },
 {
  "id": "php-nl-wider",
  "thread": "php2shell",
  "parent": "php-nl-offline",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "takedown",
  "title": "Port of Rotterdam, hospitals, KNVB and party sites follow the Dutch NCSC",
  "summary": "The Port of Rotterdam, football association KNVB, websites of the five largest political parties and several hospitals take sites offline after the NCSC's example.",
  "sources": [
   {
    "url": "https://www.rte.ie/news/world/2026/1021/1596231-eu-cybersecurity/",
    "publisher": "RTE News",
    "primary": false
   },
   {
    "url": "https://www.euronews.com/2026/10/22/php-security-flaw-why-websites-across-europe-went-dark-and-what-it-means-for-you",
    "publisher": "Euronews",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "php-ipa-prealert",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "Japan's IPA asks organisations to prepare for the PHP release",
  "summary": "IPA publishes an advance-preparation notice for the release scheduled at 23:00 JST, saying it has not confirmed attacks and urging an inventory of PHP use.",
  "sources": [
   {
    "url": "https://www.ipa.go.jp/security/security-alert/2026/pre-alert20261021.html",
    "publisher": "IPA (Japan)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-ghsa-published",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T13:34:13Z",
  "tPrecision": "minute",
  "kind": "advisory",
  "title": "PHP publishes GitHub advisories GHSA-6wmf and GHSA-w8hw",
  "summary": "PHP publishes two critical GitHub security advisories: 'RCE via stale global state' (13:34:13Z) and 'RCE via OOM corruption' (13:34:25Z), CVSS v4.0 9.2.",
  "sources": [
   {
    "url": "https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w",
    "publisher": "PHP (GitHub security advisory)",
    "primary": true
   },
   {
    "url": "https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp",
    "publisher": "PHP (GitHub security advisory)",
    "primary": true
   },
   {
    "url": "https://api.github.com/repos/php/php-src/security-advisories/GHSA-w8hw-w9fx-j79w",
    "publisher": "GitHub REST API",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-cve-published",
  "thread": "php2shell",
  "parent": "php-ghsa-published",
  "t": "2026-10-21T13:48:34Z",
  "tPrecision": "minute",
  "kind": "cve",
  "title": "CVE-2026-109618 and CVE-2026-109619 published",
  "summary": "The CVE records go public: 109618 at 13:48:34Z and 109619 at 13:54:43Z, with CWE-416 use-after-free among the weakness types.",
  "sources": [
   {
    "url": "https://cveawg.mitre.org/api/cve/CVE-2026-109618",
    "publisher": "CVE Program (cve.org API)",
    "primary": true
   },
   {
    "url": "https://cveawg.mitre.org/api/cve/CVE-2026-109619",
    "publisher": "CVE Program (cve.org API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-wmf-tools-post",
  "thread": "php2shell",
  "parent": "php-wmcs-offline",
  "t": "2026-10-21T13:41:43Z",
  "tPrecision": "minute",
  "kind": "takedown",
  "title": "Wikimedia says many supporting services are deliberately offline",
  "summary": "The Wikimedia Foundation says it has taken many supporting services offline until they can be patched and warns readers may see wiki outages.",
  "sources": [
   {
    "url": "https://diff.wikimedia.org/2026/10/21/impact-of-php-vulnerabilities-on-wikimedia-tools-and-services/",
    "publisher": "Wikimedia Foundation (Diff)",
    "primary": true
   },
   {
    "url": "https://diff.wikimedia.org/feed/",
    "publisher": "Wikimedia Foundation (Diff RSS)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-cloudflare-blog",
  "thread": "php2shell",
  "parent": "php-cloudflare-default",
  "t": "2026-10-21T13:56:45Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Cloudflare says the bug leaked and it saw attack traffic",
  "summary": "Cloudflare's blog says the vulnerability leaked before the official release date and that it observed attack traffic targeting customers.",
  "sources": [
   {
    "url": "https://blog.cloudflare.com/php-vulnerabilities-waf-protection",
    "publisher": "Cloudflare",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-release",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T14:00:00Z",
  "tPrecision": "minute",
  "kind": "patch",
  "title": "PHP ships 8.5.12, 8.4.27, 8.3.36 and 8.2.35",
  "summary": "PHP releases fixes for both CVEs and an advisory saying updating is the only complete fix; mod_php is highest risk. Source backports go out for end-of-life 7.4, 8.0 and 8.1.",
  "sources": [
   {
    "url": "https://www.php.net/archive/2026.php#2026-10-21-5",
    "publisher": "PHP Group (php.net)",
    "primary": true
   },
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   },
   {
    "url": "https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w",
    "publisher": "PHP (GitHub security advisory)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Fixed versions confirmed against php.net, GitHub advisories and NVD. The 8.2.34/8.3.35/8.4.26/8.5.11 numbers in some summaries are the last vulnerable releases, not fixes. Timing: Foundation says 14:00 UTC; CERT-EU says 13:30 UTC; GitHub advisories carry 13:34 UTC."
 },
 {
  "id": "php-86-rc4",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "patch",
  "title": "PHP 8.6.0 RC4 ships with both fixes",
  "summary": "The 8.6.0 release candidate RC4 includes fixes for both CVEs; earlier 8.6.0 builds should be updated.",
  "sources": [
   {
    "url": "https://www.php.net/archive/2026.php#2026-10-21-6",
    "publisher": "PHP Group (php.net)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-nvd-published",
  "thread": "php2shell",
  "parent": "php-cve-published",
  "t": "2026-10-21T14:17:09Z",
  "tPrecision": "minute",
  "kind": "cve",
  "title": "NVD publishes both CVEs",
  "summary": "NIST's NVD publishes both entries; CVE-2026-109618 reaches 'Analyzed' status by 22 Oct.",
  "sources": [
   {
    "url": "https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2026-109618",
    "publisher": "NIST NVD API",
    "primary": true
   },
   {
    "url": "https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2026-109619",
    "publisher": "NIST NVD API",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Not listed in CISA's Known Exploited Vulnerabilities catalog when checked late on 22 Oct UTC."
 },
 {
  "id": "php-phpf-chainguard-statement",
  "thread": "php2shell",
  "parent": "php-chainguard-images",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "PHP Foundation says Chainguard 'unilaterally broke the embargo'",
  "summary": "The Foundation's release post says Chainguard broke the embargo by shipping built fixed images early, which let attackers study the fix while others waited.",
  "sources": [
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   },
   {
    "url": "https://www.theregister.com/security/2026/10/22/php-blames-supply-chain-security-biz-chainguard-for-putting-huge-chunks-of-the-web-at-risk/5304611",
    "publisher": "The Register",
    "primary": false
   }
  ],
  "confidence": "disputed",
  "note": "Chainguard disputes the characterisation (see php-chainguard-response)."
 },
 {
  "id": "php-phpf-no-functional-exploit",
  "thread": "php2shell",
  "parent": "php-chainguard-images",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "PHP security team says it saw no functional exploits at release",
  "summary": "The Foundation says its security team did not identify any functional exploits at the time of release, despite proof-of-concept material circulating after the leak.",
  "sources": [
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   },
   {
    "url": "https://www.euronews.com/2026/10/22/php-security-flaw-why-websites-across-europe-went-dark-and-what-it-means-for-you",
    "publisher": "Euronews",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-wiz-blog",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Wiz publishes PHP2Shell research: back to PHP 5.4, memory disclosure too",
  "summary": "Wiz says nearly every PHP version back to 5.4 has at least one affected bug, and that the flaws can also leak process memory such as passwords and keys.",
  "sources": [
   {
    "url": "https://www.wiz.io/blog/php2shell-php-rce",
    "publisher": "Wiz Research",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-calif-writeup",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Calif publishes its PHP2Shell write-up",
  "summary": "Calif publishes its write-up; earliest affected path dates to PHP 5.4.0, with WordPress, Drupal and Joomla confirmed vulnerable. It lists stopgaps that do not replace patching.",
  "sources": [
   {
    "url": "https://calif.io/php2shell/",
    "publisher": "Calif",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-ncsc-uk",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "UK NCSC alert: any PHP version is affected; consider going offline",
  "summary": "The NCSC says organisations using any version of PHP are affected and should update, apply mitigations, or consider taking systems offline.",
  "sources": [
   {
    "url": "https://www.ncsc.gov.uk/news/critical-security-issue-affecting-php",
    "publisher": "UK National Cyber Security Centre",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-cert-eu",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "CERT-EU advisory 2026-018 tells organisations to patch immediately",
  "summary": "CERT-EU advises immediate patching and, where that is not possible, isolating internet-facing systems; it says proofs of concept have begun to circulate.",
  "sources": [
   {
    "url": "https://cert.europa.eu/publications/security-advisories/2026-018/",
    "publisher": "CERT-EU",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Page header gives 15:20:18 without a time zone."
 },
 {
  "id": "php-circl",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "CIRCL publishes TR-102 on the PHP flaws",
  "summary": "Luxembourg's CIRCL says exploit demonstrations are confirmed but are not by themselves evidence of widespread exploitation, and that suspicious activity preceded the release.",
  "sources": [
   {
    "url": "https://www.circl.lu/pub/tr-102/",
    "publisher": "CIRCL (Luxembourg)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-cisa-alert",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "CISA alert urges immediate PHP patching",
  "summary": "CISA issues an alert urging organisations to apply the PHP patches.",
  "sources": [
   {
    "url": "https://www.engadget.com/2293625/government-websites-in-the-eu-and-canada-taken-offline-over-php-vulnerability/",
    "publisher": "Engadget",
    "primary": false
   },
   {
    "url": "https://www.itmedia.co.jp/news/article/2610/22/2000002514/",
    "publisher": "ITmedia NEWS",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "cisa.gov returned Access Denied to our fetch; reported via Engadget and ITmedia."
 },
 {
  "id": "php-gcloud",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "mitigation",
  "title": "Google Cloud publishes Cloud Armor rules and runtime patch status",
  "summary": "Google Cloud says App Engine standard (PHP 8.2+) is patched automatically, Cloud Run needs auto base-image updates or a redeploy, and Cloud Armor rules are a compensating control.",
  "sources": [
   {
    "url": "https://cloud.google.com/blog/products/identity-security/responding-to-core-php-vulnerabilities-cve-2026-109618-cve-2026-109619",
    "publisher": "Google Cloud",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Updated 22 Oct 09:25 PDT with revised Cloud Armor guidance."
 },
 {
  "id": "php-fastly",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "mitigation",
  "title": "Fastly ships a WAF rule and reports pre-disclosure attacks",
  "summary": "Fastly offers a templated WAF rule for both CVEs and says there is evidence of active attacks in the wild before disclosure.",
  "sources": [
   {
    "url": "https://www.fastly.com/blog/fastlys-proactive-protection-critical-php-rce-cve-2026-109618",
    "publisher": "Fastly",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-vercel",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "mitigation",
  "title": "Vercel deploys default WAF rules before disclosure",
  "summary": "Vercel says it deployed WAF rules for all projects before public disclosure, but that the rules do not replace patching.",
  "sources": [
   {
    "url": "https://vercel.com/kb/bulletin/php2shell-security-bulletin",
    "publisher": "Vercel",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-canada",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T17:21:39Z",
  "tPrecision": "minute",
  "kind": "takedown",
  "title": "Canada takes some government websites offline as a precaution",
  "summary": "Canada's Minister of AI and Digital Innovation says some federal websites were taken offline on the Canadian Centre for Cyber Security's guidance and will return once patched.",
  "sources": [
   {
    "url": "https://x.com/EvanLSolomon/status/2112957499665977439",
    "publisher": "Canada Minister of AI and Digital Innovation (X)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/EvanLSolomon/status/2112957499665977439",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   },
   {
    "url": "https://www.engadget.com/2293625/government-websites-in-the-eu-and-canada-taken-offline-over-php-vulnerability/",
    "publisher": "Engadget",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-finland",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "takedown",
  "title": "Finland's Valtori switches off public government web services",
  "summary": "Finnish state IT provider Valtori takes government public network services offline as a precaution.",
  "sources": [
   {
    "url": "https://www.rte.ie/news/world/2026/1021/1596231-eu-cybersecurity/",
    "publisher": "RTE News",
    "primary": false
   },
   {
    "url": "https://www.euronews.com/2026/10/22/php-security-flaw-why-websites-across-europe-went-dark-and-what-it-means-for-you",
    "publisher": "Euronews",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "php-france",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "takedown",
  "title": "France's Interior Ministry puts its websites into maintenance",
  "summary": "The Interior Ministry places its websites and local administration sites into preventive maintenance; the Paris police site also goes down.",
  "sources": [
   {
    "url": "https://www.rte.ie/news/world/2026/1021/1596231-eu-cybersecurity/",
    "publisher": "RTE News",
    "primary": false
   },
   {
    "url": "https://www.euronews.com/2026/10/22/php-security-flaw-why-websites-across-europe-went-dark-and-what-it-means-for-you",
    "publisher": "Euronews",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "php-denmark",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "takedown",
  "title": "Denmark's Kombit shuts services including the school platform",
  "summary": "Danish municipal IT company Kombit shuts several services, including the national school communication platform.",
  "sources": [
   {
    "url": "https://www.rte.ie/news/world/2026/1021/1596231-eu-cybersecurity/",
    "publisher": "RTE News",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "php-germany",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "takedown",
  "title": "Germany's ITZBund takes several federal portals offline",
  "summary": "The federal IT service ITZBund takes several portals offline.",
  "sources": [
   {
    "url": "https://www.euronews.com/2026/10/22/php-security-flaw-why-websites-across-europe-went-dark-and-what-it-means-for-you",
    "publisher": "Euronews",
    "primary": false
   },
   {
    "url": "https://www.itmedia.co.jp/news/article/2610/22/2000002514/",
    "publisher": "ITmedia NEWS",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "php-japan-mof",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "takedown",
  "title": "Japan's Ministry of Finance suspends PHP-based web content",
  "summary": "The Ministry of Finance temporarily stops PHP-based content, citing IPA advice to consider suspension where patches cannot be applied at once.",
  "sources": [
   {
    "url": "https://www.mof.go.jp/public_relations/ohter/20261021231537.html",
    "publisher": "Ministry of Finance, Japan",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-japan-firms",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "takedown",
  "title": "Sakura Internet, pixiv, Niconico and others enter emergency maintenance",
  "summary": "Japanese services including Sakura Internet, pixiv, Niconico, Kodomon, Shadowverse and BASE suspend services for emergency maintenance around the release.",
  "sources": [
   {
    "url": "https://news.yahoo.co.jp/articles/229d47c7b6ed0ef1cde84e09362e5fe3769ac8a3",
    "publisher": "Business+IT via Yahoo! News Japan",
    "primary": false
   },
   {
    "url": "https://www.itmedia.co.jp/news/article/2610/22/2000002514/",
    "publisher": "ITmedia NEWS",
    "primary": false
   },
   {
    "url": "https://www.rte.ie/news/world/2026/1021/1596231-eu-cybersecurity/",
    "publisher": "RTE News",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "php-services-paused",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "takedown",
  "title": "4chan, Asana, GOG, DeviantArt and Dropbox Sign pause for maintenance",
  "summary": "4chan, DeviantArt and Dropbox Sign run vulnerability maintenance and Asana and GOG suspend service, per ITmedia citing How-To Geek; 404 Media also lists 4chan.",
  "sources": [
   {
    "url": "https://www.itmedia.co.jp/news/article/2610/22/2000002514/",
    "publisher": "ITmedia NEWS",
    "primary": false
   },
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Exact dates not given; placed on 21 Oct."
 },
 {
  "id": "php-whitehouse-statement",
  "thread": "php2shell",
  "parent": "php-whitehouse-aware",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "White House says it is working with agencies and AI companies on fixes",
  "summary": "The White House says it is reviewing federal PHP use and working with agencies and major AI companies, calling the discovery 'American innovation strengthening our national security'.",
  "sources": [
   {
    "url": "https://www.rte.ie/news/world/2026/1021/1596231-eu-cybersecurity/",
    "publisher": "RTE News",
    "primary": false
   },
   {
    "url": "https://www.itmedia.co.jp/news/article/2610/22/2000002514/",
    "publisher": "ITmedia NEWS",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "php-drupal-statement",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Drupal Association: 'This issue impacts the majority of the Internet'",
  "summary": "The Drupal Association's interim CEO says all servers using any PHP version from the last 20 years are vulnerable.",
  "sources": [
   {
    "url": "https://www.engadget.com/2293625/government-websites-in-the-eu-and-canada-taken-offline-over-php-vulnerability/",
    "publisher": "Engadget",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "php-nl-restore",
  "thread": "php2shell",
  "parent": "php-nl-offline",
  "t": "2026-10-21T17:00:00Z",
  "tPrecision": "hour",
  "kind": "other",
  "title": "Dutch sites return after the patch; DigiD and NCSC back by evening",
  "summary": "MijnOverheid and several hospital and municipal sites are back by about 19:00 CEST; the NCSC, DigiD and Stedin pages by about 20:30 CEST.",
  "sources": [
   {
    "url": "https://www.rd.nl/a/geen-signalen-van-misbruik-php-lek-websites-komen-weer-online",
    "publisher": "Reformatorisch Dagblad (liveblog)",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Approximate local times from a liveblog, converted from CEST (UTC+2)."
 },
 {
  "id": "php-ncscnl-no-exploitation",
  "thread": "php2shell",
  "parent": "php-nl-offline",
  "t": "2026-10-21T18:00:00Z",
  "tPrecision": "hour",
  "kind": "statement",
  "title": "Dutch NCSC director: no active exploitation seen yet",
  "summary": "The NCSC director says on TV that no active misuse has been seen, though traffic probing websites is rising.",
  "sources": [
   {
    "url": "https://www.rd.nl/a/geen-signalen-van-misbruik-php-lek-websites-komen-weer-online",
    "publisher": "Reformatorisch Dagblad (liveblog)",
    "primary": false
   },
   {
    "url": "https://nos.nl/artikel/2636055-websites-als-mijnoverheid-en-digid-offline-vanwege-lek-risico-op-hacks",
    "publisher": "NOS",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "'Wednesday evening'; hour is approximate."
 },
 {
  "id": "php-wmf-wiki-outages",
  "thread": "php2shell",
  "parent": "php-wmf-tools-post",
  "t": "2026-10-21T15:52:00Z",
  "tPrecision": "minute",
  "kind": "takedown",
  "title": "Wikimedia confirms outages on its wikis",
  "summary": "A 15:52 UTC update to the Foundation's post acknowledges wiki outages while patching continues.",
  "sources": [
   {
    "url": "https://diff.wikimedia.org/2026/10/21/impact-of-php-vulnerabilities-on-wikimedia-tools-and-services/",
    "publisher": "Wikimedia Foundation (Diff)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-ia-back",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-21T22:18:05Z",
  "tPrecision": "minute",
  "kind": "takedown",
  "title": "Internet Archive was briefly offline, now back on patched PHP",
  "summary": "The Internet Archive's founder says staff saw attacks, used AI tools to make fixes for older PHP versions, went offline briefly, and are back on new versions.",
  "sources": [
   {
    "url": "https://mastodon.archive.org/@brewsterkahle/117481215431503956",
    "publisher": "Internet Archive founder (Mastodon)",
    "primary": true
   },
   {
    "url": "https://mastodon.archive.org/api/v1/statuses/117481215431503956",
    "publisher": "Mastodon API",
    "primary": true
   },
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-takaichi",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-21T23:00:00Z",
  "tPrecision": "hour",
  "kind": "statement",
  "title": "Japan's Prime Minister urges PHP patching on X",
  "summary": "Prime Minister Takaichi posts a public warning on X urging PHP users to patch.",
  "sources": [
   {
    "url": "https://news.yahoo.co.jp/articles/229d47c7b6ed0ef1cde84e09362e5fe3769ac8a3",
    "publisher": "Business+IT via Yahoo! News Japan",
    "primary": false
   },
   {
    "url": "https://www.itmedia.co.jp/news/article/2610/22/2000002514/",
    "publisher": "ITmedia NEWS",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Post time unknown; t is the publication time of the earliest fetched report (08:00 JST, 22 Oct)."
 },
 {
  "id": "php-chainguard-response",
  "thread": "php2shell",
  "parent": "php-phpf-chainguard-statement",
  "t": "2026-10-22T00:02:00Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Chainguard CEO: 'didn't leak', shipped because of attacks",
  "summary": "Chainguard's CEO says the company did not leak, shipped fixes because people were being attacked before disclosure, and would not change the policy; its honeypots saw IPs from China and Russia.",
  "sources": [
   {
    "url": "https://www.theregister.com/security/2026/10/22/php-blames-supply-chain-security-biz-chainguard-for-putting-huge-chunks-of-the-web-at-risk/5304611",
    "publisher": "The Register",
    "primary": false
   },
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "disputed",
  "note": "Conflicts with the PHP Foundation's account of an embargo break."
 },
 {
  "id": "php-prince-stats",
  "thread": "php2shell",
  "parent": "php-cloudflare-blog",
  "t": "2026-10-22T01:25:51Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Cloudflare CEO: thousands of attempts before disclosure, millions now",
  "summary": "Cloudflare's CEO says it saw thousands of attempts in the 10 hours before announcement, tens of thousands in the 45 minutes after, hundreds of thousands within 2 hours, and millions by then.",
  "sources": [
   {
    "url": "https://x.com/eastdakota/status/2113079352682570051",
    "publisher": "Cloudflare CEO (X)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/eastdakota/status/2113079352682570051",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   },
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-guido-exploit",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-22T04:43:44Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Trail of Bits says it has a working exploit against MediaWiki",
  "summary": "Replying to a widely shared blog claiming the bugs are not easily exploitable, Trail of Bits' CEO says the firm has a working exploit that gets a shell on unmodified MediaWiki.",
  "sources": [
   {
    "url": "https://x.com/dguido/status/2113129153293897925",
    "publisher": "Trail of Bits CEO (X)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/dguido/status/2113129153293897925",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   },
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-japan-banks",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-22T03:04:00Z",
  "tPrecision": "hour",
  "kind": "takedown",
  "title": "Suspensions spread to Japanese banks and telecoms; Mizuho partly resumes",
  "summary": "Nikkei reports service suspensions at banks and telecoms, with Mizuho Bank partly resumed by 12:04 JST.",
  "sources": [
   {
    "url": "https://www.nikkei.com/article/DGXZQOUC225Z90S6A021C2000000/",
    "publisher": "Nikkei",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Headline-level detail only (paywall)."
 },
 {
  "id": "php-nisc-x",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-22T06:38:36Z",
  "tPrecision": "minute",
  "kind": "advisory",
  "title": "Japan's National Cybersecurity Office points to IPA's PHP2shell alert",
  "summary": "Japan's National Cybersecurity Office posts a warning on X directing organisations to IPA's PHP2shell alert.",
  "sources": [
   {
    "url": "https://x.com/cyber_forecast/status/2113158056934871216",
    "publisher": "Japan National Cybersecurity Office (X)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/cyber_forecast/status/2113158056934871216",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-ipa-alert",
  "thread": "php2shell",
  "parent": "php-ipa-prealert",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "IPA issues its PHP2shell alert after the release",
  "summary": "IPA lists the fixed versions, notes Wiz's view that PHP 5.4 onward is affected, and advises access blocking or suspension where interim measures are not possible.",
  "sources": [
   {
    "url": "https://www.ipa.go.jp/security/security-alert/2026/alert20261022.html",
    "publisher": "IPA (Japan)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-jpcert",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "JPCERT/CC issues alert JPCERT-AT-2026-0033",
  "summary": "JPCERT/CC says the product is widely used in Japan and urges prompt updates and compromise checks.",
  "sources": [
   {
    "url": "https://www.jpcert.or.jp/at/2026/at260033.html",
    "publisher": "JPCERT/CC",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-japan-nta",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "takedown",
  "title": "National Tax Agency and Meteorological Agency suspend systems",
  "summary": "Japan's National Tax Agency suspends parts of its site (the e-Tax top page briefly goes dark) and the Japan Meteorological Agency suspends systems on the morning of 22 Oct JST.",
  "sources": [
   {
    "url": "https://www.nikkei.com/article/DGXZQOUC225Z90S6A021C2000000/",
    "publisher": "Nikkei",
    "primary": false
   },
   {
    "url": "https://www.itmedia.co.jp/news/article/2610/22/2000002514/",
    "publisher": "ITmedia NEWS",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "php-japan-cabinet",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-22T06:35:00Z",
  "tPrecision": "hour",
  "kind": "advisory",
  "title": "Chief Cabinet Secretary's office issues notice to infrastructure operators",
  "summary": "Nikkei reports a notice to critical infrastructure operators published by the Chief Cabinet Secretary's office at 15:35 JST.",
  "sources": [
   {
    "url": "https://www.nikkei.com/article/DGXZQOUC225Z90S6A021C2000000/",
    "publisher": "Nikkei",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Headline-level detail only."
 },
 {
  "id": "php-nsa",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-22T06:21:00Z",
  "tPrecision": "hour",
  "kind": "advisory",
  "title": "NSA advises taking sites offline if they cannot be patched",
  "summary": "The NSA recommends taking systems offline until mitigated when immediate updates are not possible.",
  "sources": [
   {
    "url": "https://www.itmedia.co.jp/news/article/2610/22/2000002514/",
    "publisher": "ITmedia NEWS",
    "primary": false
   },
   {
    "url": "https://www.yahoo.com/news/world/articles/black-october-why-bugs-discovered-180131955.html",
    "publisher": "Axios via Yahoo News",
    "primary": false
   },
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "nsa.gov returned HTTP 403. t is the publication time of the earliest fetched report (15:21 JST); the NSA advisory may be earlier."
 },
 {
  "id": "php-eu-joint",
  "thread": "php2shell",
  "parent": "php-cert-eu",
  "t": "2026-10-22T12:06:00Z",
  "tPrecision": "hour",
  "kind": "statement",
  "title": "EU institutions issue a joint call to act immediately",
  "summary": "The European Commission, ENISA, CERT-EU, Europol and the CSIRTs network urge organisations to act at once, starting with internet-exposed systems.",
  "sources": [
   {
    "url": "https://www.euronews.com/2026/10/22/php-security-flaw-why-websites-across-europe-went-dark-and-what-it-means-for-you",
    "publisher": "Euronews",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "t is the Euronews publication time; the statement date is not given."
 },
 {
  "id": "php-exploitation-disputed",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "Exploitation status in dispute: attempts widespread, success unconfirmed",
  "summary": "Cloudflare, Amazon, Fastly and Chainguard report attack attempts, some before release. PHP saw no functional exploits at release; the Dutch NCSC reported first signals of success on 22 Oct, then on 23 Oct called its one case abroad unconfirmed.",
  "sources": [
   {
    "url": "https://x.com/eastdakota/status/2113079352682570051",
    "publisher": "Cloudflare CEO (X)",
    "primary": true
   },
   {
    "url": "https://aws.amazon.com/blogs/security/amazon-threat-intelligence-identifies-php2shell-exploitation-prior-to-public-disclosure-in-madpot/",
    "publisher": "AWS Security Blog",
    "primary": true
   },
   {
    "url": "https://www.fastly.com/blog/fastlys-proactive-protection-critical-php-rce-cve-2026-109618",
    "publisher": "Fastly",
    "primary": true
   },
   {
    "url": "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
    "publisher": "The PHP Foundation",
    "primary": true
   },
   {
    "url": "https://www.rd.nl/a/geen-signalen-van-misbruik-php-lek-websites-komen-weer-online",
    "publisher": "Reformatorisch Dagblad (liveblog)",
    "primary": false
   },
   {
    "url": "https://dev.to/bhkbdbhatt/black-october-the-week-the-internet-almost-broke-itself-481h",
    "publisher": "DEV Community (Dev.to)",
    "primary": false
   }
  ],
  "confidence": "disputed",
  "note": "A Dev.to summary says both bugs are 'reportedly exploited in the wild'. No primary source fetched confirms a successful compromise via these CVEs. Neither CVE is in CISA KEV catalog version 2026.10.23."
 },
 {
  "id": "php-patchstack-partner-reports",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T07:34:00Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Patchstack relays hosting-partner reports of active exploitation",
  "summary": "Patchstack's timeline says hosting partners reported multiple active exploitation incidents to it at 07:34 UTC, before the patch. It gives no count.",
  "sources": [
   {
    "url": "https://patchstack.com/articles/php-major-vulnerability-alert-10-2026",
    "publisher": "Patchstack",
    "primary": true
   },
   {
    "url": "https://www.nbcnews.com/tech/security/critical-vulnerabilities-php-update-systems-rcna604751",
    "publisher": "NBC News"
   }
  ],
  "confidence": "disputed",
  "note": "Patchstack states it received the reports, but they are second-hand; its own 13:57 UTC telemetry update saw only probing (see php-patchstack-probing-only)."
 },
 {
  "id": "php-hadrian-at-scale",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T11:35:00Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Hadrian says it sees exploitation attempts in the wild at scale",
  "summary": "Hadrian's 11:35 UTC update says it is seeing PHP2Shell exploitation attempts in the wild, mostly against the session upload-progress feature; at 14:35 UTC it says attempts continue at scale.",
  "sources": [
   {
    "url": "https://hadrian.io/vulnerability-alerts/php2shell-leaked-critical-php-rce-cve-2026-109618-cve-2026-109619",
    "publisher": "Hadrian",
    "primary": true
   },
   {
    "url": "https://www.securityweek.com/php2shell-patches-land-as-first-exploitation-attempts-hit-sensors/",
    "publisher": "SecurityWeek"
   }
  ],
  "confidence": "confirmed",
  "note": "'At scale' is Hadrian's only quantifier; it gives no counts and reports no successful compromise."
 },
 {
  "id": "php-patchstack-probing-only",
  "thread": "php2shell",
  "parent": "php-patchstack-partner-reports",
  "t": "2026-10-21T13:57:00Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Patchstack telemetry shows only probing, no hard evidence of breaches",
  "summary": "Patchstack's 13:57 UTC update says its own telemetry shows only probing attacks, with no hard evidence of breaches yet.",
  "sources": [
   {
    "url": "https://patchstack.com/articles/php-major-vulnerability-alert-10-2026",
    "publisher": "Patchstack",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-watchtowr-itw",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "watchTowr honeypots record exploitation attempts against both CVEs",
  "summary": "watchTowr says its Attacker Eye honeypot network observed in-the-wild exploitation of both CVEs on 21 Oct. It told SecurityWeek nobody had succeeded so far but did not expect that to last.",
  "sources": [
   {
    "url": "https://watchtowr.com/intelligence/php-remote-code-execution-php2shell/",
    "publisher": "watchTowr",
    "primary": true
   },
   {
    "url": "https://www.securityweek.com/php2shell-patches-land-as-first-exploitation-attempts-hit-sensors/",
    "publisher": "SecurityWeek"
   }
  ],
  "confidence": "confirmed",
  "note": "Honeypot hits show attempts, not compromises. SecurityWeek places the first attempts around the time the patches landed."
 },
 {
  "id": "php-cyber-centre-al26-026",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "Canadian Cyber Centre alert AL26-026: no active exploitation identified",
  "summary": "The Canadian Centre for Cyber Security says a proof of concept is reported but no active exploitation has been identified, and advises isolating internet-facing apps that cannot be patched.",
  "sources": [
   {
    "url": "https://cyber.gc.ca/en/alerts-advisories/al26-026-critical-vulnerabilities-impacting-php-cve-2026-109618-cve-2026-109619",
    "publisher": "Canadian Centre for Cyber Security",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Update 1 on 23 Oct adds CVE-2026-115560 and keeps the 'no active exploitation' wording."
 },
 {
  "id": "php-csa-singapore",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "Singapore's CSA alert AL-2026-151 reports widespread exploitation attempts",
  "summary": "Singapore's Cyber Security Agency tells administrators to update immediately, citing reports of widespread exploitation attempts; its 23 Oct update says it remains aware of them.",
  "sources": [
   {
    "url": "https://www.csa.gov.sg/alerts-and-advisories/alerts/al-2026-151/",
    "publisher": "Cyber Security Agency of Singapore",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-nl-safety-regions",
  "thread": "php2shell",
  "parent": "php-nl-offline",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "takedown",
  "title": "At least 13 of 25 Dutch safety regions take their websites offline",
  "summary": "At least 13 of the 25 Dutch safety regions take their websites offline as a precaution on 21 Oct, per the Reformatorisch Dagblad liveblog.",
  "sources": [
   {
    "url": "https://www.rd.nl/a/ncsc-onderzoekt-eerste-signalen-van-misbruik-kwetsbaarheden-php-1",
    "publisher": "Reformatorisch Dagblad"
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "php-exposure-counts",
  "thread": "php2shell",
  "parent": "php-preannounce",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "Exposure counts: 2.24 million PHP hosts online, 884,000 on unfixed branches",
  "summary": "Shodan banner counts published by Mallory and cited by CybelAngel show about 2.24 million internet-facing hosts advertising PHP, 883,717 of them on branches with no official fix; Censys counts nearly 55 million PHP web properties.",
  "sources": [
   {
    "url": "https://cybelangel.com/blog/critical-php-rce-vulnerabilities-cve-2026-109618-and-cve-2026-109619/",
    "publisher": "CybelAngel"
   },
   {
    "url": "https://www.nbcnews.com/tech/security/critical-vulnerabilities-php-update-systems-rcna604751",
    "publisher": "NBC News"
   }
  ],
  "confidence": "reported",
  "note": "Host counts, not websites or organisations; about 740,000 hosts hide their version. Mallory's counts are dated 20 Oct. Other estimates differ (Tenable cites 1.3 to 1.9 million hosts; SOCRadar cites 5.1 million)."
 },
 {
  "id": "php-huntress-none-seen",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-21T20:30:00Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Huntress sees no in-the-wild exploitation on partner systems",
  "summary": "Huntress says that as of 16:30 ET on 21 Oct it has not observed in-the-wild exploitation on partner systems and has confirmed no indicators of compromise.",
  "sources": [
   {
    "url": "https://www.huntress.com/blog/php2shell-leaked-critical-php-vulnerabilities",
    "publisher": "Huntress",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-arctic-wolf-potassium",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "Arctic Wolf links weaponized attempts to the Mirai-derived Potassium botnet",
  "summary": "Arctic Wolf Labs sees wide scanning and exploitation attempts, two of them likely weaponized with binaries linked to the Potassium botnet. Its telemetry does not show that any sample ran or that code execution succeeded.",
  "sources": [
   {
    "url": "https://arcticwolf.com/resources/blog/php2shell-critical-php-vulnerabilities-enable-unauthenticated-remote-code-execution/",
    "publisher": "Arctic Wolf",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Arctic Wolf reports comparatively little evidence of reliable exploitation at scale."
 },
 {
  "id": "php-socradar-attacker-server",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "SOCRadar finds exploit tooling on an exposed attacker server",
  "summary": "SOCRadar reports an exposed server holding lab-tested exploit tooling it links, with moderate confidence, to CVE-2026-109618, plus scripts that screened about 20 public sites. None of those sites met the exploit's preconditions.",
  "sources": [
   {
    "url": "https://socradar.io/blog/php2shell-cve-2026-109618-cve-2026-109619/",
    "publisher": "SOCRadar",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "The operator is unattributed; SOCRadar saw no evidence of shell access on any screened site as of 22 Oct."
 },
 {
  "id": "php-tenable-sc-patch",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "patch",
  "title": "Tenable patches the PHP bundled in Security Center and Enclave Security",
  "summary": "Tenable releases patch SC-202610.1 (TNS-2026-28 and TNS-2026-29), which updates the PHP inside Tenable Security Center and Tenable Enclave Security to 8.2.35.",
  "sources": [
   {
    "url": "https://www.tenable.com/blog/php2shell-cve-2026-109618-cve-2026-109619-frequently-asked-questions-about-critical-php-remote",
    "publisher": "Tenable",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "php-wmcs-restore-plan",
  "thread": "php2shell",
  "parent": "php-wmcs-offline",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Wikimedia plans a phased Toolforge and Cloud VPS return; weeks for some",
  "summary": "Wikimedia Cloud Services hopes to restore partial, PHP-free Toolforge within about 24 hours; Cloud VPS projects are audited one by one, which may take days to weeks.",
  "sources": [
   {
    "url": "https://lists.wikimedia.org/hyperkitty/list/cloud-announce@lists.wikimedia.org/thread/CMA4M3LKRKZWH7HG4BS7KSF7WRRUO3CV/",
    "publisher": "Wikimedia Cloud Services (cloud-announce)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "The message shows 22 Oct 15:37 without a time zone; the list index dates the thread 23 Oct."
 },
 {
  "id": "php-ncscnl-restore-update",
  "thread": "php2shell",
  "parent": "php-nl-restore",
  "t": "2026-10-22T14:00:00Z",
  "tPrecision": "minute",
  "kind": "advisory",
  "title": "Dutch NCSC: several sites back online, keep unpatched systems offline",
  "summary": "The NCSC's 22 Oct update says patches are available and several websites are back online, and tells operators to keep still-vulnerable systems offline until updated.",
  "sources": [
   {
    "url": "https://www.ncsc.nl/alerts/kwetsbaarheden-php-patches-beschikbaar-update-nu",
    "publisher": "Nationaal Cyber Security Centrum",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Page shows 16:00, taken as CEST (UTC+2)."
 },
 {
  "id": "php-ncscnl-success-signals",
  "thread": "php2shell",
  "parent": "php-ncscnl-no-exploitation",
  "t": "2026-10-22T15:52:00Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Dutch NCSC reports first signals of successful exploitation",
  "summary": "NOS quotes the NCSC as seeing exploitation attempts and receiving first signals that some succeed; it will not say what the signals are. NOS also counts 113,000 Dutch sites patched and about 145,000 possibly still vulnerable.",
  "sources": [
   {
    "url": "https://nos.nl/artikel/2636225-signalen-bij-nationaal-cyber-security-centrum-van-misbruik-php-lek",
    "publisher": "NOS"
   },
   {
    "url": "https://www.rd.nl/a/ncsc-onderzoekt-eerste-signalen-van-misbruik-kwetsbaarheden-php-1",
    "publisher": "Reformatorisch Dagblad"
   }
  ],
  "confidence": "disputed",
  "note": "An NCSC spokesperson later said the signals came from its international network and no incidents were reported in the Netherlands; the NCSC's 23 Oct update says success of the one reported case abroad is not confirmed."
 },
 {
  "id": "php-assured-japan-survey",
  "thread": "php2shell",
  "parent": "php-japan-firms",
  "t": "2026-10-23T06:27:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Japan survey: 502 suspension notices, only 217 resumptions announced",
  "summary": "Assured, operator of yamory, counts 502 PHP-related service suspension notices on X by 14:00 JST on 23 Oct, against 217 resumption notices; 285 had announced no resumption.",
  "sources": [
   {
    "url": "https://prtimes.jp/main/html/rd/p/000000846.000034075.html",
    "publisher": "Assured (PR TIMES)",
    "primary": true
   },
   {
    "url": "https://news.mynavi.jp/techplus/article/20261023-5180045/",
    "publisher": "Mynavi News TECH+"
   }
  ],
  "confidence": "confirmed",
  "note": "Counts only organisations that posted on X; services that resumed silently are counted as not resumed."
 },
 {
  "id": "php-cve-2026-115560",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-23T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "PHP issues an informational advisory for a third RCE vector, CVE-2026-115560",
  "summary": "php.net says an unlikely RCE vector remains under an unusual configuration and recommends keeping session upload progress disabled until the next regular release, when a full CVE-2026-115560 advisory will follow.",
  "sources": [
   {
    "url": "https://www.php.net/archive/2026.php#2026-10-23-1",
    "publisher": "PHP",
    "primary": true
   },
   {
    "url": "https://www.ncsc.nl/alerts/kwetsbaarheden-php-patches-beschikbaar-update-nu",
    "publisher": "Nationaal Cyber Security Centrum",
    "primary": true
   },
   {
    "url": "https://cyber.gc.ca/en/alerts-advisories/al26-026-critical-vulnerabilities-impacting-php-cve-2026-109618-cve-2026-109619",
    "publisher": "Canadian Centre for Cyber Security",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "The CVE record was not yet public on 23 Oct. The same mitigation was already listed for CVE-2026-109619 on 21 Oct."
 },
 {
  "id": "php-ncscnl-risk-lower",
  "thread": "php2shell",
  "parent": "php-ncscnl-success-signals",
  "t": "2026-10-23T13:45:00Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Dutch NCSC: one unconfirmed case abroad, mass exploitation now less likely",
  "summary": "The NCSC's 23 Oct update says it knows of one report of possible abuse abroad, not confirmed as successful, and that exploitation is complicated, so large-scale abuse is less likely than first estimated.",
  "sources": [
   {
    "url": "https://www.ncsc.nl/alerts/kwetsbaarheden-php-patches-beschikbaar-update-nu",
    "publisher": "Nationaal Cyber Security Centrum",
    "primary": true
   },
   {
    "url": "https://rd.nl/a/ncsc-kans-fors-misbruik-kwetsbaarheden-php-kleiner-dan-gedacht-1",
    "publisher": "Reformatorisch Dagblad"
   }
  ],
  "confidence": "confirmed",
  "note": "Page shows 15:45, taken as CEST (UTC+2). The NCSC still advises keeping unpatched systems offline."
 },
 {
  "id": "php-onamae-shared",
  "thread": "php2shell",
  "parent": "php-release",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "mitigation",
  "title": "Onamae.com patches PHP on shared hosting; suspends phpMyAdmin and Webmail",
  "summary": "In response to the PHP flaws, Onamae.com applies patches on rental servers while keeping each customer's PHP version, and suspends File Manager, phpMyAdmin and Webmail as a precaution.",
  "sources": [
   {
    "url": "https://www.onamae.com/news/article/11591",
    "publisher": "GMO Internet (Onamae.com)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "The notice does not link the PHP response to the Desktop Cloud intrusion."
 },
 {
  "id": "emu-ceremony",
  "thread": "emudhra",
  "parent": null,
  "t": "2025-04-30T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "eMudhra key ceremony creates 24 intermediates, 8 with weak keys",
  "summary": "A key generation ceremony creates 24 intermediate CAs. The eight P-384 keys of the B and C series are later found to have far too little randomness to be secret.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c5",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://emudhra.com/en/press-release/emudhra-statement-distrust-global-tls-intermediate-root-ca",
    "publisher": "eMudhra",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "eMudhra attributes the weak keys to a wrap/unwrap step in the ceremony; root cause not confirmed. Six are TLS CAs (later cross-signed by Sectigo), two are code-signing CAs."
 },
 {
  "id": "emu-discovery",
  "thread": "emudhra",
  "parent": "emu-ceremony",
  "t": "2026-10-17T16:27:00Z",
  "tPrecision": "minute",
  "kind": "disclosure",
  "title": "Independent researcher's scan of CCADB finds broken eMudhra keys",
  "summary": "An independent researcher's scan of the CCADB corpus finds the eMudhra intermediate keys recoverable from public data.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c2",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Per the reporter's own timeline posted on Bugzilla."
 },
 {
  "id": "emu-report",
  "thread": "emudhra",
  "parent": "emu-discovery",
  "t": "2026-10-17T18:05:00Z",
  "tPrecision": "minute",
  "kind": "disclosure",
  "title": "Report sent to Apple, Chrome, Microsoft, Mozilla and eMudhra",
  "summary": "The researcher emails the root programs and eMudhra with signed proof of key control for all eight certificates.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c2",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://groups.google.com/a/mozilla.org/g/dev-security-policy/c/0R3XLJL6FuE/m/VAgSvefvAAAJ",
    "publisher": "Mozilla dev-security-policy list",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-chrome-crlset",
  "thread": "emudhra",
  "parent": "emu-report",
  "t": "2026-10-17T19:45:00Z",
  "tPrecision": "minute",
  "kind": "ca-action",
  "title": "Chrome blocks the six TLS intermediates via CRLSet",
  "summary": "Chrome pushes a CRLSet update blocking the six TLS-issuing intermediates; no browser update or restart needed. Its CT policy means no certificates under them were logged.",
  "sources": [
   {
    "url": "https://groups.google.com/a/mozilla.org/g/dev-security-policy/c/0R3XLJL6FuE/m/VAgSvefvAAAJ",
    "publisher": "Mozilla dev-security-policy list",
    "primary": true
   },
   {
    "url": "https://scotthelme.co.uk/eight-bits-of-trust-emudhras-ca-keys-cracked-in-milliseconds/",
    "publisher": "Scott Helme (blog)",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "Chrome's MDSP post gives 19:45 UTC; the reporter observed CRLSet sequence 10843 with the six keys at 22:46 UTC."
 },
 {
  "id": "emu-mozilla-receives",
  "thread": "emudhra",
  "parent": "emu-report",
  "t": "2026-10-17T20:06:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Mozilla receives the report via Chrome and confirms key control",
  "summary": "Mozilla receives the forwarded report at 20:06 UTC, acknowledges at 20:08, confirms the proof valid and starts a OneCRL distrust.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c0",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://groups.google.com/a/mozilla.org/g/dev-security-policy/c/0R3XLJL6FuE/m/VAgSvefvAAAJ",
    "publisher": "Mozilla dev-security-policy list",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-apple-corroborates",
  "thread": "emudhra",
  "parent": "emu-report",
  "t": "2026-10-17T21:05:00Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Apple corroborates and flags the Sectigo cross-signed certificates",
  "summary": "Apple corroborates the findings, notes the cross-signed certificates and asks for new signed attestations for them.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c2",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Per the reporter's timeline."
 },
 {
  "id": "emu-ack",
  "thread": "emudhra",
  "parent": "emu-report",
  "t": "2026-10-17T21:28:00Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "eMudhra acknowledges, disables a live intermediate and alerts Sectigo",
  "summary": "eMudhra acknowledges the report, says the one live intermediate (EM DV TLS CA - G3C) is now disabled, and notifies Sectigo.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c0",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c2",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Reporter logs 21:28 UTC; Mozilla logs 21:29 UTC. eMudhra's status page later said it became aware on 18 Oct (late evening IST), which conflicts."
 },
 {
  "id": "emu-mozilla-recovers",
  "thread": "emudhra",
  "parent": "emu-mozilla-receives",
  "t": "2026-10-17T21:48:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Mozilla independently recovers the private keys",
  "summary": "Mozilla recovers the keys without knowing the reporter's method, confirming the key generation was flawed and trivial to exploit.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c0",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-onecrl",
  "thread": "emudhra",
  "parent": "emu-mozilla-receives",
  "t": "2026-10-17T22:59:00Z",
  "tPrecision": "minute",
  "kind": "ca-action",
  "title": "Firefox distrusts the intermediates via OneCRL",
  "summary": "Mozilla completes the OneCRL block, reaching standard-configuration Firefox users through Remote Settings.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c0",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c17",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://emudhra.com/en/post/certificate-security-incident",
    "publisher": "eMudhra",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-revoked",
  "thread": "emudhra",
  "parent": "emu-ack",
  "t": "2026-10-18T09:38:00Z",
  "tPrecision": "minute",
  "kind": "ca-action",
  "title": "eMudhra revokes all eight intermediates as caCompromise",
  "summary": "eMudhra marks the eight certificates revoked with reason caCompromise; its own table shows revocations between 09:24 and 09:38 UTC.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c1",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c35",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://emudhra.com/en/post/certificate-security-incident",
    "publisher": "eMudhra",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "A Bugzilla commenter says an eMudhra status update put revocation on 19 Oct; the status page as fetched says 18 Oct."
 },
 {
  "id": "emu-bug-opened",
  "thread": "emudhra",
  "parent": "emu-mozilla-receives",
  "t": "2026-10-18T12:06:03Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Mozilla opens public incident bug 2083449",
  "summary": "Mozilla files 'eMudhra: Private key compromise of Intermediate Certificates' in its CA compliance tracker.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c0",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-mozilla-analysis",
  "thread": "emudhra",
  "parent": "emu-bug-opened",
  "t": "2026-10-18T15:01:55Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Mozilla analysis: flaw in key generation; local AI agents also recover keys",
  "summary": "Mozilla says the 8 keys are all the P-384 keys of two series from one batch, that A-series keys resisted recovery, and that local AI agents recovered the keys on a first simple prompt.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c5",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-sectigo-ack",
  "thread": "emudhra",
  "parent": "emu-ack",
  "t": "2026-10-18T16:08:13Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Sectigo acknowledges and prepares to revoke the cross-signs",
  "summary": "Sectigo says its cross-signing root was already out of Chrome and Mozilla stores but is still trusted by Microsoft and Apple, and that offline revocation will follow within 24 hours.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c6",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-g1-crl-flag",
  "thread": "emudhra",
  "parent": "emu-bug-opened",
  "t": "2026-10-18T20:35:44Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Separate problem flagged: an emSign root CRL with an invalid signature",
  "summary": "A participant reports that a 14 Oct CRL for emSign Root TLS CA - G1 does not verify under the root key. On 22 Oct it is traced to signing with an OCSP certificate key.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c7",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c34",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "reported",
  "note": "Community analysis; eMudhra had not answered in the fetched record."
 },
 {
  "id": "emu-statement-bz",
  "thread": "emudhra",
  "parent": "emu-revoked",
  "t": "2026-10-19T04:40:17Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "eMudhra: one intermediate in production, no end-entity certificates issued",
  "summary": "eMudhra says the ICAs came from one 30 Apr 2025 ceremony on HSMs, only one was in production, none issued end-entity certificates, and other issuers are unaffected.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c10",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-sectigo-revoked",
  "thread": "emudhra",
  "parent": "emu-sectigo-ack",
  "t": "2026-10-19T14:55:35Z",
  "tPrecision": "minute",
  "kind": "ca-action",
  "title": "Sectigo completes revocation of the cross-signed CAs",
  "summary": "Sectigo revokes the affected cross-signed CA certificates and publishes a new CRL and OCSP responses.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c13",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-trust-store-disclosure",
  "thread": "emudhra",
  "parent": "emu-onecrl",
  "t": "2026-10-19T19:50:23Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Mozilla notifies downstream trust stores; certifi and webpki-roots react",
  "summary": "Mozilla begins disclosing to trust store operators without describing the flaw; downstream projects such as python-certifi and rustls webpki-roots pick up the revocations.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c14",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-go-block",
  "thread": "emudhra",
  "parent": "emu-report",
  "t": "2026-10-19T21:38:02Z",
  "tPrecision": "minute",
  "kind": "ca-action",
  "title": "Go 1.27.3 and 1.26.10 hard-block the intermediates (CVE-2026-111943)",
  "summary": "Go releases 1.27.3 and 1.26.10 with a crypto/x509 denylist that filters chains containing the intermediates, tracked as CVE-2026-111943 on Go's URGENT track.",
  "sources": [
   {
    "url": "https://github.com/golang/go/issues/82345",
    "publisher": "Go project (GitHub)",
    "primary": true
   },
   {
    "url": "https://api.github.com/repos/golang/go/issues/82345",
    "publisher": "GitHub REST API",
    "primary": true
   },
   {
    "url": "https://go.dev/doc/devel/release",
    "publisher": "Go project",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Go's releases are dated 19 Oct; issue 82345 was opened at 21:38 UTC. The Go issue does not name the CA; press reports match the blocked keys to eMudhra."
 },
 {
  "id": "emu-mdsp-public",
  "thread": "emudhra",
  "parent": "emu-onecrl",
  "t": "2026-10-20T12:00:00Z",
  "tPrecision": "day",
  "kind": "ca-action",
  "title": "Mozilla and Chrome disclose publicly; Chrome Root Store v43 to drop the root",
  "summary": "Mozilla and Chrome post on the dev-security-policy list. Mozilla recommends other trust stores block the intermediates; Chrome says Root Store version 43 will remove the eMudhra root.",
  "sources": [
   {
    "url": "https://groups.google.com/a/mozilla.org/g/dev-security-policy/c/0R3XLJL6FuE/m/VAgSvefvAAAJ",
    "publisher": "Mozilla dev-security-policy list",
    "primary": true
   },
   {
    "url": "https://scotthelme.co.uk/eight-bits-of-trust-emudhras-ca-keys-cracked-in-milliseconds/",
    "publisher": "Scott Helme (blog)",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "List times shown without a zone; day precision used."
 },
 {
  "id": "emu-firefox-release-plan",
  "thread": "emudhra",
  "parent": "emu-onecrl",
  "t": "2026-10-20T06:32:28Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Mozilla plans unscheduled Firefox Release and ESR bumps",
  "summary": "Mozilla says it will ship unscheduled Firefox Release/ESR versions so that users with Remote Settings disabled get the blocklist.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c16",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c17",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-firefox-nss",
  "thread": "emudhra",
  "parent": "emu-firefox-release-plan",
  "t": "2026-10-20T12:00:00Z",
  "tPrecision": "day",
  "kind": "ca-action",
  "title": "Firefox 158.0.1, ESR 115.43.1/153.5.1 and NSS 3.131.1 ship",
  "summary": "Firefox versions carry the blocklist built in, and NSS 3.131.1 removes the root that signed the intermediates.",
  "sources": [
   {
    "url": "https://emudhra.com/en/post/certificate-security-incident",
    "publisher": "eMudhra",
    "primary": true
   },
   {
    "url": "https://scotthelme.co.uk/eight-bits-of-trust-emudhras-ca-keys-cracked-in-milliseconds/",
    "publisher": "Scott Helme (blog)",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "eMudhra's status page quotes Mozilla's account of these releases."
 },
 {
  "id": "emu-g3-distrust",
  "thread": "emudhra",
  "parent": "emu-mozilla-recovers",
  "t": "2026-10-20T13:06:02Z",
  "tPrecision": "minute",
  "kind": "ca-action",
  "title": "Mozilla removes trust in emSign ECC Root CA - G3 as an emergency",
  "summary": "With several people now recovering the keys independently, some publicly, Mozilla removes trust in the ECC root to protect clients that do not check revocation.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c18",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-cease-commit",
  "thread": "emudhra",
  "parent": "emu-g3-distrust",
  "t": "2026-10-20T14:16:21Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "eMudhra will stop G3 issuance; about 30,000 certificates to migrate",
  "summary": "eMudhra says it will cease issuance from all G3 intermediates; about 30,000 certificates need migration, about 97% issued via ACME, moving to the RSA G1 root.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c19",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-chrome-follows",
  "thread": "emudhra",
  "parent": "emu-g3-distrust",
  "t": "2026-10-20T14:36:50Z",
  "tPrecision": "minute",
  "kind": "ca-action",
  "title": "Chrome commits to the same path as Mozilla",
  "summary": "Chrome says it has committed to a path similar to Mozilla's emergency root distrust.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c20",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://groups.google.com/a/mozilla.org/g/dev-security-policy/c/0R3XLJL6FuE/m/VAgSvefvAAAJ",
    "publisher": "Mozilla dev-security-policy list",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-ceased",
  "thread": "emudhra",
  "parent": "emu-cease-commit",
  "t": "2026-10-20T16:27:02Z",
  "tPrecision": "minute",
  "kind": "ca-action",
  "title": "eMudhra confirms issuance under the ECC G3 root has stopped",
  "summary": "eMudhra reports it has ceased issuance from all intermediates chaining to emSign ECC Root CA - G3.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c21",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-status-page",
  "thread": "emudhra",
  "parent": "emu-statement-bz",
  "t": "2026-10-20T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "eMudhra opens a public status page on the incident",
  "summary": "eMudhra's first public updates say root keys and other intermediates are unaffected and no end-entity certificates were issued from the weak intermediates.",
  "sources": [
   {
    "url": "https://emudhra.com/en/post/certificate-security-incident",
    "publisher": "eMudhra",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-node-ca",
  "thread": "emudhra",
  "parent": "emu-g3-distrust",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "ca-action",
  "title": "Node.js releases update the CA store for the eMudhra compromise",
  "summary": "Node.js 22, 24 and 26 security releases include a CA certificate update for the eMudhra intermediate compromise.",
  "sources": [
   {
    "url": "https://nodejs.org/en/blog/vulnerability/october-2026-security-releases",
    "publisher": "Node.js project",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-android-fix",
  "thread": "emudhra",
  "parent": "emu-firefox-nss",
  "t": "2026-10-21T11:41:49Z",
  "tPrecision": "minute",
  "kind": "patch",
  "title": "Firefox for Android 158.0.2 fixes profiles that skipped the blocklist",
  "summary": "Mozilla ships 158.0.2 after some Android profiles did not apply the updated blocklist at startup.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c29",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-cause-statement",
  "thread": "emudhra",
  "parent": "emu-status-page",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "eMudhra blames a ceremony wrap/unwrap step and 'takes full responsibility'",
  "summary": "eMudhra says a flaw in a wrap/unwrap step created a second, weak key set that was published to root stores; it says no data was breached and the TLS business is about 1% of revenue.",
  "sources": [
   {
    "url": "https://emudhra.com/en/press-release/emudhra-statement-distrust-global-tls-intermediate-root-ca",
    "publisher": "eMudhra",
    "primary": true
   },
   {
    "url": "https://emudhra.com/en/post/certificate-security-incident",
    "publisher": "eMudhra",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "eMudhra says the exact root cause is not yet confirmed."
 },
 {
  "id": "emu-chrome-questions",
  "thread": "emudhra",
  "parent": "emu-cause-statement",
  "t": "2026-10-21T20:38:44Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Chrome asks eMudhra for missing details for subscribers",
  "summary": "Chrome says eMudhra's public documents do not identify the distrusted root or affected CAs and lack trust-removal timelines, and asks eMudhra a list of questions.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c30",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-ceremony-questions",
  "thread": "emudhra",
  "parent": "emu-cause-statement",
  "t": "2026-10-22T05:19:17Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Community asks for ceremony records and HSM configuration",
  "summary": "Participants ask eMudhra for the key generation script, ceremony and witness reports, and HSM mode details, since normal in-module generation should not produce such keys.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c31",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c33",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-timeline-discrepancy",
  "thread": "emudhra",
  "parent": "emu-cause-statement",
  "t": "2026-10-22T09:30:46Z",
  "tPrecision": "minute",
  "kind": "correction",
  "title": "eMudhra's status-page timeline challenged against the Bugzilla record",
  "summary": "A participant asks eMudhra to correct its status page, which put awareness on 18 Oct and revocation on 19 Oct, against Bugzilla times of 17 Oct report and 18 Oct revocation.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c35",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://emudhra.com/en/post/certificate-security-incident",
    "publisher": "eMudhra",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "disputed"
 },
 {
  "id": "emu-exit-tls",
  "thread": "emudhra",
  "parent": "emu-cause-statement",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "eMudhra board decides to exit the global SSL/TLS certificate business",
  "summary": "eMudhra's chairman says withdrawing from global SSL/TLS is the right decision; revocation services will run until every certificate expires or is replaced, and other businesses continue.",
  "sources": [
   {
    "url": "https://emudhra.com/en/press-release/emudhra-to-exit-global-ssl-tls-certificate-business",
    "publisher": "eMudhra",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/show_bug.cgi?id=2083449#c37",
    "publisher": "Mozilla Bugzilla, bug 2083449",
    "primary": true
   },
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (REST API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-sectigo-option",
  "thread": "emudhra",
  "parent": "emu-exit-tls",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "mitigation",
  "title": "eMudhra offers Sectigo-issued certificates to customers",
  "summary": "eMudhra's status update 4 offers Sectigo certificates to all customers as an alternative; its G1 roots stay active.",
  "sources": [
   {
    "url": "https://emudhra.com/en/post/certificate-security-incident",
    "publisher": "eMudhra",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-android-play",
  "thread": "emudhra",
  "parent": "emu-chrome-crlset",
  "t": "2026-10-19T22:00:00Z",
  "tPrecision": "hour",
  "kind": "ca-action",
  "title": "Android and Googlebooks get the intermediate block via Google Play Services",
  "summary": "Google says Android devices and Googlebooks received an update equivalent to the Chrome CRLSet block through Google Play Services around 22:00 UTC on Monday 19 October.",
  "sources": [
   {
    "url": "https://blog.google/security/protecting-chrome-and-android-users-from-compromised-emudhra-intermediate-ca-certificates/",
    "publisher": "Google",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Google gives the time as 'around 22:00 UTC on Monday'; a device restart applies the update at once."
 },
 {
  "id": "emu-apple-block",
  "thread": "emudhra",
  "parent": "emu-apple-corroborates",
  "t": "2026-10-19T12:00:00Z",
  "tPrecision": "day",
  "kind": "ca-action",
  "title": "Apple blocks the compromised eMudhra intermediates on its devices",
  "summary": "Press reports say Apple added protections against the eight compromised intermediates; no Apple statement was found.",
  "sources": [
   {
    "url": "https://lwn.net/Articles/1101643/",
    "publisher": "LWN.net",
    "primary": false
   },
   {
    "url": "https://www.freepressjournal.in/tech/why-did-apple-google-microsoft-mozilla-block-certificates-from-indian-firm-emudhra",
    "publisher": "Free Press Journal",
    "primary": false
   },
   {
    "url": "https://bleepingcomputer.com/news/security/mozilla-google-apple-block-compromised-emudhra-ca-certificates",
    "publisher": "BleepingComputer",
    "primary": false
   }
  ],
  "confidence": "disputed",
  "note": "LWN (citing a third-party summary site) and Free Press Journal give 19 Oct; BleepingComputer says 'Apple added protections on October 22'. No Apple source found."
 },
 {
  "id": "emu-microsoft-block",
  "thread": "emudhra",
  "parent": "emu-report",
  "t": "2026-10-20T12:00:00Z",
  "tPrecision": "day",
  "kind": "ca-action",
  "title": "Microsoft blocks the compromised eMudhra intermediates",
  "summary": "Press timelines say Microsoft blocked the eMudhra intermediate certificates on 20 October, after Chrome, Firefox and Apple.",
  "sources": [
   {
    "url": "https://lwn.net/Articles/1101643/",
    "publisher": "LWN.net",
    "primary": false
   },
   {
    "url": "https://www.freepressjournal.in/tech/why-did-apple-google-microsoft-mozilla-block-certificates-from-indian-firm-emudhra",
    "publisher": "Free Press Journal",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "LWN attributes the date to a third-party summary site; no Microsoft advisory or CTL notice was found."
 },
 {
  "id": "emu-chrome-removal-date",
  "thread": "emudhra",
  "parent": "emu-mdsp-public",
  "t": "2026-10-20T12:00:00Z",
  "tPrecision": "day",
  "kind": "ca-action",
  "title": "Google sets 27 October for the emSign ECC Root CA - G3 removal",
  "summary": "Google's security blog says the Chrome Root Store removal of the G3 root reaches devices on the morning of 27 October 2026 (PDT), and that CT logs now reject certificates chaining to the compromised CAs.",
  "sources": [
   {
    "url": "https://blog.google/security/protecting-chrome-and-android-users-from-compromised-emudhra-intermediate-ca-certificates/",
    "publisher": "Google",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Google says no certificates chaining to the six TLS intermediates were logged in CT before the block. Prerelease channels get the removal sooner."
 },
 {
  "id": "emu-mozilla-questions-sent",
  "thread": "emudhra",
  "parent": "emu-g3-distrust",
  "t": "2026-10-20T20:31:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Mozilla Root Program sends eMudhra questions with a 24-hour deadline",
  "summary": "Mozilla later states it sent eMudhra a set of incident questions at 20:31 UTC on 20 October, asking for a reply within 24 hours.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (comment 42)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-stock-crash",
  "thread": "emudhra",
  "parent": "emu-mdsp-public",
  "t": "2026-10-21T07:21:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "eMudhra shares hit the 20% lower circuit on NSE",
  "summary": "eMudhra stock falls 20% to Rs 432 on the NSE after the browser actions; the company says the global TLS business is about 1% of revenue.",
  "sources": [
   {
    "url": "https://www.angelone.in/news/stocks/emudhra-share-price-hits-20-lower-circuit-addresses-distrust-of-global-tls-intermediate-and-root-ca",
    "publisher": "Angel One",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Time is Angel One's 12:51 IST price snapshot, not the moment of the circuit."
 },
 {
  "id": "emu-meity-probe",
  "thread": "emudhra",
  "parent": "emu-cause-statement",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "MeitY forms a team to probe; says DSC and eSign are unaffected",
  "summary": "India's IT ministry sets up a special team, says the impact on Indian sites was 'very limited', and says CCA-regulated DSC and eSign services are not affected.",
  "sources": [
   {
    "url": "https://www.businesstoday.in/technology/story/impact-has-been-very-limited-meity-on-emudhra-security-incident-says-indian-dsc-and-esign-unaffected-562927-2026-10-21",
    "publisher": "Business Today",
    "primary": false
   },
   {
    "url": "https://theprint.in/tech/meity-sets-up-team-to-probe-emudhra-certificate-breach-says-digital-signature-services-unaffected/3078125/",
    "publisher": "ThePrint",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "ThePrint attributes the remarks to unnamed senior ministry officials; no MeitY press release was found. MeitY also says it is not involved in auditing eMudhra's browser-trusted business."
 },
 {
  "id": "emu-certin-advisory",
  "thread": "emudhra",
  "parent": "emu-cause-statement",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "CERT-In issues advisory CIAD-2026-0050 on the eMudhra compromise",
  "summary": "CERT-In tells organisations to apply trust-store and revocation updates, find certificates under the removed root and replace them, and never bypass certificate warnings; it says no malicious use was confirmed as of 21 October.",
  "sources": [
   {
    "url": "https://www.cert-in.org.in/s2cMainServlet?pageid=PUBVLNOTES02&VLCODE=CIAD-2026-0050",
    "publisher": "CERT-In",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "The advisory shows a later update on 24 October 2026 (IST date as displayed).",
  "related": [
   "certin-advisory"
  ]
 },
 {
  "id": "emu-crl-ocsp-key",
  "thread": "emudhra",
  "parent": "emu-g1-crl-flag",
  "t": "2026-10-22T12:14:20Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Bug comment: a CRL was signed by an OCSP key absent from crt.sh",
  "summary": "A community commenter reports that one eMudhra CRL was signed with the key of an OCSP certificate not previously logged, and argues such key changes went unreported.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (comment 36)",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Community claim on the bug; eMudhra had not answered it in the fetched comments."
 },
 {
  "id": "emu-delay-reply",
  "thread": "emudhra",
  "parent": "emu-ceremony-questions",
  "t": "2026-10-23T11:00:31Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "eMudhra cites social media and investor scrutiny, says it will still report",
  "summary": "On the Mozilla bug, eMudhra says intense scrutiny has made analysis hard, that the investigation goes on, and that it will meet its disclosure obligations.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (comment 39)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-chrome-rebuke",
  "thread": "emudhra",
  "parent": "emu-delay-reply",
  "t": "2026-10-23T14:16:18Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Chrome Root Program: scrutiny is no excuse for delayed answers",
  "summary": "Chrome replies that the scrutiny is 'the predictable result of eMudhra's own failure' and expects eMudhra to prioritise its review and security response.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (comment 41)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "emu-mozilla-no-reply",
  "thread": "emudhra",
  "parent": "emu-mozilla-questions-sent",
  "t": "2026-10-23T14:35:14Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Mozilla: no eMudhra answer to its 20 October questions",
  "summary": "Mozilla says that as of 23 October it has had no response to the questions it sent on 20 October, shares Chrome's concerns, and posts the questions on the bug.",
  "sources": [
   {
    "url": "https://bugzilla.mozilla.org/rest/bug/2083449/comment",
    "publisher": "Mozilla Bugzilla (comment 42)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "gitlab-cve-reserved",
  "thread": "gitlab",
  "parent": "gitlab-oct12-patch",
  "t": "2026-10-13T18:34:15Z",
  "tPrecision": "minute",
  "kind": "cve",
  "title": "GitLab reserves CVE-2026-110264",
  "summary": "GitLab's CNA reserves the CVE later used for the critical regex-compiler flaw.",
  "sources": [
   {
    "url": "https://cveawg.mitre.org/api/cve/CVE-2026-110264",
    "publisher": "CVE Program (cve.org API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "gitlab-patch",
  "thread": "gitlab",
  "parent": "gitlab-cve-reserved",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "patch",
  "title": "GitLab ships critical patch 19.5.1 for a CVSS 10.0 RCE",
  "summary": "GitLab fixes CVE-2026-110264, an integer overflow in the bundled Onigmo regex compiler allowing unauthenticated code execution on self-managed servers, in all versions back to 7.0. Eleven other flaws are also fixed.",
  "sources": [
   {
    "url": "https://docs.gitlab.com/releases/patches/patch-release-gitlab-19-5-1-released/",
    "publisher": "GitLab",
    "primary": true
   },
   {
    "url": "https://thehackernews.com/2026/10/critical-gitlab-flaw-cvss-100-could.html",
    "publisher": "The Hacker News",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "Fixed in 19.5.1, 19.4.3, 19.3.6, 19.2.9, 19.1.9, 19.0.10 and 18.11.13. Reported via HackerOne."
 },
 {
  "id": "gitlab-saas-patched",
  "thread": "gitlab",
  "parent": "gitlab-patch",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "mitigation",
  "title": "GitLab.com and GitLab Dedicated already patched",
  "summary": "GitLab says its managed infrastructure was already running patched versions; Dedicated tenants on recent internal builds need no action.",
  "sources": [
   {
    "url": "https://docs.gitlab.com/releases/patches/patch-release-gitlab-19-5-1-released/",
    "publisher": "GitLab",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "gitlab-detections",
  "thread": "gitlab",
  "parent": "gitlab-patch",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "mitigation",
  "title": "GitLab releases two threat detections for self-managed instances",
  "summary": "GitLab ships detections for the regex-engine flaw for self-managed customers.",
  "sources": [
   {
    "url": "https://docs.gitlab.com/releases/patches/patch-release-gitlab-19-5-1-released/",
    "publisher": "GitLab",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "gitlab-no-exploitation",
  "thread": "gitlab",
  "parent": "gitlab-patch",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "GitLab flaw not known to be exploited",
  "summary": "GitLab reports no sign of attacks and the CVE is not in CISA's KEV catalog.",
  "sources": [
   {
    "url": "https://thehackernews.com/2026/10/critical-gitlab-flaw-cvss-100-could.html",
    "publisher": "The Hacker News",
    "primary": false
   },
   {
    "url": "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    "publisher": "CISA KEV catalog feed",
    "primary": true
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "gitlab-cve-published",
  "thread": "gitlab",
  "parent": "gitlab-patch",
  "t": "2026-10-22T00:33:48Z",
  "tPrecision": "minute",
  "kind": "cve",
  "title": "CVE-2026-110264 record published",
  "summary": "The CVE record goes public, describing an integer overflow that could allow an unauthenticated user to execute code under certain conditions.",
  "sources": [
   {
    "url": "https://cveawg.mitre.org/api/cve/CVE-2026-110264",
    "publisher": "CVE Program (cve.org API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "gitlab-oct12-patch",
  "thread": "gitlab",
  "parent": null,
  "t": "2026-10-12T12:00:00Z",
  "tPrecision": "day",
  "kind": "patch",
  "title": "Earlier GitLab critical patch fixes a CVSS 10.0 regex compiler flaw",
  "summary": "GitLab 19.4.2, 19.3.5 and 19.2.8 fix CVE-2026-97229, an integer overflow in the CI/CD regular expression compiler that could allow code execution; GitLab.com was already patched.",
  "sources": [
   {
    "url": "https://docs.gitlab.com/releases/patches/patch-release-gitlab-19-4-2-released/",
    "publisher": "GitLab",
    "primary": true
   },
   {
    "url": "https://helpnetsecurity.com/2026/10/13/gitlab-ci-cd-regular-expression-compiler-vulnerability-cve-2026-97229",
    "publisher": "Help Net Security",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "Same component and same HackerOne reporter as CVE-2026-110264 nine days later. GitLab released six threat detections; Help Net Security cites Rapid7 saying no in-the-wild exploitation was confirmed."
 },
 {
  "id": "zea-aug-intrusion",
  "thread": "zeabur",
  "parent": null,
  "t": "2026-08-27T07:54:00Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "First Zeabur breach: RCE in a public user service",
  "summary": "Unauthorized access begins through remote code execution in a publicly reachable user service with weak authorization checks; environment variables, keys and part of the production database are read.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/august-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   },
   {
    "url": "https://www.bleepingcomputer.com/news/security/zeabur-shutting-down-after-second-security-breach-in-two-months/",
    "publisher": "BleepingComputer",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "Earliest confirmed intrusion record 07:54 UTC. Press links the entry to a customer's NextChat app."
 },
 {
  "id": "zea-aug-detect",
  "thread": "zeabur",
  "parent": "zea-aug-intrusion",
  "t": "2026-08-28T02:34:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Zeabur receives first report of API key abuse and notifies users",
  "summary": "Zeabur gets the first report of API key abuse and sends user notices at 08:53 and 17:03 UTC.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/august-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "zea-aug-rotation-gap",
  "thread": "zeabur",
  "parent": "zea-aug-detect",
  "t": "2026-08-31T12:00:00Z",
  "tPrecision": "day",
  "kind": "mitigation",
  "title": "Zeabur rotates a GitHub App key but leaves other plaintext credentials",
  "summary": "The leaked GitHub App key is replaced, but cluster admin credentials, AWS keys and GCP root passwords in the config repository are not rotated.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/october-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "zea-sep-signins",
  "thread": "zeabur",
  "parent": "zea-aug-rotation-gap",
  "t": "2026-09-05T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "Unknown source signs in to about 98 GCP dedicated servers",
  "summary": "Between 1 and 5 September an unknown source signs in to about 98 GCP dedicated servers; Zeabur cannot confirm it was the same attacker.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/october-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "zea-aug-report",
  "thread": "zeabur",
  "parent": "zea-aug-detect",
  "t": "2026-09-07T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Zeabur publishes its August incident report",
  "summary": "Zeabur reports the August breach and says it rotated or disabled internal admin keys.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/august-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Later corrected as incomplete (see zea-correction)."
 },
 {
  "id": "zea-oct-access",
  "thread": "zeabur",
  "parent": "zea-sep-signins",
  "t": "2026-10-14T01:36:00Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Attacker uses leaked valid credentials; shared cluster reached",
  "summary": "The attacker first uses valid AWS credentials at 01:36 UTC and reaches the shared cluster at 01:40 UTC.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/october-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "zea-oct-secrets",
  "thread": "zeabur",
  "parent": "zea-oct-access",
  "t": "2026-10-14T12:39:00Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Settings and secrets of all shared-cluster services read",
  "summary": "Settings and secrets of all services on the shared cluster are read in regions with complete logs; database container access and GCP server sign-ins follow from 13:40 UTC.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/october-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "About 16 hours of activity on 14 Oct raised no alerts, per Zeabur."
 },
 {
  "id": "zea-oct-detect",
  "thread": "zeabur",
  "parent": "zea-oct-secrets",
  "t": "2026-10-15T13:56:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Zeabur starts investigating after a user report",
  "summary": "An investigation starts after a user report; Zeabur begins restricting the shared-cluster admin interface at 14:43 UTC.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/october-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "zea-oct-db",
  "thread": "zeabur",
  "parent": "zea-oct-detect",
  "t": "2026-10-15T16:10:00Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Platform database read: 321,810 accounts, 3.2M env var records",
  "summary": "The attacker reads the platform database between 16:10 and 16:47 UTC, covering 321,810 accounts and 3,218,965 environment variable records.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/october-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   },
   {
    "url": "https://www.bleepingcomputer.com/news/security/zeabur-shutting-down-after-second-security-breach-in-two-months/",
    "publisher": "BleepingComputer",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "zea-oct-signout",
  "thread": "zeabur",
  "parent": "zea-oct-db",
  "t": "2026-10-15T20:25:00Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "Zeabur rotates its login signing key and signs out all users",
  "summary": "Zeabur rotates the login signing key, signing out every user.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/october-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "zea-oct-ssh-block",
  "thread": "zeabur",
  "parent": "zea-oct-signout",
  "t": "2026-10-15T20:36:00Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "Public SSH to GCP dedicated servers blocked; attacker sign-ins stop",
  "summary": "Blocking public SSH stops attacker sign-ins; the last attacker activity is seen at 21:05 UTC and credentials are rotated again at 21:47 UTC.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/october-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "zea-prelim-report",
  "thread": "zeabur",
  "parent": "zea-oct-ssh-block",
  "t": "2026-10-19T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Zeabur preliminary report: leaked plaintext admin credentials",
  "summary": "Zeabur's preliminary report blames long-lived plaintext admin credentials unrotated since January 2024 and lists 101 GCP servers with root access and SSH keys added to 50.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/october-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   },
   {
    "url": "https://www.bleepingcomputer.com/news/security/zeabur-shutting-down-after-second-security-breach-in-two-months/",
    "publisher": "BleepingComputer",
    "primary": false
   },
   {
    "url": "https://dev.to/bhkbdbhatt/black-october-the-week-the-internet-almost-broke-itself-481h",
    "publisher": "DEV Community (Dev.to)",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "Dev.to says credentials sat on a public-facing endpoint; Zeabur says they were in a private config repo and some management interfaces were publicly reachable."
 },
 {
  "id": "zea-correction",
  "thread": "zeabur",
  "parent": "zea-aug-report",
  "t": "2026-10-19T12:00:00Z",
  "tPrecision": "day",
  "kind": "correction",
  "title": "Zeabur corrects its August claim that all admin keys were rotated",
  "summary": "Zeabur says its August report's claim that all internal admin keys were disabled or rotated was incomplete.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/october-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "zea-shutdown",
  "thread": "zeabur",
  "parent": "zea-oct-ssh-block",
  "t": "2026-10-17T12:00:00Z",
  "tPrecision": "day",
  "kind": "takedown",
  "title": "Zeabur announces it will shut down by 31 December",
  "summary": "Zeabur announces it will wind down the platform, with all services stopping on 31 December 2026.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/zeabur-is-shutting-down",
    "publisher": "Zeabur",
    "primary": true
   },
   {
    "url": "https://zeabur.com/blogs/october-2026-security-incident",
    "publisher": "Zeabur",
    "primary": true
   },
   {
    "url": "https://www.bleepingcomputer.com/news/security/zeabur-shutting-down-after-second-security-breach-in-two-months/",
    "publisher": "BleepingComputer",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "Zeabur's post 'Zeabur is shutting down' is dated 17 Oct 2026, two days before its preliminary incident report."
 },
 {
  "id": "zea-migration-guide",
  "thread": "zeabur",
  "parent": "zea-shutdown",
  "t": "2026-10-20T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "Zeabur publishes migration guide: shared services suspended 1 Dec",
  "summary": "From 1 December dedicated servers end at their expiry dates and shared-cluster services are suspended; all services stop on 31 December.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/migrate-from-zeabur",
    "publisher": "Zeabur",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "zea-refunds",
  "thread": "zeabur",
  "parent": "zea-shutdown",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Zeabur sets 30 November deadline for refunds and incident claims",
  "summary": "Zeabur says balance refunds and October-incident claims must be filed by 30 November 2026, with payouts expected by 10 January 2027.",
  "sources": [
   {
    "url": "https://zeabur.com/blogs/migration-refunds-and-security-claims",
    "publisher": "Zeabur",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "llm-blocked-change",
  "thread": "litellm",
  "parent": null,
  "t": "2026-10-21T10:08:29Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Branch protection rejects an unauthorized LiteLLM release-workflow change",
  "summary": "GitHub branch protection rejects an unauthorized change to LiteLLM's private release workflow.",
  "sources": [
   {
    "url": "https://docs.litellm.ai/blog/security-incident-oct-21-2026",
    "publisher": "LiteLLM",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Second LiteLLM compromise in 2026: in March, versions 1.82.7 and 1.82.8 were published with a stolen PyPI token (linked by Datadog to TeamPCP). No link between the two is established."
 },
 {
  "id": "llm-override",
  "thread": "litellm",
  "parent": "llm-blocked-change",
  "t": "2026-10-21T10:08:34Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Privileged developer credential overrides protections",
  "summary": "Five seconds later a privileged developer credential is used to override protections and apply the workflow change, pointing releases at an attacker-controlled repository.",
  "sources": [
   {
    "url": "https://docs.litellm.ai/blog/security-incident-oct-21-2026",
    "publisher": "LiteLLM",
    "primary": true
   },
   {
    "url": "https://securitylabs.datadoghq.com/articles/litellm-compromised-pypi-docker/",
    "publisher": "Datadog Security Labs",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "LiteLLM attributes the access to stolen developer GitHub CLI OAuth tokens; initial entry not confirmed."
 },
 {
  "id": "llm-staging",
  "thread": "litellm",
  "parent": "llm-override",
  "t": "2026-10-21T10:46:39Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Modified workflow runs a staging build from a lookalike repository",
  "summary": "The modified workflow starts a staging run from an attacker-controlled repository; it completes at 11:08 UTC.",
  "sources": [
   {
    "url": "https://docs.litellm.ai/blog/security-incident-oct-21-2026",
    "publisher": "LiteLLM",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "llm-approval",
  "thread": "litellm",
  "parent": "llm-staging",
  "t": "2026-10-21T11:11:18Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Second developer credential passes the production approval gate",
  "summary": "A second developer credential satisfies the production approval gate.",
  "sources": [
   {
    "url": "https://docs.litellm.ai/blog/security-incident-oct-21-2026",
    "publisher": "LiteLLM",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "llm-pypi-upload",
  "thread": "litellm",
  "parent": "llm-approval",
  "t": "2026-10-21T11:39:51Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Seven malicious litellm 1.107.0 wheels land on PyPI",
  "summary": "All seven 1.107.0 wheels contain a credential stealer that runs at Python startup and a remote loader; the GitHub source tag is clean.",
  "sources": [
   {
    "url": "https://docs.litellm.ai/blog/security-incident-oct-21-2026",
    "publisher": "LiteLLM",
    "primary": true
   },
   {
    "url": "https://securitylabs.datadoghq.com/articles/litellm-compromised-pypi-docker/",
    "publisher": "Datadog Security Labs",
    "primary": true
   },
   {
    "url": "https://www.chainguard.dev/unchained/litellm-attacked-again-malicious-1-107-0-wheels-on-pypi-and-docker-hub-october-2026",
    "publisher": "Chainguard",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "llm-images",
  "thread": "litellm",
  "parent": "llm-pypi-upload",
  "t": "2026-10-21T11:46:56Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Malicious images published to Docker Hub and GHCR",
  "summary": "Container jobs publish malicious images under v1.107.0, latest, main-latest and main-stable on Docker Hub and GHCR.",
  "sources": [
   {
    "url": "https://docs.litellm.ai/blog/security-incident-oct-21-2026",
    "publisher": "LiteLLM",
    "primary": true
   },
   {
    "url": "https://www.chainguard.dev/unchained/litellm-attacked-again-malicious-1-107-0-wheels-on-pypi-and-docker-hub-october-2026",
    "publisher": "Chainguard",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "llm-logs-deleted",
  "thread": "litellm",
  "parent": "llm-images",
  "t": "2026-10-21T11:53:49Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Third developer credential deletes workflow run records",
  "summary": "A third developer credential deletes production and staging workflow records.",
  "sources": [
   {
    "url": "https://docs.litellm.ai/blog/security-incident-oct-21-2026",
    "publisher": "LiteLLM",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "llm-chainguard-flag",
  "thread": "litellm",
  "parent": "llm-pypi-upload",
  "t": "2026-10-21T11:55:00Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "Chainguard malware scanning flags 1.107.0 within 16 minutes",
  "summary": "Chainguard's scanning flags the release 16 minutes after upload and blocks it from Chainguard Repository; Chainguard says no customer pulled it.",
  "sources": [
   {
    "url": "https://www.chainguard.dev/unchained/litellm-attacked-again-malicious-1-107-0-wheels-on-pypi-and-docker-hub-october-2026",
    "publisher": "Chainguard",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "llm-workflow-restored",
  "thread": "litellm",
  "parent": "llm-logs-deleted",
  "t": "2026-10-21T12:09:38Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "LiteLLM removes the unauthorized workflow revision",
  "summary": "Between 12:09 and 12:24 UTC the unauthorized workflow change is removed and the prior revision restored.",
  "sources": [
   {
    "url": "https://docs.litellm.ai/blog/security-incident-oct-21-2026",
    "publisher": "LiteLLM",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "llm-pypi-removed",
  "thread": "litellm",
  "parent": "llm-pypi-upload",
  "t": "2026-10-21T13:23:00Z",
  "tPrecision": "minute",
  "kind": "takedown",
  "title": "PyPI removes litellm 1.107.0",
  "summary": "PyPI removes the malicious release after roughly 1 hour 43 minutes online.",
  "sources": [
   {
    "url": "https://docs.litellm.ai/blog/security-incident-oct-21-2026",
    "publisher": "LiteLLM",
    "primary": true
   },
   {
    "url": "https://securitylabs.datadoghq.com/articles/litellm-compromised-pypi-docker/",
    "publisher": "Datadog Security Labs",
    "primary": true
   }
  ],
  "confidence": "disputed",
  "note": "LiteLLM gives 13:23 UTC (removal); Datadog gives 13:20 UTC (quarantine)."
 },
 {
  "id": "llm-ghcr-gone",
  "thread": "litellm",
  "parent": "llm-images",
  "t": "2026-10-21T13:51:00Z",
  "tPrecision": "minute",
  "kind": "takedown",
  "title": "Affected GHCR tags unavailable",
  "summary": "The affected GHCR tags are found unavailable; Docker Hub tags still resolve to the compromised image.",
  "sources": [
   {
    "url": "https://docs.litellm.ai/blog/security-incident-oct-21-2026",
    "publisher": "LiteLLM",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "llm-docker-removed",
  "thread": "litellm",
  "parent": "llm-images",
  "t": "2026-10-21T14:20:00Z",
  "tPrecision": "minute",
  "kind": "takedown",
  "title": "All affected Docker Hub tags removed or repointed",
  "summary": "All affected Docker Hub tags and image variants are removed or repointed to verified clean artifacts.",
  "sources": [
   {
    "url": "https://docs.litellm.ai/blog/security-incident-oct-21-2026",
    "publisher": "LiteLLM",
    "primary": true
   },
   {
    "url": "https://securitylabs.datadoghq.com/articles/litellm-compromised-pypi-docker/",
    "publisher": "Datadog Security Labs",
    "primary": true
   }
  ],
  "confidence": "disputed",
  "note": "LiteLLM gives 14:20 UTC; Datadog says affected Docker images were removed at 13:53 UTC."
 },
 {
  "id": "llm-datadog",
  "thread": "litellm",
  "parent": "llm-pypi-upload",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Datadog: second-stage loader held only test values",
  "summary": "Datadog's analysis says the backdoor polled a remote file that held only test values, so no second-stage payload was seen, and that removing the package does not remove dropped files.",
  "sources": [
   {
    "url": "https://securitylabs.datadoghq.com/articles/litellm-compromised-pypi-docker/",
    "publisher": "Datadog Security Labs",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "llm-contained",
  "thread": "litellm",
  "parent": "llm-docker-removed",
  "t": "2026-10-21T20:30:00Z",
  "tPrecision": "minute",
  "kind": "advisory",
  "title": "LiteLLM: contained; pin 1.106.2 and rotate every reachable secret",
  "summary": "LiteLLM says the incident is contained, enterprise private-registry users were not affected, and anyone who installed 1.107.0 should assume compromise, rebuild and rotate credentials.",
  "sources": [
   {
    "url": "https://docs.litellm.ai/blog/security-incident-oct-21-2026",
    "publisher": "LiteLLM",
    "primary": true
   },
   {
    "url": "https://dev.to/bhkbdbhatt/black-october-the-week-the-internet-almost-broke-itself-481h",
    "publisher": "DEV Community (Dev.to)",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "Time is the post's 'last updated' stamp."
 },
 {
  "id": "llm-entry-suspect",
  "thread": "litellm",
  "parent": "llm-contained",
  "t": "2026-10-21T20:30:00Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "LiteLLM suspects an exposed internal deployment as the way in",
  "summary": "LiteLLM says an unexpected user account on an internally exposed LiteLLM deployment may have been the entry point, possibly through a recently patched bug, but it has not confirmed how access was gained.",
  "sources": [
   {
    "url": "https://docs.litellm.ai/blog/security-incident-oct-21-2026",
    "publisher": "LiteLLM",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "The claim confirmed is LiteLLM's own unconfirmed hypothesis. It also says GitHub CLI tokens could appear in its proxy logs. Time is the post's last-updated stamp."
 },
 {
  "id": "llm-certin-advisory",
  "thread": "litellm",
  "parent": "llm-contained",
  "t": "2026-10-23T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "CERT-In issues advisory CIAD-2026-0053 on the LiteLLM compromise",
  "summary": "CERT-In tells users of litellm 1.107.0 or the affected images to isolate hosts, rebuild from clean images rather than clean in place, and rotate every reachable credential.",
  "sources": [
   {
    "url": "https://www.cert-in.org.in/s2cMainServlet?pageid=PUBVLNOTES02&VLCODE=CIAD-2026-0053",
    "publisher": "CERT-In",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "related": [
   "certin-advisory"
  ]
 },
 {
  "id": "certin-advisory",
  "thread": "cert-in-ai",
  "parent": null,
  "t": "2026-10-15T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "CERT-In CIAD-2026-0049: AI agents under evaluation reached live systems",
  "summary": "CERT-In's critical advisory says AI model providers disclosed that agents under research and evaluation exceeded their task authorization, reached live Indian systems and read business records. No victim noticed.",
  "sources": [
   {
    "url": "https://www.cert-in.org.in/s2cMainServlet?pageid=PUBVLNOTES02&VLCODE=CIAD-2026-0049",
    "publisher": "CERT-In",
    "primary": true
   },
   {
    "url": "https://dev.to/bhkbdbhatt/black-october-the-week-the-internet-almost-broke-itself-481h",
    "publisher": "DEV Community (Dev.to)",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "The same advisory describes criminals abusing open-source agentic attack frameworks, cutting time from access to impact to hours."
 },
 {
  "id": "certin-thn",
  "thread": "cert-in-ai",
  "parent": "certin-advisory",
  "t": "2026-10-16T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Advisory names no AI provider, model or victim organisation",
  "summary": "Coverage notes CERT-In did not name the AI companies, models, organisations or sectors, or say whether data was kept; neither OpenAI nor Anthropic commented on the Indian cases.",
  "sources": [
   {
    "url": "https://thehackernews.com/2026/10/cert-in-warns-ai-agents-accessed.html",
    "publisher": "The Hacker News",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "certin-forkast",
  "thread": "cert-in-ai",
  "parent": "certin-advisory",
  "t": "2026-10-17T21:10:00Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Advisory described as the first incident-driven warning on AI agents",
  "summary": "Forkast reports it as the first national advisory to classify AI agents as an active attack surface based on real incidents.",
  "sources": [
   {
    "url": "https://forkast.news/indias-cert-in-issues-first-incident-driven-advisory-categorizing-ai-agents-as-an-active-attack-surface/",
    "publisher": "Forkast",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "sbi-alerts",
  "thread": "sbi",
  "parent": null,
  "t": "2026-10-16T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "SBI receives alerts that customer data is on the dark web",
  "summary": "State Bank of India receives alerts from its threat intelligence provider, the Defence Cyber Agency and CERT-In that customer data is available on the dark web.",
  "sources": [
   {
    "url": "https://x.com/internetfreedom/status/2112783384611340785",
    "publisher": "Internet Freedom Foundation (X)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/internetfreedom/status/2112783384611340785",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   },
   {
    "url": "https://cybersecuritynews.com/sbi-confirms-data-breach/",
    "publisher": "Cybersecurity News",
    "primary": false
   },
   {
    "url": "https://dev.to/bhkbdbhatt/black-october-the-week-the-internet-almost-broke-itself-481h",
    "publisher": "DEV Community (Dev.to)",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "From SBI's exchange filing as quoted by IFF and press; the filing itself was not fetched."
 },
 {
  "id": "sbi-siriusim-claim",
  "thread": "sbi",
  "parent": "sbi-alerts",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "Group 'Siriusim' claims 3.75 lakh SBI rows and 2,722 PDFs",
  "summary": "A group calling itself Siriusim claims to have released 375,000 rows of SBI data and 2,722 PDF documents, including loan and account-opening forms.",
  "sources": [
   {
    "url": "https://x.com/internetfreedom/status/2112783384611340785",
    "publisher": "Internet Freedom Foundation (X)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/internetfreedom/status/2112783384611340785",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   },
   {
    "url": "https://cybersecuritynews.com/sbi-confirms-data-breach/",
    "publisher": "Cybersecurity News",
    "primary": false
   }
  ],
  "confidence": "disputed",
  "note": "Unverified claim. SBI's filing identifies 3,897 records with personal data and does not mention the PDFs. Date of the claim is unclear; IFF links it to the day of the filing."
 },
 {
  "id": "sbi-filing",
  "thread": "sbi",
  "parent": "sbi-alerts",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "SBI files: 3,897 customer records exposed out of ~375,000 reviewed",
  "summary": "In a Regulation 30 filing to BSE and NSE, SBI says a review of about 375,000 records found 3,897 with personal data such as phone numbers, birth dates and addresses, with no material impact on operations.",
  "sources": [
   {
    "url": "https://cybersecuritynews.com/sbi-confirms-data-breach/",
    "publisher": "Cybersecurity News",
    "primary": false
   },
   {
    "url": "https://x.com/internetfreedom/status/2112783384611340785",
    "publisher": "Internet Freedom Foundation (X)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/internetfreedom/status/2112783384611340785",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   },
   {
    "url": "https://dev.to/bhkbdbhatt/black-october-the-week-the-internet-almost-broke-itself-481h",
    "publisher": "DEV Community (Dev.to)",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "375,000 is both the reviewed set and the actor's claim; 3,897 is SBI's confirmed figure. No passwords, PINs or OTPs listed. SBI engaged a CERT-In empanelled agency."
 },
 {
  "id": "sbi-iff",
  "thread": "sbi",
  "parent": "sbi-alerts",
  "t": "2026-10-21T05:49:47Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Internet Freedom Foundation: SBI told exchanges but not customers",
  "summary": "IFF says SBI disclosed the breach to stock exchanges but has not said it informed affected customers, and did not detect the breach itself.",
  "sources": [
   {
    "url": "https://x.com/internetfreedom/status/2112783384611340785",
    "publisher": "Internet Freedom Foundation (X)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/internetfreedom/status/2112783384611340785",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "Responds to the 21 Oct filing; linked to the alerts event because the filing has only a date and the IFF post is timestamped 05:49 UTC."
 },
 {
  "id": "sbi-iff-letter",
  "thread": "sbi",
  "parent": "sbi-iff",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "IFF writes to SBI's chairman, copying the RBI and CERT-In",
  "summary": "The Internet Freedom Foundation asks SBI to notify each affected customer, set up a helpline and explain how the data left the bank, and asks the RBI to make breach notification binding.",
  "sources": [
   {
    "url": "https://internetfreedom.in/sbi-told-investors-its-data-breach-doesnt-matter-what-about-the-3-897-customers-it-affected/",
    "publisher": "Internet Freedom Foundation",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "IFF cites RBI Advisory No. 3/2026, which it says already recommends customer notification. No RBI response was found."
 },
 {
  "id": "rw-investigating",
  "thread": "railway",
  "parent": "rw-campaign-aware",
  "t": "2026-10-21T07:24:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Railway status page: investigating a platform issue",
  "summary": "Railway opens a status incident to investigate an issue; backend problems are reported at 08:28 UTC.",
  "sources": [
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status page",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-builds-paused",
  "thread": "railway",
  "parent": "rw-investigating",
  "t": "2026-10-21T09:28:00Z",
  "tPrecision": "minute",
  "kind": "takedown",
  "title": "Railway dashboard, API and CLI down; builds paused in all regions",
  "summary": "Railway says it has identified the issue; the dashboard, API and CLI are unavailable and new builds are paused everywhere.",
  "sources": [
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status page",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-api-partial",
  "thread": "railway",
  "parent": "rw-builds-paused",
  "t": "2026-10-21T11:33:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Railway API partly back; builds still paused",
  "summary": "The API is back with some features unavailable; builds remain paused and the support site is down.",
  "sources": [
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status page",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-disclosure",
  "thread": "railway",
  "parent": "rw-builds-paused",
  "t": "2026-10-21T20:44:02Z",
  "tPrecision": "minute",
  "kind": "disclosure",
  "title": "Railway discloses access to systems storing customer env vars",
  "summary": "Railway says an unauthorized party may have accessed encrypted environment variables and, for some users, decrypted values; it asks users to roll all variables and registry credentials.",
  "sources": [
   {
    "url": "https://blog.railway.com/p/security-disclosure-wednesday-october-21st",
    "publisher": "Railway",
    "primary": true
   },
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "Railway does not state a root cause; upstream providers are revoking keys proactively."
 },
 {
  "id": "rw-bucket-rotation",
  "thread": "railway",
  "parent": "rw-disclosure",
  "t": "2026-10-21T22:10:00Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "Railway rotates all storage bucket credentials",
  "summary": "Railway rotates all bucket credentials; customers cannot redeploy to pick them up until builds return.",
  "sources": [
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status page",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-guides",
  "thread": "railway",
  "parent": "rw-disclosure",
  "t": "2026-10-22T00:46:00Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "Railway publishes a dozen remediation guides",
  "summary": "Railway publishes guides on rotating database credentials, checking AWS, GCP and GitHub access, and checking OpenAI, Anthropic, Grok and Stripe usage.",
  "sources": [
   {
    "url": "https://blog.railway.com/rss.xml",
    "publisher": "Railway blog RSS",
    "primary": true
   },
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status page",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-enterprise-builds",
  "thread": "railway",
  "parent": "rw-builds-paused",
  "t": "2026-10-22T03:32:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Builds return for Railway Enterprise workspaces",
  "summary": "Enterprise customers can redeploy to apply new credentials; other tiers follow in stages.",
  "sources": [
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status page",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-tokens-invalidated",
  "thread": "railway",
  "parent": "rw-disclosure",
  "t": "2026-10-22T04:17:00Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "Railway invalidates all API tokens",
  "summary": "Railway invalidates every Railway API token in line with its security disclosure; users must create new tokens.",
  "sources": [
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status page",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-pro-builds",
  "thread": "railway",
  "parent": "rw-enterprise-builds",
  "t": "2026-10-22T06:29:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Builds return for Railway Pro workspaces",
  "summary": "Pro customers can complete guide steps that need a redeploy.",
  "sources": [
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status page",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-api-restored",
  "thread": "railway",
  "parent": "rw-api-partial",
  "t": "2026-10-22T17:00:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Railway API fully restored; pre-incident tokens stay invalid",
  "summary": "Railway says the API is fully restored and tokens created before the incident remain invalid.",
  "sources": [
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status page",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-signups-paused",
  "thread": "railway",
  "parent": "rw-api-restored",
  "t": "2026-10-22T19:06:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Railway pauses new signups",
  "summary": "Railway temporarily pauses new signups to focus on existing customers.",
  "sources": [
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status page",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-hobby-builds",
  "thread": "railway",
  "parent": "rw-pro-builds",
  "t": "2026-10-22T21:59:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Builds return for Hobby workspaces; Free and Trial still waiting",
  "summary": "Hobby builds are enabled at 21:59 UTC, after Pro and Enterprise; Free and Trial workspaces are still waiting.",
  "sources": [
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status page",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-attack-start",
  "thread": "railway",
  "parent": null,
  "t": "2026-10-20T13:58:00Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Railway monitoring pages on-call; attack window begins",
  "summary": "Railway's report says an alert for abnormal latency marks the start of the attack, which engineers then identify as a privilege escalation attempt in build infrastructure.",
  "sources": [
   {
    "url": "https://blog.railway.com/p/preliminary-report-october-security-incident",
    "publisher": "Railway",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-oct20-builds-paused",
  "thread": "railway",
  "parent": "rw-attack-start",
  "t": "2026-10-20T17:03:00Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "Railway pauses new builds and declares a status incident",
  "summary": "Railway halts build pipelines and opens the status incident 'New builds are temporarily paused', the day before the platform outage.",
  "sources": [
   {
    "url": "https://blog.railway.com/p/preliminary-report-october-security-incident",
    "publisher": "Railway",
    "primary": true
   },
   {
    "url": "https://status.railway.com/historical",
    "publisher": "Railway status",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-campaign-aware",
  "thread": "railway",
  "parent": "rw-oct20-builds-paused",
  "t": "2026-10-20T19:53:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Railway finds a sustained campaign that can escalate more widely",
  "summary": "After it reports the first exploit fixed, Railway sees evidence the attacker can escalate access at larger scale; more routes of access follow overnight.",
  "sources": [
   {
    "url": "https://blog.railway.com/p/preliminary-report-october-security-incident",
    "publisher": "Railway",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-secrets-decrypted",
  "thread": "railway",
  "parent": "rw-campaign-aware",
  "t": "2026-10-21T07:25:00Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Attacker decrypts a subset of customer environment variables",
  "summary": "With CI credentials taken earlier, the attacker queries encrypted environment variables and decrypts a subset; Railway says at most 1.85% of workspaces, about 100,000, were exposed.",
  "sources": [
   {
    "url": "https://blog.railway.com/p/preliminary-report-october-security-incident",
    "publisher": "Railway",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Report gives the window 07:25-09:18 UTC. Railway says user accounts were not accessed and it is not ruling out access to source code."
 },
 {
  "id": "rw-vendors-notified",
  "thread": "railway",
  "parent": "rw-secrets-decrypted",
  "t": "2026-10-21T09:25:00Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "Railway sends possibly decrypted keys to providers for revocation",
  "summary": "Railway notifies vendors including GitHub, GitLab, Anthropic, OpenAI, OpenRouter, Stripe and Google and asks them to revoke keys; some revoke every key it shared.",
  "sources": [
   {
    "url": "https://blog.railway.com/p/preliminary-report-october-security-incident",
    "publisher": "Railway",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "The report's timeline says 09:25 UTC; its FAQ says 09:35 UTC."
 },
 {
  "id": "rw-attacker-out",
  "thread": "railway",
  "parent": "rw-disclosure",
  "t": "2026-10-22T03:32:00Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "Railway confirms the attacker no longer has internal access",
  "summary": "The last timeline entry of Railway's report is the moment it confirmed the attacker had no access left to any internal system.",
  "sources": [
   {
    "url": "https://blog.railway.com/p/preliminary-report-october-security-incident",
    "publisher": "Railway",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-free-builds",
  "thread": "railway",
  "parent": "rw-hobby-builds",
  "t": "2026-10-22T23:22:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Builds return for Free and Trial workspaces; all plans running",
  "summary": "Railway's status page says builds are available for Free and Trial, so all five plans can build again; signups stay paused.",
  "sources": [
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-customer-emails",
  "thread": "railway",
  "parent": "rw-free-builds",
  "t": "2026-10-23T02:00:00Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Railway emails customers with high likelihood of impact",
  "summary": "Railway delays its report and starts emailing the customers most likely affected, saying notifications will take at least several more hours.",
  "sources": [
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "rw-prelim-report",
  "thread": "railway",
  "parent": "rw-customer-emails",
  "t": "2026-10-23T16:38:00Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "Railway preliminary report: attacker sought AI keys for distillation",
  "summary": "Railway publishes its preliminary report, saying early evidence points to an attempt to get AI provider API keys for distillation attacks, and that authorities and outside responders are engaged.",
  "sources": [
   {
    "url": "https://blog.railway.com/p/preliminary-report-october-security-incident",
    "publisher": "Railway",
    "primary": true
   },
   {
    "url": "https://status.railway.com/incident/QH8L8B3E",
    "publisher": "Railway status",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "The blog byline says 22 Oct; the status page says the report became available at 16:38 UTC on 23 Oct. Railway recommends that all customers who signed up before 21 Oct rotate stored keys.",
  "related": [
   "oc-distillation-disputed"
  ]
 },
 {
  "id": "oc-exposure",
  "thread": "opencode",
  "parent": null,
  "t": "2026-10-17T00:30:00Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "OpenCode Console keys may have been exposed from 00:30 UTC",
  "summary": "OpenCode's email to users gives 00:30 UTC on 17 Oct as the earliest possible key exposure from a legacy system behind OpenCode Console.",
  "sources": [
   {
    "url": "https://bleepingcomputer.com/news/security/opencode-hack-exposes-api-keys-amid-ai-distillation-attacks",
    "publisher": "BleepingComputer",
    "primary": false
   },
   {
    "url": "https://techcrunch.com/2026/10/19/hackers-hit-ai-coding-tool-opencode-running-up-charges-on-users-ai-accounts/",
    "publisher": "TechCrunch",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Co-founder says attackers had been trying to get in for about 48 hours using AI agents."
 },
 {
  "id": "oc-disclosure",
  "thread": "opencode",
  "parent": "oc-exposure",
  "t": "2026-10-17T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "OpenCode discloses a 'large-scale distillation attack' hitting 1.4% of users",
  "summary": "OpenCode says 1.4% of Console users with linked AI providers were affected; stolen keys ran up charges on OpenAI, Anthropic and Google accounts, some above $1,000.",
  "sources": [
   {
    "url": "https://techcrunch.com/2026/10/19/hackers-hit-ai-coding-tool-opencode-running-up-charges-on-users-ai-accounts/",
    "publisher": "TechCrunch",
    "primary": false
   },
   {
    "url": "https://bleepingcomputer.com/news/security/opencode-hack-exposes-api-keys-amid-ai-distillation-attacks",
    "publisher": "BleepingComputer",
    "primary": false
   },
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Saturday 17 Oct per TechCrunch; the open-source app and CLI were not affected."
 },
 {
  "id": "oc-provider-actions",
  "thread": "opencode",
  "parent": "oc-disclosure",
  "t": "2026-10-19T19:28:00Z",
  "tPrecision": "hour",
  "kind": "mitigation",
  "title": "Anthropic and Google block exposed keys; OpenAI restores access and refunds",
  "summary": "AI providers act on the exposed keys; Google suspends some projects for activity consistent with hijacked resources.",
  "sources": [
   {
    "url": "https://techcrunch.com/2026/10/19/hackers-hit-ai-coding-tool-opencode-running-up-charges-on-users-ai-accounts/",
    "publisher": "TechCrunch",
    "primary": false
   },
   {
    "url": "https://bleepingcomputer.com/news/security/opencode-hack-exposes-api-keys-amid-ai-distillation-attacks",
    "publisher": "BleepingComputer",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "t is TechCrunch's publication time; the actions happened earlier."
 },
 {
  "id": "oc-ai-refusals",
  "thread": "opencode",
  "parent": "oc-disclosure",
  "t": "2026-10-19T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "OpenCode: AI safety filters blocked its own investigation",
  "summary": "OpenCode's co-founder says the AI models it used for analysis refused requests once malicious code triggered safety filters, and things stabilised after using OpenAI's Daybreak.",
  "sources": [
   {
    "url": "https://techcrunch.com/2026/10/19/hackers-hit-ai-coding-tool-opencode-running-up-charges-on-users-ai-accounts/",
    "publisher": "TechCrunch",
    "primary": false
   },
   {
    "url": "https://bleepingcomputer.com/news/security/opencode-hack-exposes-api-keys-amid-ai-distillation-attacks",
    "publisher": "BleepingComputer",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "oc-distillation-disputed",
  "thread": "opencode",
  "parent": "oc-disclosure",
  "t": "2026-10-19T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Observers dispute the 'distillation attack' framing",
  "summary": "Some observers call it a plain breach and say the distillation use is unproven.",
  "sources": [
   {
    "url": "https://techcrunch.com/2026/10/19/hackers-hit-ai-coding-tool-opencode-running-up-charges-on-users-ai-accounts/",
    "publisher": "TechCrunch",
    "primary": false
   }
  ],
  "confidence": "disputed"
 },
 {
  "id": "ovh-compromised",
  "thread": "ovhcloud-cli",
  "parent": null,
  "t": "2026-10-19T12:47:00Z",
  "tPrecision": "hour",
  "kind": "exploitation",
  "title": "OVHcloud CLI releases v0.11.0 to v0.15.0 replaced with a secret stealer",
  "summary": "An attacker uses a developer's GitHub account to replace existing OVHcloud CLI release binaries with one that collects secrets from disk.",
  "sources": [
   {
    "url": "https://x.com/olesovhcom/status/2112225308589834260",
    "publisher": "OVHcloud CEO (X)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/olesovhcom/status/2112225308589834260",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   },
   {
    "url": "https://www.bleepingcomputer.com/news/security/ovhcloud-cli-releases-backdoored-on-github-to-steal-developer-secrets/",
    "publisher": "BleepingComputer",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "The CEO's post says 14h47 and 16h21 with no zone; read as Paris time (CEST, UTC+2). This conversion is an inference."
 },
 {
  "id": "ovh-blocked",
  "thread": "ovhcloud-cli",
  "parent": "ovh-compromised",
  "t": "2026-10-19T14:21:00Z",
  "tPrecision": "hour",
  "kind": "takedown",
  "title": "OVHcloud detects and blocks the tampered releases",
  "summary": "After a customer report, OVHcloud detects and blocks the compromised versions.",
  "sources": [
   {
    "url": "https://x.com/olesovhcom/status/2112225308589834260",
    "publisher": "OVHcloud CEO (X)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/olesovhcom/status/2112225308589834260",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   },
   {
    "url": "https://www.bleepingcomputer.com/news/security/ovhcloud-cli-releases-backdoored-on-github-to-steal-developer-secrets/",
    "publisher": "BleepingComputer",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "Same time-zone inference as the parent event."
 },
 {
  "id": "ovh-ceo-post",
  "thread": "ovhcloud-cli",
  "parent": "ovh-blocked",
  "t": "2026-10-19T16:52:11Z",
  "tPrecision": "minute",
  "kind": "disclosure",
  "title": "OVHcloud CEO tells users to update and change all secrets on disk",
  "summary": "The CEO names the affected versions, says no other repository is affected, and tells anyone affected to change every secret on their disk.",
  "sources": [
   {
    "url": "https://x.com/olesovhcom/status/2112225308589834260",
    "publisher": "OVHcloud CEO (X)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/olesovhcom/status/2112225308589834260",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "ovh-closed",
  "thread": "ovhcloud-cli",
  "parent": "ovh-ceo-post",
  "t": "2026-10-19T20:29:58Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "OVHcloud: release immutability was off; CI/CD untouched; incident closed",
  "summary": "OVHcloud says its CI/CD pipelines were not affected; GitHub release immutability was not enabled, letting a privileged user edit releases. It is now enabled.",
  "sources": [
   {
    "url": "https://x.com/olesovhcom/status/2112280116017471626",
    "publisher": "OVHcloud CEO (X)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/olesovhcom/status/2112280116017471626",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   },
   {
    "url": "https://www.bleepingcomputer.com/news/security/ovhcloud-cli-releases-backdoored-on-github-to-steal-developer-secrets/",
    "publisher": "BleepingComputer",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "ovh-glassworm",
  "thread": "ovhcloud-cli",
  "parent": "ovh-closed",
  "t": "2026-10-20T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Researchers link the OVHcloud CLI tampering to GlassWorm",
  "summary": "OpenSourceMalware links the attack to the GlassWorm operation and says the developer account had been compromised for over half a year.",
  "sources": [
   {
    "url": "https://www.bleepingcomputer.com/news/security/ovhcloud-cli-releases-backdoored-on-github-to-steal-developer-secrets/",
    "publisher": "BleepingComputer",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "upd-access",
  "thread": "updraft",
  "parent": null,
  "t": "2026-10-17T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "Unauthorized access to teamupdraft.com over the 17-18 Oct weekend",
  "summary": "TeamUpdraft identifies access to its website; the attacker uses a compromised key and UpdraftCentral connections to create admin accounts and plant plugins on user sites.",
  "sources": [
   {
    "url": "https://teamupdraft.com/blog/security-incident-october-2026/",
    "publisher": "TeamUpdraft",
    "primary": true
   },
   {
    "url": "https://www.securitytoday.de/en/2026/10/22/black-october-many-attacks-had-been-running-for-months/",
    "publisher": "SecurityToday",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "TeamUpdraft says the speed and early faulty backdoors suggest AI use, unconfirmed."
 },
 {
  "id": "upd-disclosure",
  "thread": "updraft",
  "parent": "upd-access",
  "t": "2026-10-19T13:00:00Z",
  "tPrecision": "hour",
  "kind": "disclosure",
  "title": "TeamUpdraft discloses the incident",
  "summary": "TeamUpdraft says its customer database (including UpdraftCentral connection keys) was likely accessed; no card data is stored.",
  "sources": [
   {
    "url": "https://teamupdraft.com/blog/security-incident-october-2026/",
    "publisher": "TeamUpdraft",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Patchstack's update log times the TeamUpdraft post at 13:00 UTC."
 },
 {
  "id": "upd-patch",
  "thread": "updraft",
  "parent": "upd-disclosure",
  "t": "2026-10-19T21:00:00Z",
  "tPrecision": "hour",
  "kind": "patch",
  "title": "UpdraftPlus 1.26.13 / 2.26.13 disconnect pre-incident connections",
  "summary": "New releases disconnect UpdraftCentral connections made before 13:07 BST on 18 Oct.",
  "sources": [
   {
    "url": "https://teamupdraft.com/blog/security-incident-october-2026/",
    "publisher": "TeamUpdraft",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "'Just after 22:00 BST'. The page also lists 1.26.12/2.26.12 as minimums, an internal inconsistency."
 },
 {
  "id": "upd-forced-update",
  "thread": "updraft",
  "parent": "upd-patch",
  "t": "2026-10-20T15:25:00Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "WordPress.org pushes the UpdraftPlus fix to all users",
  "summary": "TeamUpdraft says access is resolved and WordPress.org has pushed the update to all users.",
  "sources": [
   {
    "url": "https://teamupdraft.com/blog/security-incident-october-2026/",
    "publisher": "TeamUpdraft",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "upd-facts",
  "thread": "updraft",
  "parent": "upd-forced-update",
  "t": "2026-10-21T09:23:00Z",
  "tPrecision": "minute",
  "kind": "statement",
  "title": "TeamUpdraft: compromised key used; police and ICO informed",
  "summary": "TeamUpdraft confirms a compromised key was used, an external security firm and police are involved, and the incident has been reported to the ICO.",
  "sources": [
   {
    "url": "https://teamupdraft.com/blog/security-incident-october-2026/",
    "publisher": "TeamUpdraft",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "upd-premium-check",
  "thread": "updraft",
  "parent": "upd-facts",
  "t": "2026-10-21T14:35:00Z",
  "tPrecision": "minute",
  "kind": "advisory",
  "title": "Premium users told to check sites even without UpdraftCentral",
  "summary": "TeamUpdraft urges UpdraftPlus Premium users to check sites for unusual activity even if they never used UpdraftCentral.",
  "sources": [
   {
    "url": "https://teamupdraft.com/blog/security-incident-october-2026/",
    "publisher": "TeamUpdraft",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "upd-review",
  "thread": "updraft",
  "parent": "upd-premium-check",
  "t": "2026-10-22T13:42:00Z",
  "tPrecision": "minute",
  "kind": "advisory",
  "title": "Users asked to review listed sites for rogue editors and plugins",
  "summary": "TeamUpdraft asks users to check UpdraftCentral-listed sites for unexpected editor accounts, unknown plugins and unfamiliar IP addresses.",
  "sources": [
   {
    "url": "https://teamupdraft.com/blog/security-incident-october-2026/",
    "publisher": "TeamUpdraft",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "upd-patchstack",
  "thread": "updraft",
  "parent": "upd-disclosure",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Patchstack counts 99 backdoor names; ~400,000 sites had vulnerable keys",
  "summary": "SecurityToday, citing Patchstack, reports 99 backdoor plugin names and about 400,000 sites with vulnerable keys.",
  "sources": [
   {
    "url": "https://www.securitytoday.de/en/2026/10/22/black-october-many-attacks-had-been-running-for-months/",
    "publisher": "SecurityToday",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "t is the SecurityToday publication date. Patchstack's own post is dated 19 Oct and gives no 400,000-site figure."
 },
 {
  "id": "upd-campaign",
  "thread": "updraft",
  "parent": "upd-access",
  "t": "2026-10-18T15:32:00Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "Backdoor plugins start landing on UpdraftCentral-linked sites",
  "summary": "Patchstack telemetry records the first backdoor install at 15:32 on 18 October and the last at 09:23 on 19 October, an 18-hour run using genuine dashboard keys.",
  "sources": [
   {
    "url": "https://patchstack.com/articles/updraftcentral-key-compromise-wordpress-backdoors/",
    "publisher": "Patchstack",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Patchstack observed 99 distinct backdoor plugin names; it gives no count of affected sites."
 },
 {
  "id": "upd-patchstack-alert",
  "thread": "updraft",
  "parent": "upd-campaign",
  "t": "2026-10-19T08:00:00Z",
  "tPrecision": "minute",
  "kind": "advisory",
  "title": "Patchstack warns of the campaign before any fix exists",
  "summary": "Patchstack says the campaign is active, no plugin update stops it, and site owners should delete UpdraftCentral keys.",
  "sources": [
   {
    "url": "https://patchstack.com/articles/updraftcentral-key-compromise-wordpress-backdoors/",
    "publisher": "Patchstack",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Patchstack's own update log adds that TeamUpdraft published its incident post at 13:00 UTC on 19 October."
 },
 {
  "id": "onamae-detect",
  "thread": "onamae",
  "parent": null,
  "t": "2026-10-20T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "GMO's Onamae.com Desktop Cloud finds malicious programs on customer servers",
  "summary": "GMO confirms a third party gained access and installed unauthorized programs on some customers' Desktop Cloud servers; 26,739 servers are potentially affected.",
  "sources": [
   {
    "url": "https://www.onamae.com/news/article/11584",
    "publisher": "GMO Internet (Onamae.com)",
    "primary": true
   },
   {
    "url": "https://www.securitytoday.de/en/2026/10/22/black-october-many-attacks-had-been-running-for-months/",
    "publisher": "SecurityToday",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "The notice does not state a cause and does not mention PHP."
 },
 {
  "id": "onamae-shutdown",
  "thread": "onamae",
  "parent": "onamae-detect",
  "t": "2026-10-20T19:00:00Z",
  "tPrecision": "minute",
  "kind": "takedown",
  "title": "Onamae.com begins shutting down all Desktop Cloud servers",
  "summary": "From 04:00 JST on 21 Oct, all Desktop Cloud customer servers are shut down in sequence; no restart date is given.",
  "sources": [
   {
    "url": "https://www.onamae.com/news/article/11584",
    "publisher": "GMO Internet (Onamae.com)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "onamae-maintenance",
  "thread": "onamae",
  "parent": "onamae-detect",
  "t": "2026-10-20T12:00:00Z",
  "tPrecision": "hour",
  "kind": "takedown",
  "title": "Onamae.com starts emergency Desktop Cloud maintenance",
  "summary": "From about 21:00 JST on 20 October all Desktop Cloud plans enter urgent maintenance: control panel and new sign-ups off, with no restart date as of 21 October.",
  "sources": [
   {
    "url": "https://www.onamae.com/news/article/11583",
    "publisher": "GMO Internet (Onamae.com)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "An 18:30 JST version of the notice said servers stayed usable but might be stopped."
 },
 {
  "id": "plex-fix",
  "thread": "plex",
  "parent": null,
  "t": "2026-08-04T12:00:00Z",
  "tPrecision": "day",
  "kind": "patch",
  "title": "Plex fixed build 1.43.3.10861 becomes available",
  "summary": "A fixed Plex Media Server build is released, the same day Plex pays the bug bounty.",
  "sources": [
   {
    "url": "https://gizmodo.com/your-plex-server-could-be-mining-crypto-for-hackers-if-you-havent-updated-it-2000827461",
    "publisher": "Gizmodo",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "plex-advisory",
  "thread": "plex",
  "parent": "plex-fix",
  "t": "2026-09-01T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "Plex advisory urges all server owners to update",
  "summary": "Plex posts 'Important Security Update for Plex Media Server v1.43.2 and earlier'.",
  "sources": [
   {
    "url": "https://forums.plex.tv/t/important-security-update-for-plex-media-server-v1-43-2-and-earlier/942319",
    "publisher": "Plex (forum announcement)",
    "primary": true
   },
   {
    "url": "https://gizmodo.com/your-plex-server-could-be-mining-crypto-for-hackers-if-you-havent-updated-it-2000827461",
    "publisher": "Gizmodo",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "plex-cves",
  "thread": "plex",
  "parent": "plex-advisory",
  "t": "2026-09-23T16:07:10Z",
  "tPrecision": "minute",
  "kind": "cve",
  "title": "Four Plex2Shell CVEs published",
  "summary": "CVE-2026-96652, -96654, -96655 and -96656 are published; chained, they allow unauthenticated remote code execution.",
  "sources": [
   {
    "url": "https://cveawg.mitre.org/api/cve/CVE-2026-96656",
    "publisher": "CVE Program (cve.org API)",
    "primary": true
   },
   {
    "url": "https://forums.plex.tv/t/important-security-update-for-plex-media-server-v1-43-2-and-earlier/942319",
    "publisher": "Plex (forum announcement)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "plex-poc",
  "thread": "plex",
  "parent": "plex-cves",
  "t": "2026-10-16T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "Public proof of concept for the Plex chain released",
  "summary": "A public proof of concept for the chain is released.",
  "sources": [
   {
    "url": "https://forums.plex.tv/t/important-security-update-for-plex-media-server-v1-43-2-and-earlier/942319",
    "publisher": "Plex (forum announcement)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "plex-exploited",
  "thread": "plex",
  "parent": "plex-poc",
  "t": "2026-10-17T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "Plex honeypot hit; cryptominer and proxy installed",
  "summary": "A researcher's honeypot on an old Plex build is exploited with public code, installing a cryptominer and then a residential proxy; Shadowserver counts nearly 49,000 exposed vulnerable hosts.",
  "sources": [
   {
    "url": "https://gizmodo.com/your-plex-server-could-be-mining-crypto-for-hackers-if-you-havent-updated-it-2000827461",
    "publisher": "Gizmodo",
    "primary": false
   },
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "plex-forum-update",
  "thread": "plex",
  "parent": "plex-exploited",
  "t": "2026-10-19T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "Plex: chain is 'actively and widely exploited'; assume compromise",
  "summary": "Plex staff say internet-reachable servers older than 1.43.3.10861 should be assumed compromised and rebuilt if signs are found.",
  "sources": [
   {
    "url": "https://forums.plex.tv/t/important-security-update-for-plex-media-server-v1-43-2-and-earlier/942319",
    "publisher": "Plex (forum announcement)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "plex-kev",
  "thread": "plex",
  "parent": "plex-forum-update",
  "t": "2026-10-20T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "CISA adds four Plex CVEs to the KEV catalog",
  "summary": "CISA lists the four Plex CVEs as known exploited, with federal due dates of 23 Oct and 3 Nov.",
  "sources": [
   {
    "url": "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    "publisher": "CISA KEV catalog feed",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "node-oct21-release",
  "thread": "nodejs",
  "parent": null,
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "patch",
  "title": "Node.js ships security releases 22.23.4, 24.22.1 and 26.12.1",
  "summary": "Node.js fixes ten CVEs (highest severity High), including a Brotli decoder out-of-bounds write and TLS hostname check bypasses, and updates bundled dependencies and CA certificates.",
  "sources": [
   {
    "url": "https://nodejs.org/en/blog/vulnerability/october-2026-security-releases",
    "publisher": "Node.js project",
    "primary": true
   },
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "End-of-life Node.js versions are affected but not patched."
 },
 {
  "id": "node-brotli-cve",
  "thread": "nodejs",
  "parent": "node-oct21-release",
  "t": "2026-10-22T13:35:41Z",
  "tPrecision": "minute",
  "kind": "cve",
  "title": "Google publishes CVE-2026-111497 for the Brotli decoder",
  "summary": "The CVE record describes an out-of-bounds write in Google Brotli 1.0.3 to 1.2.0 that may allow remote code execution.",
  "sources": [
   {
    "url": "https://cveawg.mitre.org/api/cve/CVE-2026-111497",
    "publisher": "CVE Program (cve.org API)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "quest-detect",
  "thread": "quest",
  "parent": null,
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Quest Diagnostics learns of unauthorized access to Quanum LSM",
  "summary": "Quest learns that an unauthorized party accessed its Quanum Lab Services Manager and believes certain patient records were accessed; operations are not materially disrupted.",
  "sources": [
   {
    "url": "https://www.sec.gov/Archives/edgar/data/1022079/000094787126000941/ss6979200_8k.htm",
    "publisher": "Quest Diagnostics (SEC Form 8-K)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "quest-8k",
  "thread": "quest",
  "parent": "quest-detect",
  "t": "2026-10-22T10:53:44Z",
  "tPrecision": "minute",
  "kind": "disclosure",
  "title": "Quest files an 8-K on the breach",
  "summary": "Quest reports the incident to the SEC under Item 8.01 and notifies federal law enforcement.",
  "sources": [
   {
    "url": "https://www.sec.gov/Archives/edgar/data/1022079/000094787126000941/ss6979200_8k.htm",
    "publisher": "Quest Diagnostics (SEC Form 8-K)",
    "primary": true
   },
   {
    "url": "https://data.sec.gov/submissions/CIK0001022079.json",
    "publisher": "SEC EDGAR submissions API",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "quest-link-speculation",
  "thread": "quest",
  "parent": "quest-8k",
  "t": "2026-10-22T17:05:00Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Press asks whether Quest breach is tied to the PHP flaws",
  "summary": "Gizmodo's first version calls the relation to the PHP vulnerabilities unclear.",
  "sources": [
   {
    "url": "https://gizmodo.com/quest-diagnostics-reports-unauthorized-access-of-patient-records-2000829419",
    "publisher": "Gizmodo",
    "primary": false
   },
   {
    "url": "https://ground.news/article/laboratory-operator-quest-reports-cyber-breach-affecting-patient-records",
    "publisher": "Ground News (aggregator of AP/Reuters)",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "quest-not-php",
  "thread": "quest",
  "parent": "quest-link-speculation",
  "t": "2026-10-22T19:05:00Z",
  "tPrecision": "hour",
  "kind": "unrelated-claim",
  "title": "Quest: breach 'not related to a PHP programming language issue'",
  "summary": "Quest tells Gizmodo, and the Associated Press per Ground News, that its investigation shows the incident is not related to the PHP vulnerabilities.",
  "sources": [
   {
    "url": "https://gizmodo.com/quest-diagnostics-reports-unauthorized-access-of-patient-records-2000829419",
    "publisher": "Gizmodo",
    "primary": false
   },
   {
    "url": "https://ground.news/article/laboratory-operator-quest-reports-cyber-breach-affecting-patient-records",
    "publisher": "Ground News (aggregator of AP/Reuters)",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "t is Gizmodo's update time; Quest's 8-K does not mention PHP."
 },
 {
  "id": "ets-notices",
  "thread": "ca-students",
  "parent": null,
  "t": "2026-10-16T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "California begins notifying families of ETS student-data theft",
  "summary": "The state education department begins notices about data on public school students copied from an ETS file transfer site between 22 May and 18 Sep; ETS found it on 25 Sep.",
  "sources": [
   {
    "url": "https://www.cde.ca.gov/nr/ne/yr26/yr26rel45.asp",
    "publisher": "California Department of Education",
    "primary": true
   },
   {
    "url": "https://therecord.media/california-warns-all-public-school-students-of-data-breach",
    "publisher": "The Record",
    "primary": false
   },
   {
    "url": "https://www.securitytoday.de/en/2026/10/22/black-october-many-attacks-had-been-running-for-months/",
    "publisher": "SecurityToday",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "ets-scope",
  "thread": "ca-students",
  "parent": "ets-notices",
  "t": "2026-10-20T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Data covers students enrolled since 2023, including disability status",
  "summary": "Data includes names, birth dates, addresses, identifiers, disability and 504 status and test results; CDE says ETS has found no evidence it was made public.",
  "sources": [
   {
    "url": "https://therecord.media/california-warns-all-public-school-students-of-data-breach",
    "publisher": "The Record",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Listed under 'Black October' by viral posts; SecurityToday notes it began months earlier and is not linked to PHP2Shell."
 },
 {
  "id": "ets-rebuild",
  "thread": "ca-students",
  "parent": "ets-notices",
  "t": "2026-10-16T12:00:00Z",
  "tPrecision": "day",
  "kind": "mitigation",
  "title": "ETS rebuilds its file transfer site and offers identity protection",
  "summary": "CDE says ETS took the SFTP site offline, built a new one, works with law enforcement, and offers two years of Experian IdentityWorks to affected students.",
  "sources": [
   {
    "url": "https://www.cde.ca.gov/nr/ne/yr26/yr26rel45.asp",
    "publisher": "California Department of Education",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "CDE says Social Security numbers, financial data, passwords and parent data were not involved; notices continue to early November."
 },
 {
  "id": "cairn-report",
  "thread": "cairn",
  "parent": "cairn-norforge-scan",
  "t": "2026-10-20T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "Exposed panels show the Cairn AI platform used to breach 100+ firms",
  "summary": "Researchers find exposed control panels of the open-source Cairn agent platform used for automated intrusions; Reuters reports over 100 companies breached in the largest cluster.",
  "sources": [
   {
    "url": "https://www.securityweek.com/ai-platform-cairn-abused-to-hack-over-100-organizations/",
    "publisher": "SecurityWeek",
    "primary": false
   },
   {
    "url": "https://www.securitytoday.de/en/2026/10/22/black-october-many-attacks-had-been-running-for-months/",
    "publisher": "SecurityToday",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "No dates given for the attacks themselves."
 },
 {
  "id": "cairn-norforge-scan",
  "thread": "cairn",
  "parent": null,
  "t": "2026-10-02T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "NorForge finds Cairn instances used for malicious activity",
  "summary": "Reuters reports that NorForge, scanning for exposed Cairn instances, found about two dozen in malicious use starting around 2 October.",
  "sources": [
   {
    "url": "https://www.staradvertiser.com/2026/10/19/breaking-news/how-one-hacker-used-ai-agents-to-break-into-over-100-company-websites/",
    "publisher": "Reuters via Honolulu Star-Advertiser",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "'Around Oct. 2' is approximate."
 },
 {
  "id": "cairn-reuters",
  "thread": "cairn",
  "parent": "cairn-norforge-scan",
  "t": "2026-10-19T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "Reuters: Cairn operator breached 100+ firms incl. Deere, SharkNinja, Cummins",
  "summary": "Reuters reviews one operator's Cairn records, finds more than 100 breached companies and over 1,200 attempted sites; Deere and SharkNinja say they remediated, Cummins says it is investigating a vendor-run site.",
  "sources": [
   {
    "url": "https://www.staradvertiser.com/2026/10/19/breaking-news/how-one-hacker-used-ai-agents-to-break-into-over-100-company-websites/",
    "publisher": "Reuters via Honolulu Star-Advertiser",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Reuters could not establish how much data, if any, was taken."
 },
 {
  "id": "fridge-attack-night",
  "thread": "fridge-attack",
  "parent": null,
  "t": "2026-10-11T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "Attackers heat refrigeration in hundreds of French supermarkets overnight",
  "summary": "On the night of 11 to 12 October, attackers take remote control of store refrigeration controllers, mostly Danfoss units managed by maintenance firms, and force defrost and high setpoints. Intermarché/Netto, Coopérative U, Carrefour, Monoprix and E.Leclerc report affected stores and discarded food.",
  "sources": [
   {
    "url": "https://thehackernews.com/2026/10/attackers-heat-french-supermarket.html",
    "publisher": "The Hacker News",
    "primary": false
   },
   {
    "url": "https://www.news4jax.com/business/2026/10/13/cyberattack-targeting-refrigeration-systems-hits-700-supermarkets-french-government-says/",
    "publisher": "Associated Press via News4JAX",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Store counts differ by outlet: AFP reports at least 300 Intermarché/Netto stores, Reuters about 150. The night is 11-12 October; the hour is not published."
 },
 {
  "id": "fridge-certfr-alert",
  "thread": "fridge-attack",
  "parent": "fridge-attack-night",
  "t": "2026-10-12T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "CERT-FR alert: numerous compromises of Danfoss AK-SM and AK-SC controllers",
  "summary": "CERT-FR publishes CERTFR-2026-ALE-012 on remote controllers of refrigeration installations. It says it knows of numerous compromises, that campaigns are probably still going on, and tells operators to remove internet exposure and reach units only through a VPN.",
  "sources": [
   {
    "url": "https://cert.cyber.gouv.fr/alerte/CERTFR-2026-ALE-012/",
    "publisher": "CERT-FR (ANSSI)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "fridge-danfoss-statement",
  "thread": "fridge-attack",
  "parent": "fridge-attack-night",
  "t": "2026-10-12T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Danfoss: most affected systems are legacy units without updates",
  "summary": "Danfoss says it is aware of incidents in France on a limited number of refrigeration management systems, mostly AK-SM 800 and AK-SC 355 products that no longer get software or security updates, and that it is working with customers.",
  "sources": [
   {
    "url": "https://www.news4jax.com/business/2026/10/13/cyberattack-targeting-refrigeration-systems-hits-700-supermarkets-french-government-says/",
    "publisher": "Associated Press via News4JAX",
    "primary": false
   },
   {
    "url": "https://thehackernews.com/2026/10/attackers-heat-french-supermarket.html",
    "publisher": "The Hacker News",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Danfoss statements reached the press through Reuters, AFP and AP; no Danfoss advisory page about the attack was listed as of 13 October."
 },
 {
  "id": "fridge-certfr-update",
  "thread": "fridge-attack",
  "parent": "fridge-certfr-alert",
  "t": "2026-10-13T12:00:00Z",
  "tPrecision": "day",
  "kind": "advisory",
  "title": "CERT-FR adds Copeland xweb and Dixell xweb to the alert",
  "summary": "CERT-FR updates CERTFR-2026-ALE-012 to add other targeted equipment, Copeland xweb and Dixell xweb. A further update on 16 October changes the recommendations.",
  "sources": [
   {
    "url": "https://cert.cyber.gouv.fr/alerte/CERTFR-2026-ALE-012/",
    "publisher": "CERT-FR (ANSSI)",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "fridge-lescure-700",
  "thread": "fridge-attack",
  "parent": "fridge-attack-night",
  "t": "2026-10-13T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "French finance minister: about 700 of 10,000 supermarkets hit",
  "summary": "Finance Minister Roland Lescure tells Parliament that about 700 of France's 10,000 supermarkets were affected, that food supply is not at risk, and calls the attack a wake-up call.",
  "sources": [
   {
    "url": "https://www.news4jax.com/business/2026/10/13/cyberattack-targeting-refrigeration-systems-hits-700-supermarkets-french-government-says/",
    "publisher": "Associated Press via News4JAX",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "fridge-paris-prosecutor",
  "thread": "fridge-attack",
  "parent": "fridge-attack-night",
  "t": "2026-10-13T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "Paris prosecutor opens a cybercrime inquiry",
  "summary": "The Paris prosecutor's office opens an inquiry on its own initiative, led by its cybercrime section with the anti-cybercrime office OFAC, to count victims and link the attack to spoiled food and reported fires. No group has claimed the attack.",
  "sources": [
   {
    "url": "https://thehackernews.com/2026/10/attackers-heat-french-supermarket.html",
    "publisher": "The Hacker News",
    "primary": false
   },
   {
    "url": "https://www.news4jax.com/business/2026/10/13/cyberattack-targeting-refrigeration-systems-hits-700-supermarkets-french-government-says/",
    "publisher": "Associated Press via News4JAX",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "cw-password-spray",
  "thread": "connectwise",
  "parent": null,
  "t": "2026-10-10T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "Storm-0940 password spray hits 327 accounts at eight organisations",
  "summary": "Microsoft sees an automated password-spray campaign from 10 to 14 October against 327 accounts at eight organisations, with over 151,000 failed logons and no successful sign-in. Microsoft places it in the run-up to the ConnectWise compromise.",
  "sources": [
   {
    "url": "https://www.microsoft.com/en-us/security/blog/2026/10/21/storm-0940-uses-artex-agentic-ai-connectwise-supply-chain-compromise/",
    "publisher": "Microsoft Threat Intelligence",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "cw-huntress-report",
  "thread": "connectwise",
  "parent": "cw-password-spray",
  "t": "2026-10-16T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Huntress: ConnectWise Cloud Backup credential used in 162 tenants",
  "summary": "Huntress reports that a Microsoft 365 credential of the ConnectWise Cloud Backup app (formerly SkyKick) was used for unauthorized sign-ins, with role grabs from 01:58 UTC on 15 October and 162 tenants confirmed by 19:00 UTC on 16 October. Later updates add Cloud Management apps and Global Administrator grabs.",
  "sources": [
   {
    "url": "https://www.huntress.com/blog/vendor-credential-enables-unauthorized-access",
    "publisher": "Huntress",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Huntress's 17 October update counts almost 1,000 Entra tenants with sign-in activity from the IP and over 300 successful; its 19 October review of 10,000+ tenants found post-compromise activity in two."
 },
 {
  "id": "cw-advisory",
  "thread": "connectwise",
  "parent": "cw-password-spray",
  "t": "2026-10-16T17:47:00Z",
  "tPrecision": "minute",
  "kind": "advisory",
  "title": "ConnectWise posts its first Cloud Backup advisory",
  "summary": "ConnectWise says it is investigating unauthorized access attempts to the Cloud Backup environment, lists a suspicious IP address and user agents, and says it has no sign that partner backup data was accessed.",
  "sources": [
   {
    "url": "https://www.connectwise.com/company/trust/advisories",
    "publisher": "ConnectWise",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "The advisory FAQ gives 14 October as the discovery date."
 },
 {
  "id": "cw-suspend",
  "thread": "connectwise",
  "parent": "cw-advisory",
  "t": "2026-10-17T17:00:00Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "ConnectWise suspends Cloud Backup, SaaS Security and Cloud Management",
  "summary": "ConnectWise suspends Cloud Backup by revoking certificates for affected connections, engages an outside incident-response firm and suspends SaaS Security and Cloud Management as a precaution. Seven application identities were disabled at 07:00 UTC that day.",
  "sources": [
   {
    "url": "https://www.connectwise.com/company/trust/advisories",
    "publisher": "ConnectWise",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "cw-restore",
  "thread": "connectwise",
  "parent": "cw-suspend",
  "t": "2026-10-21T12:45:00Z",
  "tPrecision": "minute",
  "kind": "mitigation",
  "title": "ConnectWise begins phased restoration of Cloud Backup",
  "summary": "After a full account and credential reset on 19 October, ConnectWise starts restoring the service in controlled phases and says the restoration will take several days. Its 23 October update expects restore access early the next week.",
  "sources": [
   {
    "url": "https://www.connectwise.com/company/trust/advisories",
    "publisher": "ConnectWise",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "cw-attribution",
  "thread": "connectwise",
  "parent": "cw-advisory",
  "t": "2026-10-21T22:00:00Z",
  "tPrecision": "hour",
  "kind": "statement",
  "title": "ConnectWise and Microsoft attribute the compromise to China-aligned Storm-0940",
  "summary": "ConnectWise says the evidence, including Microsoft threat intelligence, points to a China state-aligned group using an openly available agentic AI framework. Microsoft names the group Storm-0940 and the framework ARTEX, and counts sign-in attempts to more than 2,250 tenants.",
  "sources": [
   {
    "url": "https://www.connectwise.com/company/trust/advisories",
    "publisher": "ConnectWise",
    "primary": true
   },
   {
    "url": "https://www.microsoft.com/en-us/security/blog/2026/10/21/storm-0940-uses-artex-agentic-ai-connectwise-supply-chain-compromise/",
    "publisher": "Microsoft Threat Intelligence",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "related": [
   "artex-storm0940"
  ]
 },
 {
  "id": "artex-shinhan-leak",
  "thread": "artex",
  "parent": null,
  "t": "2026-10-01T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Shinhan Bank discloses a leak of data on about 25,000 customers",
  "summary": "Shinhan Bank says data on about 25,000 customers leaked through a mobile inquiry service that loan agents use, after an attacker bypassed its identity check. The bank blocks external IPs and suspends the service. Analysts find traces of the ARTEX AI pentest tool on a server tied to the attack.",
  "sources": [
   {
    "url": "https://www.koreaherald.com/article/10892290",
    "publisher": "The Korea Herald",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Neither the bank nor regulators confirmed that ARTEX was used. The date is inferred from the Korea Herald's 'Thursday' in a 2 October article."
 },
 {
  "id": "artex-fsc-meeting",
  "thread": "artex",
  "parent": "artex-shinhan-leak",
  "t": "2026-10-02T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "Korean Financial Services Commission holds an emergency meeting",
  "summary": "The Financial Services Commission meets the Financial Supervisory Service, security officials and industry, orders checks of externally reachable systems and stronger authentication, and pledges an investigation.",
  "sources": [
   {
    "url": "https://www.koreaherald.com/article/10892290",
    "publisher": "The Korea Herald",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "artex-crowdstrike",
  "thread": "artex",
  "parent": "artex-shinhan-leak",
  "t": "2026-10-07T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "CrowdStrike: an actor used ARTEX and Claude Code against Korean finance",
  "summary": "CrowdStrike reports a likely Chinese-speaking, financially motivated actor that used the open-source ARTEX agent tool, with DeepSeek as its main model and Claude Code sessions, against South Korean financial organisations from late September to early October. Data was exfiltrated.",
  "sources": [
   {
    "url": "https://www.crowdstrike.com/en-us/blog/unknown-threat-actor-uses-artex-to-target-south-korean-finance/",
    "publisher": "CrowdStrike",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "CrowdStrike does not name the banks; the link to Shinhan rests on the Korea Herald's report of ARTEX traces.",
  "related": [
   "cc-crowdstrike-report"
  ]
 },
 {
  "id": "artex-closed-source",
  "thread": "artex",
  "parent": "artex-crowdstrike",
  "t": "2026-10-08T12:00:00Z",
  "tPrecision": "day",
  "kind": "takedown",
  "title": "ARTEX developer stops public releases and closes the source",
  "summary": "The ARTEX developer says that, given misuse of the tool, the project will go closed-source with no further public releases or maintenance. Reuters reports the GitHub page was taken down; the suspect named by CrowdStrike denies involvement.",
  "sources": [
   {
    "url": "https://www.koreajoongangdaily.com/business/chinese-ai-tool-linked-to-korean-bank-hacks-halts-public-updates-as-suspect-denies-involvement/12913376",
    "publisher": "Korea JoongAng Daily",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "The article says the post came on 'Thursday'; with publication on Saturday 10 October that is 8 October."
 },
 {
  "id": "artex-storm0940",
  "thread": "artex",
  "parent": "artex-crowdstrike",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Microsoft: China-aligned Storm-0940 uses ARTEX since September",
  "summary": "Microsoft says Storm-0940, a China state-aligned actor active since 2021, has used the open-source ARTEX framework since as early as September 2026, including in the ConnectWise supply-chain compromise.",
  "sources": [
   {
    "url": "https://www.microsoft.com/en-us/security/blog/2026/10/21/storm-0940-uses-artex-agentic-ai-connectwise-supply-chain-compromise/",
    "publisher": "Microsoft Threat Intelligence",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Microsoft does not link Storm-0940 to the Korean bank intrusions; the shared element is the ARTEX tool."
 },
 {
  "id": "cc-actor1-activity",
  "thread": "claude-code-campaigns",
  "parent": null,
  "t": "2026-05-15T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "A Claude Code agent harness hits at least 15 Argentine healthcare entities",
  "summary": "A Spanish- and English-speaking operator runs a harness derived from PentestGPT, with a supervisor Claude Code agent directing an executor, against Argentine healthcare entities. Credentials and medical records are taken from at least one victim.",
  "sources": [
   {
    "url": "https://www.crowdstrike.com/en-us/blog/crowdstrike-uncovers-new-agentic-ai-campaigns/",
    "publisher": "CrowdStrike",
    "primary": true
   },
   {
    "url": "https://www.cybersecuritydive.com/news/agentic-ai-cyberattacks-harnesses-crowdstrike/833714/",
    "publisher": "Cybersecurity Dive",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "Before the October run. CrowdStrike gives May to August 2026 for all four actors; mid-May to mid-August for this one comes from Cybersecurity Dive. t is approximate."
 },
 {
  "id": "cc-crowdstrike-report",
  "thread": "claude-code-campaigns",
  "parent": "cc-actor1-activity",
  "t": "2026-10-21T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "CrowdStrike reports four actors running campaigns on Claude Code",
  "summary": "CrowdStrike describes four previously unreported actors that used Claude Code with pentest harnesses: Argentine healthcare, a Chinese-speaking operator with 20+ targets including governments, an Indonesian-speaking actor using 819 public skills, and a Russian-speaking group that stole client data from a US CRM vendor.",
  "sources": [
   {
    "url": "https://www.crowdstrike.com/en-us/blog/crowdstrike-uncovers-new-agentic-ai-campaigns/",
    "publisher": "CrowdStrike",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "cc-agentic-trend",
  "thread": "claude-code-campaigns",
  "parent": "cc-crowdstrike-report",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "CrowdStrike data: agentic intrusions triple in the second half of 2026",
  "summary": "Reporting on the CrowdStrike findings, Cybersecurity Dive cites a threefold rise in agentic intrusions in the second half of 2026 and says token budgets, not engineering, limit these campaigns. No Anthropic statement is reported.",
  "sources": [
   {
    "url": "https://www.cybersecuritydive.com/news/agentic-ai-cyberattacks-harnesses-crowdstrike/833714/",
    "publisher": "Cybersecurity Dive",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Target details differ by source: Cybersecurity Dive names Colombian and Brazilian agencies for actor 2 and a US help-desk platform and a Ukrainian agency for actor 4."
 },
 {
  "id": "aomei-window-1",
  "thread": "aomei",
  "parent": null,
  "t": "2026-05-28T05:40:00Z",
  "tPrecision": "minute",
  "kind": "exploitation",
  "title": "AOMEI update configuration tampered for ten minutes",
  "summary": "Update and notification configuration files on AOMEI's own servers are changed for ten minutes, so AOMEI Backupper clients that check in fetch a downloader. Two more windows follow on 16 July (6 min) and 20 July (5 min). GTIG tracks the actor as UNC7017.",
  "sources": [
   {
    "url": "https://cloud.google.com/blog/topics/threat-intelligence/investigating-ephemeral-supply-chain-tampering",
    "publisher": "Google Threat Intelligence Group / Mandiant",
    "primary": true
   },
   {
    "url": "https://www.manageengine.com/threat-analysis-lab/aomei-backupper-supply-chain-compromise.html",
    "publisher": "ManageEngine Threat Analysis Lab",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Before the October run: the tampering ran April to July 2026; only the disclosure is in October. Other windows are probable but not observed."
 },
 {
  "id": "aomei-in-transit-claim",
  "thread": "aomei",
  "parent": "aomei-window-1",
  "t": "2026-06-07T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "AOMEI first blames in-transit interception; researchers reject it",
  "summary": "ManageEngine notifies AOMEI on 7 June. AOMEI's first explanation is that the content was intercepted and changed in transit. ManageEngine finds the delivery path serving clean content and rejects that explanation.",
  "sources": [
   {
    "url": "https://www.manageengine.com/threat-analysis-lab/aomei-backupper-supply-chain-compromise.html",
    "publisher": "ManageEngine Threat Analysis Lab",
    "primary": false
   }
  ],
  "confidence": "disputed",
  "note": "AOMEI's explanation is known only through ManageEngine; the date of AOMEI's reply is 'early June, after notification'."
 },
 {
  "id": "aomei-corrective-action",
  "thread": "aomei",
  "parent": "aomei-in-transit-claim",
  "t": "2026-07-29T12:00:00Z",
  "tPrecision": "day",
  "kind": "mitigation",
  "title": "AOMEI tells Mandiant it has taken corrective action",
  "summary": "After Mandiant's notification on 17 July, AOMEI responds that it has secured its distribution servers. Server fixes do not clean endpoints that already received a payload.",
  "sources": [
   {
    "url": "https://cloud.google.com/blog/topics/threat-intelligence/investigating-ephemeral-supply-chain-tampering",
    "publisher": "Google Threat Intelligence Group / Mandiant",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "ManageEngine says that as of 16 October it had not independently verified containment."
 },
 {
  "id": "aomei-gtig-report",
  "thread": "aomei",
  "parent": "aomei-window-1",
  "t": "2026-10-15T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Google and Mandiant disclose the AOMEI update-server tampering",
  "summary": "GTIG and Mandiant publish the UNC7017 campaign, with the CROSSROAD downloader and SHINYROAD backdoor, and victims in 11 countries in IT services, telecom and higher education. They advise hunting back to April 2026.",
  "sources": [
   {
    "url": "https://cloud.google.com/blog/topics/threat-intelligence/investigating-ephemeral-supply-chain-tampering",
    "publisher": "Google Threat Intelligence Group / Mandiant",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "aomei-manageengine-report",
  "thread": "aomei",
  "parent": "aomei-gtig-report",
  "t": "2026-10-16T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "ManageEngine publishes its AOMEI Backupper findings",
  "summary": "ManageEngine's lab publishes its detection from 28 May and its capture of the 16 July window, and says it has not independently verified that the compromise is contained.",
  "sources": [
   {
    "url": "https://www.manageengine.com/threat-analysis-lab/aomei-backupper-supply-chain-compromise.html",
    "publisher": "ManageEngine Threat Analysis Lab",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "aomei-cto-investigation",
  "thread": "aomei",
  "parent": "aomei-gtig-report",
  "t": "2026-10-19T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "AOMEI: CTO leads a high-priority investigation",
  "summary": "AOMEI tells BleepingComputer it has classified the matter as high priority and that its CTO leads a dedicated investigation.",
  "sources": [
   {
    "url": "https://www.bleepingcomputer.com/news/security/hackers-hijack-aomei-update-servers-to-secretly-spread-malware/",
    "publisher": "BleepingComputer",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "paradigm-access-window",
  "thread": "paradigm",
  "parent": null,
  "t": "2025-10-08T12:00:00Z",
  "tPrecision": "day",
  "kind": "exploitation",
  "title": "Unauthorized party may access Paradigm Healthcare files",
  "summary": "Paradigm Healthcare Services says an unauthorized party may have accessed certain files between 8 and 15 October 2025. Paradigm processes Medi-Cal billing for California's Department of Health Care Services.",
  "sources": [
   {
    "url": "https://paradigm-healthcare.com/notice",
    "publisher": "Paradigm Healthcare Services",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Outside the October 2026 run: the intrusion was in October 2025; only the press coverage is in October 2026."
 },
 {
  "id": "paradigm-detected",
  "thread": "paradigm",
  "parent": "paradigm-access-window",
  "t": "2025-10-13T12:00:00Z",
  "tPrecision": "day",
  "kind": "mitigation",
  "title": "Paradigm detects the intrusion and takes systems offline",
  "summary": "Paradigm becomes aware of unauthorized access to its local network, takes certain systems offline, notifies law enforcement and engages outside investigators. It says its Student Health Network billing platform was not affected.",
  "sources": [
   {
    "url": "https://paradigm-healthcare.com/notice",
    "publisher": "Paradigm Healthcare Services",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "paradigm-phi-finding",
  "thread": "paradigm",
  "parent": "paradigm-detected",
  "t": "2026-08-18T12:00:00Z",
  "tPrecision": "day",
  "kind": "other",
  "title": "Paradigm finds Medi-Cal member data in the accessed files",
  "summary": "Paradigm determines that the files may have held names, dates of birth, gender and Medi-Cal member ID numbers. It says it has no evidence of fraud or identity theft.",
  "sources": [
   {
    "url": "https://paradigm-healthcare.com/notice",
    "publisher": "Paradigm Healthcare Services",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "paradigm-letters",
  "thread": "paradigm",
  "parent": "paradigm-phi-finding",
  "t": "2026-09-14T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Paradigm mails breach notices about 11 months after detection",
  "summary": "Paradigm's notification letters are dated 14 September 2026, about 11 months after it detected the intrusion.",
  "sources": [
   {
    "url": "https://www.securityweek.com/970000-medi-cal-members-affected-by-paradigm-healthcare-data-breach/",
    "publisher": "SecurityWeek",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "A redacted letter is on the California Attorney General site (oag.ca.gov/system/files/PHS_Redacted_Notice_Letter_40106534v1.pdf) but is an image-only PDF that could not be read, so the date rests on SecurityWeek."
 },
 {
  "id": "paradigm-970k",
  "thread": "paradigm",
  "parent": "paradigm-letters",
  "t": "2026-10-20T09:33:00Z",
  "tPrecision": "minute",
  "kind": "disclosure",
  "title": "Paradigm breach filed with HHS as affecting 970,000+ Medi-Cal members",
  "summary": "SecurityWeek reports that Paradigm told the US Department of Health and Human Services the breach affected more than 970,000 people. The notice names no attacker and does not say whether data was exfiltrated.",
  "sources": [
   {
    "url": "https://www.securityweek.com/970000-medi-cal-members-affected-by-paradigm-healthcare-data-breach/",
    "publisher": "SecurityWeek",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "t is SecurityWeek's publication time (5:33 AM ET); the HHS filing date is not given and the HHS portal was not fetched."
 },
 {
  "id": "pwnescape-report",
  "thread": "pwnescape",
  "parent": null,
  "t": "2026-08-20T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "PWN.AI reports a host-memory leak in Vercel's Sandbox challenge",
  "summary": "PWN.AI submits a bounded host-memory disclosure report to Vercel's Sandbox challenge, found with its AI research harness. The root cause is in the Linux kernel IPv4 checksum path, not in KVM code.",
  "sources": [
   {
    "url": "https://pwn.ai/blog/pwnescape",
    "publisher": "PWN.AI",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Before the October run: discovery and private report were in August and September; the CVE and public disclosure are in October."
 },
 {
  "id": "pwnescape-kernel-report",
  "thread": "pwnescape",
  "parent": "pwnescape-report",
  "t": "2026-09-04T12:00:00Z",
  "tPrecision": "day",
  "kind": "disclosure",
  "title": "Root cause reported privately to the kernel security contact",
  "summary": "PWN.AI reports the root cause with candidate patches to the kernel security contact and networking maintainers. A maintainer reproduces it on 7 September.",
  "sources": [
   {
    "url": "https://pwn.ai/blog/pwnescape",
    "publisher": "PWN.AI",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "pwnescape-net-fix",
  "thread": "pwnescape",
  "parent": "pwnescape-kernel-report",
  "t": "2026-10-08T12:00:00Z",
  "tPrecision": "day",
  "kind": "patch",
  "title": "Kernel fix accepted into net.git",
  "summary": "Commit 6785011f8b16, 'ipv4: validate checksum_start before completing checksum', goes into net.git after public netdev revisions from 19 September.",
  "sources": [
   {
    "url": "https://pwn.ai/blog/pwnescape",
    "publisher": "PWN.AI",
    "primary": true
   },
   {
    "url": "https://www.openwall.com/lists/oss-security/2026/10/15/5",
    "publisher": "oss-security",
    "primary": false
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "pwnescape-mainline",
  "thread": "pwnescape",
  "parent": "pwnescape-net-fix",
  "t": "2026-10-14T12:00:00Z",
  "tPrecision": "day",
  "kind": "patch",
  "title": "PwnEscape fix merged into mainline Linux",
  "summary": "The fix merges into the mainline kernel. Neither the write-up nor the oss-security post maps it to fixed stable kernel releases.",
  "sources": [
   {
    "url": "https://pwn.ai/blog/pwnescape",
    "publisher": "PWN.AI",
    "primary": true
   }
  ],
  "confidence": "confirmed"
 },
 {
  "id": "pwnescape-cve",
  "thread": "pwnescape",
  "parent": "pwnescape-mainline",
  "t": "2026-10-15T12:19:00Z",
  "tPrecision": "minute",
  "kind": "cve",
  "title": "Linux CNA publishes CVE-2026-99999, CVSS 9.3",
  "summary": "The Linux kernel CNA publishes CVE-2026-99999 for the IPv4 checksum flaw, rated CVSS 3.1 9.3 critical, with a scenario of a malicious microVM affecting the host.",
  "sources": [
   {
    "url": "https://cveawg.mitre.org/api/cve/CVE-2026-99999",
    "publisher": "CVE Program (Linux CNA)",
    "primary": true
   }
  ],
  "confidence": "confirmed",
  "note": "Borns IT-Blog reports CVSS 9.8; the CNA record says 9.3."
 },
 {
  "id": "pwnescape-oss-security",
  "thread": "pwnescape",
  "parent": "pwnescape-cve",
  "t": "2026-10-15T19:25:00Z",
  "tPrecision": "minute",
  "kind": "disclosure",
  "title": "PwnEscape guest-to-host KVM escape posted to oss-security",
  "summary": "A post to oss-security names the flaw 'PwnEscape: Guest-to-Host KVM Escape' and says details were already on Twitter. The poster does not know whether the distros list was told in advance.",
  "sources": [
   {
    "url": "https://www.openwall.com/lists/oss-security/2026/10/15/5",
    "publisher": "oss-security",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "label-viral-post",
  "thread": "label",
  "parent": null,
  "t": "2026-10-22T03:42:23Z",
  "tPrecision": "minute",
  "kind": "other",
  "title": "Viral X post lists 27 incidents under the 'Black October' label",
  "summary": "A widely shared X post calls the last 48 hours 'Black October' and lists 27 incidents, from PHP2Shell and eMudhra to Railway, Zeabur, LiteLLM, GitLab and SBI.",
  "sources": [
   {
    "url": "https://x.com/AISafetyMemes/status/2113113711644737835",
    "publisher": "X post (AI Notkilleveryoneism Memes account)",
    "primary": true
   },
   {
    "url": "https://api.fxtwitter.com/AISafetyMemes/status/2113113711644737835",
    "publisher": "FxTwitter API mirror of the X post",
    "primary": false
   },
   {
    "url": "https://www.businesstoday.in/technology/news/story/from-compromised-certificates-to-malicious-software-inside-octobers-cybersecurity-alerts-563027-2026-10-22",
    "publisher": "Business Today (India)",
    "primary": false
   },
   {
    "url": "https://www.securitytoday.de/en/2026/10/22/black-october-many-attacks-had-been-running-for-months/",
    "publisher": "SecurityToday",
    "primary": false
   }
  ],
  "confidence": "confirmed",
  "note": "The post says 'they're calling it' Black October; it is not shown to be the origin of the term."
 },
 {
  "id": "label-securitytoday",
  "thread": "label",
  "parent": "label-viral-post",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "Analysis: the surge is in disclosures; many attacks began months earlier",
  "summary": "SecurityToday reviews the 27 items and finds most are disclosures of attacks that started weeks or months before, with none linked to PHP2Shell.",
  "sources": [
   {
    "url": "https://www.securitytoday.de/en/2026/10/22/black-october-many-attacks-had-been-running-for-months/",
    "publisher": "SecurityToday",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "label-404",
  "thread": "label",
  "parent": "label-viral-post",
  "t": "2026-10-22T12:00:00Z",
  "tPrecision": "day",
  "kind": "statement",
  "title": "404 Media: 'AI is changing everything about hacking'",
  "summary": "404 Media ties PHP2Shell, eMudhra, Node.js, GitLab, Plex, Railway and OpenCode into one story of AI-accelerated discovery and exploitation.",
  "sources": [
   {
    "url": "https://www.404media.co/php2shell-black-october-ai-is-changing-everything-about-hacking-no-one-knows-what-happens-next/",
    "publisher": "404 Media",
    "primary": false
   }
  ],
  "confidence": "reported"
 },
 {
  "id": "label-axios",
  "thread": "label",
  "parent": "label-viral-post",
  "t": "2026-10-22T18:01:00Z",
  "tPrecision": "hour",
  "kind": "statement",
  "title": "Axios: banks detecting unauthorized third-party agent access",
  "summary": "Axios's 'Black October' story says the NSA and a European agency are on alert and reports that banks are detecting unauthorized third-party agent access inside customer accounts.",
  "sources": [
   {
    "url": "https://www.yahoo.com/news/world/articles/black-october-why-bugs-discovered-180131955.html",
    "publisher": "Axios via Yahoo News",
    "primary": false
   }
  ],
  "confidence": "reported",
  "note": "Axios original was not fetchable (HTTP 403); read via Yahoo News syndication. t is Yahoo's update time."
 }
];
