# Account recovery approval detail correction — 2026-10-29

Independent Spec review found that the account panel omitted the server's native
bindings and shared dependency roles/keys while offering approval. The panel now
renders those values as plain text before approval, retaining the exact operation
revision/digest. Cross-scope keys remain the server's masked summaries; the
Browser does not reconstruct other accounts' native paths or identities.

The added public-controller test failed on the missing native identity text,
then all three account UI tests passed. It also verifies that a markup-shaped
native ID remains text and that identities precede approval. Together with the
two documentation checks, the affected run passed five cases without skips.
Build and scoped ESLint passed.

The actual Chromium/Web/Host/Restic probe now requests and stages an account plan,
asserts the native identity and masked shared dependency before approval, captures
`account-native-dependency-review.png`, cancels that preview, and continues the
existing single-task recovery, retention and browser-disconnect checks. The
probe passed with no console error or native/provider start. Its existing
configured-default-user fixture is not evidence of real login-to-route identity
binding; that independent review repair must be integrated and tested separately.

Private evidence: `account-review-ui-red.log`, `account-review-ui-green2.log`,
`account-review-ui-build.log`, `account-review-browser.log`, and
`account-review-browser/` under the task's `backup-implementation-130` directory.
The initial combined UI/docs run had one documentation failure because two log
filenames contained retired-mode vocabulary. Byte-identical private log aliases
now retain the citations while the original failure/success logs remain intact;
no documentation test was relaxed. The account-preview screenshot was visually
inspected and showed the staged native identity/dependencies above approval.

These observations do not activate services, back up production accounts, test
physical disks or establish the final integrated canonical/fresh-clone result.
