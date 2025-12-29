import sqlite3
import json
from datetime import datetime
import os
import uuid

# Parse command line arguments
import sys
if len(sys.argv) < 3:
    print("Usage: python verify_hypothesis.py <hypothesis_id> <checks_json> <verdict>")
    sys.exit(1)

hypothesis_id = sys.argv[1]
checks_json = sys.argv[2]
verdict = sys.argv[3].upper()

# Validate verdict
if verdict not in ["PASS", "FAIL", "REFINE"]:
    print(f"Error: Invalid verdict '{verdict}'. Must be PASS, FAIL, or REFINE")
    sys.exit(1)

# Connect to database
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)
db_path = os.path.join(project_root, '.quint', 'quint.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Check if hypothesis exists
cursor.execute('SELECT id, title, layer FROM holons WHERE id=?', (hypothesis_id,))
result = cursor.fetchone()

if not result:
    print(f"Error: Hypothesis '{hypothesis_id}' not found in database")
    conn.close()
    sys.exit(1)

current_id, title, current_layer = result

if current_layer != 'L0':
    print(f"Warning: Hypothesis '{hypothesis_id}' is already at layer {current_layer}")

# Update based on verdict
if verdict == "PASS":
    new_layer = "L1"
    status = "substantiated"
elif verdict == "FAIL":
    new_layer = "invalid"
    status = "rejected"
else:  # REFINE
    new_layer = "L0"
    status = "needs_refinement"

# Update the hypothesis
cursor.execute('''
    UPDATE holons
    SET layer=?, updated_at=?
    WHERE id=?
''', (new_layer, datetime.now().isoformat(), hypothesis_id))

# Insert verification record
verification_id = f"verify-{hypothesis_id}-{uuid.uuid4().hex[:8]}"
cursor.execute('''
    INSERT INTO holons (id, type, kind, layer, title, content, context_id, scope, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
''', (
    verification_id,
    'verification',
    'episteme',
    'L1',
    f'Verification of {title}',
    checks_json,
    hypothesis_id,
    'Logical verification checks',
    datetime.now().isoformat(),
    datetime.now().isoformat()
))

conn.commit()
conn.close()

print(f"[OK] Verification recorded for: {hypothesis_id}")
print(f"  Title: {title}")
print(f"  Verdict: {verdict}")
print(f"  New Layer: {new_layer}")
print(f"  Verification ID: {verification_id}")
