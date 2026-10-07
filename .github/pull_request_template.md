## What changed


## Test matrix (docs/TEST-MATRIX.md)
- [ ] Every money/trust row this PR touches has a test, or a manual smoke recorded below
- [ ] New edge cases found while building were added as rows (with a test) before the fix
- [ ] `node --test` is green (CI runs it; red blocks merge)

## Manual smoke (only for rows marked M — real Bullhorn/Outlook)
| Row | Date | Who | Result |
|-----|------|-----|--------|
|     |      |     |        |

## Client-facing safety
- [ ] Nothing sends email (drafts only)
- [ ] No pay rate or internal note can reach a client
- [ ] No record is attached to a guessed person
