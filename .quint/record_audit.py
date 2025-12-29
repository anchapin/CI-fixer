import sqlite3
import json
from datetime import datetime
import os
import uuid

# Parse command line arguments
import sys
if len(sys.argv) < 3:
    print("Usage: python record_audit.py <hypothesis_id> <risks>")
    sys.exit(1)

hypothesis_id = sys.argv[1]
risks = sys.argv[2]

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
    print(f"Error: Hypothesis '{hypothesis_id}' not found")
    conn.close()
    sys.exit(1)

current_id, title, layer = result

# Create audit record
audit_id = f"audit-{hypothesis_id}-{uuid.uuid4().hex[:8]}"
audit_content = json.dumps({
    "hypothesis_id": hypothesis_id,
    "hypothesis_title": title,
    "layer": layer,
    "risks": risks,
    "timestamp": datetime.now().isoformat()
}, indent=2)

cursor.execute('''
    INSERT INTO holons (id, type, kind, layer, title, content, context_id, scope, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
''', (
    audit_id,
    'audit',
    'episteme',
    'L2',
    f'Audit of {title}',
    audit_content,
    hypothesis_id,
    'Risk assessment and bias check',
    datetime.now().isoformat(),
    datetime.now().isoformat()
))

conn.commit()
conn.close()

print(f"[OK] Audit recorded for: {hypothesis_id}")
print(f"  Title: {title}")
print(f"  Audit ID: {audit_id}")
print(f"  Risks: {risks}")
