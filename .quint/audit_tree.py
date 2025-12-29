import sqlite3
import json
from datetime import datetime
import os
import sys

if len(sys.argv) < 2:
    print("Usage: python audit_tree.py <holon_id>")
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

# Fetch all related evidence
cursor.execute('''
    SELECT id, type, title, content, kind FROM holons
    WHERE context_id=?
    ORDER BY created_at ASC
''', (holon_id,))

evidence = cursor.fetchall()

# Calculate R_eff (simplified version)
r_self = 0.95
evidence_scores = []
for ev_id, ev_type, ev_title, ev_content, ev_kind in evidence:
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

conn.close()

# Generate ASCII tree
print(f"\n{'=' * 80}")
print(f"AUDIT TREE: {title}")
print(f"{'=' * 80}\n")

print(f"[R:{r_eff:.2f}] {title} ({layer}, {kind})")
print("|")

for i, (ev_id, ev_type, ev_title, ev_content, ev_kind) in enumerate(evidence):
    try:
        content_dict = json.loads(ev_content) if ev_type == 'test' else {}
        verdict = content_dict.get('verdict', 'UNKNOWN')
        test_type = content_dict.get('test_type', 'unknown')

        if verdict == "PASS":
            score = 0.95 if test_type == "internal" else 0.75
            cl = "CL:3" if test_type == "internal" else "CL:2"
        elif verdict == "FAIL":
            score = 0.30
            cl = "CL:3"
        else:
            score = 0.50
            cl = "CL:3"
    except:
        score = 0.60
        cl = "CL:3"
        verdict = "UNKNOWN"
        test_type = "verification"

    is_last = (i == len(evidence) - 1)
    prefix = "`" if is_last else "|"
    branch = "+" if is_last else "+"

    print(f"{prefix}-- [R:{score:.2f}] ({ev_type}) {ev_title}")
    print(f"|    |-- Verdict: {verdict}")
    print(f"|    |-- Type: {test_type}")
    print(f"|    `-- Congruence: {cl}")

    if not is_last:
        print("|")

print(f"\n{'=' * 80}")
print(f"Weakest Link: R_eff = {r_eff:.2f}")
print(f"{'=' * 80}\n")
