# Authorized Takeover replacement review

Scope: changes from Server 0.95 `aa4439e`, tracking Server #162.

The owner withdrew the cross-user command after the complete native audit refused
a large source. This release removes its Browser registration/interception,
Web endpoint, private Host endpoint and sharing environment option. It does not
raise full-audit limits or introduce another automatic reference reader.

Owner policy permits the current user to explicitly authorize read-only context
reconstruction of one named source account and conversation through `/takeover`.
Only transcript and locating metadata are included. Ordinary HTTP/WS account
isolation is unchanged. This policy is soft isolation on the existing shared OS
account; it is not a newly enforced credential or filesystem security boundary.
Source instructions, bare IDs and filesystem readability are not authorization.

Cat Skills main `68ff070` contains the generic Skill changes, bounded record reading
instructions, user-facing documentation and router update. Static Skill invariants
and its existing test suite passed. These checks do not claim to prove an LLM will
follow every instruction. No production source Agent or model turn was started.

Serial security review: no credentials, dependencies, newly exposed routes or
browser-chosen source paths. Retired read endpoints return 404 in a real HTTP
regression, including an authenticated Host request. The account prompt retains
source credential/file/execution exclusions and the system-owner exception.
The failed initial policy test then passed with the explicit authorization rule;
91 targeted policy/HTTP/composer tests passed. Complete publication validation and
actual activation are separate gates.
