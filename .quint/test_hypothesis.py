import sqlite3
import json
from datetime import datetime
import os
import uuid

# Parse command line arguments
import sys
if len(sys.argv) < 5:
    print("Usage: python test_hypothesis.py <hypothesis_id> <test_type> <result> <verdict>")
    sys.exit(1)

hypothesis_id = sys.argv[1]
test_type = sys.argv[2].lower()
result = sys.argv[3]
verdict = sys.argv[4].upper()

# Validate inputs
if test_type not in ["internal", "external"]:
    print(f"Error: Invalid test_type '{test_type}'. Must be 'internal' or 'external'")
    sys.exit(1)

if verdict not in ["PASS", "FAIL", "REFINE"]:
    print(f"Error: Invalid verdict '{verdict}'. Must be PASS, FAIL, or REFINE")
    sys.exit(1)

# Connect to database
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)
db_path = os.path.join(project_root, '.quint', 'quint.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Check if hypothesis exists and get current layer
cursor.execute('SELECT id, title, layer FROM holons WHERE id=?', (hypothesis_id,))
db_result = cursor.fetchone()

if not result:
    print(f"Error: Hypothesis '{hypothesis_id}' not found in database")
    conn.close()
    sys.exit(1)

current_id, title, current_layer = db_result

# Validate that hypothesis is L1 or L2
if current_layer not in ["L1", "L2"]:
    print(f"BLOCKED: Hypothesis '{hypothesis_id}' is at layer {current_layer}, not L1 or L2")
    print("You must run Phase 2 (q2-verify) before Phase 3 (q3-validate)")
    conn.close()
    sys.exit(1)

# Determine new layer based on current layer and verdict
if current_layer == "L1":
    if verdict == "PASS":
        new_layer = "L2"
    else:  # FAIL or REFINE
        new_layer = "L1"
else:  # L2 - refresh mode
    new_layer = "L2"  # Stay at L2, just add fresh evidence

# Update the hypothesis layer
cursor.execute('''
    UPDATE holons
    SET layer=?, updated_at=?
    WHERE id=?
''', (new_layer, datetime.now().isoformat(), hypothesis_id))

# Insert test/verification record
test_id = f"test-{hypothesis_id}-{uuid.uuid4().hex[:8]}"
test_content = json.dumps({
    "test_type": test_type,
    "result": result,
    "verdict": verdict,
    "timestamp": datetime.now().isoformat()
})

cursor.execute('''
    INSERT INTO holons (id, type, kind, layer, title, content, context_id, scope, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
''', (
    test_id,
    'test',
    'episteme',
    new_layer,
    f'Empirical Test of {title}',
    test_content,
    hypothesis_id,
    f'{test_type} validation test',
    datetime.now().isoformat(),
    datetime.now().isoformat()
))

conn.commit()
conn.close()

print(f"[OK] Empirical test recorded for: {hypothesis_id}")
print(f"  Title: {title}")
print(f"  Test Type: {test_type}")
print(f"  Verdict: {verdict}")
print(f"  Previous Layer: {current_layer}")
print(f"  New Layer: {new_layer}")
print(f"  Test ID: {test_id}")
