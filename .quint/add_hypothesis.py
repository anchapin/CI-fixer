import sqlite3
import json
from datetime import datetime
import uuid

# Parse command line arguments
import sys
if len(sys.argv) < 6:
    print("Usage: python add_hypothesis.py <title> <content> <scope> <kind> <rationale_json>")
    sys.exit(1)

title = sys.argv[1]
content = sys.argv[2]
scope = sys.argv[3]
kind = sys.argv[4]
rationale_json = sys.argv[5]

# Generate unique ID
holon_id = f"{title.lower().replace(' ', '-')}-{uuid.uuid4().hex[:8]}"

# Connect to database (use absolute path from project root)
import os
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(script_dir)
db_path = os.path.join(project_root, '.quint', 'quint.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Insert the hypothesis
cursor.execute('''
    INSERT INTO holons (id, type, kind, layer, title, content, context_id, scope, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
''', (
    holon_id,
    'hypothesis',
    kind,
    'L0',
    title,
    content,
    'default',
    scope,
    datetime.now().isoformat(),
    datetime.now().isoformat()
))

conn.commit()
conn.close()

print(f"Hypothesis created: {holon_id}")
print(f"Title: {title}")
print(f"Kind: {kind}")
print(f"Layer: L0")
