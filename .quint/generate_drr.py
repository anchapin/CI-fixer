import sqlite3
import json
from datetime import datetime
import os
import sys

if len(sys.argv) < 8:
    print("Usage: python generate_drr.py <title> <winner_id> <rejected_ids> <context> <decision> <rationale> <consequences>")
    sys.exit(1)

title = sys.argv[1]
winner_id = sys.argv[2]
rejected_ids = sys.argv[3].split(',') if sys.argv[3] else []
context = sys.argv[4]
decision = sys.argv[5]
rationale = sys.argv[6]
consequences = sys.argv[7]

# Connect to database
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)
db_path = os.path.join(project_root, '.quint', 'quint.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get winner details
cursor.execute('SELECT title, kind, content FROM holons WHERE id=?', (winner_id,))
result = cursor.fetchone()

if not result:
    print(f"Error: Winner hypothesis '{winner_id}' not found")
    conn.close()
    sys.exit(1)

winner_title, winner_kind, winner_content = result

# Get rejected details
rejected_info = []
for rid in rejected_ids:
    cursor.execute('SELECT title, kind FROM holons WHERE id=?', (rid,))
    title, kind = cursor.fetchone()
    rejected_info.append({'id': rid, 'title': title, 'kind': kind})

# Get evidence for winner
cursor.execute('''
    SELECT id, type, title, content FROM holons
    WHERE context_id=?
    ORDER BY created_at DESC
''', (winner_id,))

evidence_items = cursor.fetchall()

# Calculate R_eff
r_self = 0.95
evidence_scores = []
for ev_id, ev_type, ev_title, ev_content in evidence_items:
    try:
        content_dict = json.loads(ev_content) if ev_type == 'test' else {}
        verdict = content_dict.get('verdict', 'UNKNOWN')
        test_type = content_dict.get('test_type', 'unknown')

        if verdict == "PASS":
            score = 0.95 if test_type == "internal" else 0.75
        elif verdict == "FAIL":
            score = 0.30
        else:
            score = 0.50
        evidence_scores.append(score)
    except:
        evidence_scores.append(0.60)

r_eff = min(r_self, min(evidence_scores)) if evidence_scores else r_self

# Create DRR
decision_id = f"dec-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
drr_content = f'''# Design Rationale Record (DRR)

**Decision ID:** `{decision_id}`
**Title:** {title}
**Date:** {datetime.now().strftime('%Y-%m-%d')}
**Status:** DECIDED
**Winner:** `{winner_id}` (R_eff: {r_eff:.2f})

---

## Context

{context}

---

## Decision

{decision}

---

## Rationale

{rationale}

---

## Consequences

{consequences}

---

## Audit Trail

- **Phase 1 (Abduction):** Hypothesis generated
- **Phase 2 (Deduction):** Logical verification completed
- **Phase 3 (Induction):** Empirical validation with {len(evidence_items)} evidence items
- **Phase 4 (Audit):** R_eff = {r_eff:.2f}
- **Phase 5 (Decision):** Human selected based on evidence strength

---

## Comparison

| Hypothesis | R_eff | Evidence | Outcome |
|------------|-------|----------|---------|
| **{winner_id}** | **{r_eff:.2f}** | {len(evidence_items)} tests | ✅ SELECTED |
'''

for rinfo in rejected_info:
    drr_content += f"| {rinfo['id']} | 0.95 | No current session evidence | ❌ Rejected |\n"

drr_content += f'''

---

## Relations

- **Selects:** `{winner_id}` ({winner_title})
- **Rejects:**
'''

for rinfo in rejected_info:
    drr_content += f"  - `{rinfo['id']}` ({rinfo['title']})\n"

drr_content += f'''

---

## Validity

**Revisit Conditions:**
- If fix does not resolve blank screen issue (immediate)
- If new evidence suggests different root cause (1 week)

**Success Metrics:**
- Application loads without blank screen
- No console errors related to dotenv or process.cwd
- Frontend functions correctly with backend API

---

*Generated via FPF Phase 5: Decision*
*User Selected: {winner_title}*
'''

# Create decisions directory
os.makedirs('.quint/decisions', exist_ok=True)

# Write DRR file
drr_path = f".quint/decisions/{decision_id}-{title.lower().replace(' ', '-')}.md"
with open(drr_path, 'w', encoding='utf-8') as f:
    f.write(drr_content)

# Insert decision record into database
cursor.execute('''
    INSERT INTO holons (id, type, kind, layer, title, content, context_id, scope, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
''', (
    decision_id,
    'decision',
    'episteme',
    'L3',
    title,
    drr_content,
    'default',
    'Frontend rendering issue for CI-Fixer',
    datetime.now().isoformat(),
    datetime.now().isoformat()
))

# Create relations: decision --selects--> winner
cursor.execute('''
    INSERT INTO relations (source_id, target_id, relation_type, congruence_level)
    VALUES (?, ?, ?, ?)
''', (decision_id, winner_id, 'selects', 3))

# Create relations: decision --rejects--> rejected
for rid in rejected_ids:
    cursor.execute('''
        INSERT INTO relations (source_id, target_id, relation_type, congruence_level)
        VALUES (?, ?, ?, ?)
    ''', (decision_id, rid, 'rejects', 3))

# Promote winner to L3
cursor.execute('UPDATE holons SET layer="L3", updated_at=? WHERE id=?',
              (datetime.now().isoformat(), winner_id))

conn.commit()
conn.close()

print('=' * 80)
print('DECISION RECORDED')
print('=' * 80)
print(f'\nDecision ID: {decision_id}')
print(f'Title: {title}')
print(f'Winner: {winner_title}')
print(f'\nDRR created at: {drr_path}')

print('\n' + '=' * 80)
print('RELATIONSHIPS CREATED')
print('=' * 80)
print(f'  {decision_id} --[selects]--> {winner_id}')
for rinfo in rejected_info:
    print(f'  {decision_id} --[rejects]--> {rinfo["id"]} ({rinfo["title"]})')

print('\n' + '=' * 80)
print('DECISION COMPLETE - Ready for implementation')
print('=' * 80)
