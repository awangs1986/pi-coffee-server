# MISHU review corrections — 2026-10-07

Source-only follow-up to Server #64 / PR #78 and independent plugin PR #4.
Baseline Server6720efc and plugin6e6d267. Production activation and immutable
artifact publication are not part of this correction.

The three review defects are repaired in sequential TDD cycles through the already
accepted public HTTP/WS plus Browser/native plugin command/tool seams. No private
methods or direct state reads are used as regression-test assertions.

| Cycle | Red observation | Green behavior |
| --- | --- | --- |
| Failed queued stop | HTTP409 followed by an inbox receipt marked cancelled | Rejected stop preserves queued receipt and recorded task; a later accepted stop cancels delivery once |
| Tracking status | Public plugin command omits2/3/4 counts and observation error | Command and model status retain validated counts and bounded diagnostic |
| Long native evidence | Production Codex protocol's long final result loses truncation metadata | Native event, scoped facts, persisted ReportEvent and actual automatic report input preserve the clipping flags |
| Detail warning | Native task command displays a bounded excerpt without warning | Task detail explicitly warns about the missing reply tail and points to the target native conversation |

Targeted green runs:4 dispatch scenarios,6 Codex outcome/report scenarios, plus
public plugin status and detail command regressions. Limits stay4000 characters;
old records' missing flags mean completeness unverified.

Real Chromium PASS: desktop1360/mobile390 tracking status, native late-result
truncation/detail warning, and mobile rejected stop retains its report queue before
a successful stop; source chat stays usable, no target replay or Browser errors.
The complete plugin check passed151 checks; targeted security review found no issues.
Server canonical check PASS:113 test files/962 tests plus four no-model Chromium
probes. The first attempt rejected three ordinary English occurrences of a retired
mode word in new documentation; those descriptions were corrected without changing
the check. The final canonical run passed. Fixture provider responses are synthetic
and do not establish real-account model acceptance.
Using MISHU_PLUGIN_ROOT tests changed plugin source, not a newly installed artifact.
