import sqlite3
import json
from datetime import datetime
import os
import uuid

# Parse command line arguments
import sys
if len(sys.argv) < 2:
    print("Usage: python calculate_r.py <holon_id>")
    sys.exit(1)

holon_id = sys.argv[1]

# Connect to database
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)
db_path = os.path.join(project_root, '.quint', 'quint.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Get hypothesis details
cursor.execute('SELECT id, title, layer, kind FROM holons WHERE id=?', (holon_id,))
result = cursor.fetchone()

if not result:
    print(f"Error: Holon '{holon_id}' not found")
    conn.close()
    sys.exit(1)

current_id, title, layer, kind = result

if layer != "L2":
    print(f"Warning: Holan '{holon_id}' is at layer {layer}, not L2")

# Fetch all related evidence (tests, verifications)
cursor.execute('''
    SELECT id, type, title, content FROM holons
    WHERE context_id=?
    ORDER BY created_at DESC
''', (holon_id,))

evidence = cursor.fetchall()

# Calculate R_eff using Trust Calculus (WLNK - Weakest Link Principle)
r_self = 0.95  # Base self-reliability score
evidence_scores = []

for ev_id, ev_type, ev_title, ev_content in evidence:
    try:
        content_dict = json.loads(ev_content) if ev_type == 'test' else {}
        verdict = content_dict.get('verdict', 'UNKNOWN')
        test_type = content_dict.get('test_type', 'unknown')

        # Score based on evidence type and verdict
        if verdict == "PASS":
            if test_type == "internal":
                score = 0.95  # Highest weight for internal tests
            else:  # external
                score = 0.75  # Lower weight for external research
        elif verdict == "FAIL":
            score = 0.30  # Low score for failed tests
        else:  # REFINE
            score = 0.50  # Medium score for refined hypotheses

        evidence_scores.append({
            'id': ev_id,
            'type': ev_type,
            'title': ev_title,
            'score': score,
            'test_type': test_type,
            'verdict': verdict
        })
    except json.JSONDecodeError:
        # For verification records that aren't JSON
        if 'PASS' in ev_content:
            score = 0.90
        else:
            score = 0.60
        evidence_scores.append({
            'id': ev_id,
            'type': ev_type,
            'title': ev_title,
            'score': score,
            'test_type': 'verification',
            'verdict': 'UNKNOWN'
        })

# Apply WLNK (Weakest Link) Principle
if evidence_scores:
    r_eff = min(r_self, min(e['score'] for e in evidence_scores))
    weakest_link = min(evidence_scores, key=lambda x: x['score'])
else:
    r_eff = r_self
    weakest_link = {'title': 'No evidence', 'score': r_self}

# Apply bias check
bias_score = "Low"
if kind == "system":
    # Check if this is a "pet idea" (recently created, minimal evidence)
    cursor.execute('SELECT created_at FROM holons WHERE id=?', (holon_id,))
    created_at = cursor.fetchone()[0]
    # Simple bias heuristic: created within last hour with < 2 evidence items
    if len(evidence_scores) < 2:
        bias_score = "Medium (Limited evidence)"

# Generate audit report
report = f"""
# R_eff Calculation Report

**Hypothesis:** {title}
**ID:** {holon_id}
**Layer:** {layer}
**Kind:** {kind}
**Generated:** {datetime.now().isoformat()}

---

## Effective Reliability (R_eff)

**R_eff = {r_eff:.2f}**

**Self Score (R_self):** {r_self:.2f}
**Weakest Link:** {weakest_link['title']} (score: {weakest_link['score']:.2f})

---

## Evidence Breakdown

"""

for i, ev in enumerate(evidence_scores, 1):
    report += f"""
### Evidence {i}: {ev['title']}
- **Type:** {ev['type']}
- **Test Type:** {ev.get('test_type', 'N/A')}
- **Verdict:** {ev.get('verdict', 'N/A')}
- **Score:** {ev['score']:.2f}
"""

report += f"""

---

## Trust Calculus Analysis

**Weakest Link Principle (WLNK):**
R_eff = min(R_self, evidence_scores) = min({r_self:.2f}, {min(e['score'] for e in evidence_scores) if evidence_scores else r_self:.2f})

**Result:** {r_eff:.2f}

**Bias Assessment:** {bias_score}

---

## Risk Factors

"""

if r_eff >= 0.90:
    report += "- [OK] **High Reliability:** Strong evidence base\n"
elif r_eff >= 0.75:
    report += "- [WARN] **Medium Reliability:** Moderate evidence, consider additional validation\n"
else:
    report += "- [FAIL] **Low Reliability:** Weak evidence base, high risk\n"

if weakest_link['score'] < 0.80:
    report += f"- [WARN] **Weakest Link:** {weakest_link['title']} has low score ({weakest_link['score']:.2f})\n"

conn.close()

print(report)
