# OpenHands Task: Fix and Merge Open PRs Systematically

## Repository Information
- Repository: https://github.com/anchapin/CI-fixer.git
- Current branch: main

## Open PRs Summary (7 total)

### Priority Order (oldest first, non-draft first):

1. **PR #3**: Implement logic to unskip skipped tests
   - Branch: `unskip-tests-implementation-4798387603911099923`
   - Status: OPEN, MERGEABLE but UNSTABLE (CI failing)
   - Issue: Tests failing, needs fix

2. **PR #6**: Add Research Recommendations for 2025 APR Enhancements
   - Branch: `research-2025-recommendations-12394914854809322136`
   - Status: OPEN, MERGEABLE but UNSTABLE

3. **PR #7**: Add research findings and proposal for automated repair advancements
   - Branch: `research/2025-02-automated-repair-findings-14600277429051146621`
   - Status: OPEN, MERGEABLE but UNSTABLE

4. **PR #8**: Add research proposal for multi-agent architecture based on He et al. (2024)
   - Branch: `research-integration-multi-agent-1322423271921181915`
   - Status: OPEN, MERGEABLE but UNSTABLE

### Draft PRs (lower priority):
- PR #2: Add Research Roadmap (DRAFT)
- PR #4: docs: Add research review (DRAFT)
- PR #5: Add research findings on automated bug fixing (DRAFT)

## Instructions for OpenHands

### For each PR (starting with #3, then #6, #7, #8):

1. **Checkout the PR branch**:
   ```bash
   gh pr checkout <PR_NUMBER>
   ```

2. **Analyze the CI failures**:
   - Run tests locally: `npm test`
   - Check for lint errors: `npm run lint` (if available)
   - Review the changes in the PR

3. **Fix the issues**:
   - Make necessary code changes to pass CI
   - Ensure tests pass locally
   - Commit and push fixes

4. **Verify CI passes**:
   - Wait for CI to complete
   - If still failing, repeat steps 2-3

5. **Merge the PR**:
   ```bash
   gh pr merge <PR_NUMBER> --squash --delete-branch
   ```

6. **Return to main and pull latest**:
   ```bash
   git checkout main && git pull origin main
   ```

7. **Proceed to next PR**

## Important Notes
- Always ensure CI passes before merging
- Use `--llm-approve` mode for faster execution
- If a PR cannot be fixed easily, skip and move to next
- Draft PRs should be handled last or skipped

## Starting Point
Begin with PR #3 as it's the oldest non-draft PR with concrete code changes.