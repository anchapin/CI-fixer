import { CodeFile, LogLine, AgentPhase, SimulationStep } from './types';

export const INITIAL_ERROR_LOG = `[2023-10-27 14:20:01] [INFO] Starting build pipeline #492...
[2023-10-27 14:20:03] [INFO] Checkout repository: main
[2023-10-27 14:20:05] [INFO] Setting up python environment 3.9
[2023-10-27 14:20:08] [INFO] Installing dependencies from requirements.txt
[2023-10-27 14:20:15] [INFO] Running unit tests...
[2023-10-27 14:20:16] [ERROR] Test Failed: tests/api/test_endpoints.py::test_create_user
[2023-10-27 14:20:16] [ERROR] Traceback (most recent call last):
  File "/app/tests/api/test_endpoints.py", line 24, in test_create_user
    response = client.post("/users", json={"username": "dev_agent"})
  File "/usr/local/lib/python3.9/site-packages/fastapi/testclient.py", line 12, in post
    return self.request("POST", url, **kwargs)
  File "/app/main.py", line 45, in create_user
    db.session.add(user)
  File "/usr/local/lib/python3.9/site-packages/sqlalchemy/orm/session.py", line 192, in add
    raise exc.ObjectDeletedError("Instance '%s' has been deleted." % state_str(state))
sqlalchemy.orm.exc.ObjectDeletedError: Instance '<User at 0x7f8b1c2d3a10>' has been deleted.
[2023-10-27 14:20:17] [FATAL] Build failed with exit code 1.`;

export const BROKEN_CODE: CodeFile = {
  name: "main.py",
  language: "python",
  content: `from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from . import models, schemas
from .database import get_db

app = FastAPI()

@app.post("/users", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = models.User(email=user.email, password=user.password)
    
    # Bug: We are adding, but then accidentally expiring the session 
    # or doing something that detaches the instance before commit in complex logic
    db.session.add(db_user)
    
    # SIMULATED ERROR: Premature flush causing detachment in this specific mock config
    db.session.flush() 
    db.session.expire_all() # <--- THE BUG: This expires the instance we just added
    
    db.session.commit()
    db.session.refresh(db_user)
    return db_user`
};

export const ATTEMPT_1_CODE: CodeFile = {
  name: "main.py",
  language: "python",
  content: `from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from . import models, schemas
from .database import get_db

app = FastAPI()

@app.post("/users", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = models.User(email=user.email, password=user.password)
    
    # ATTEMPT 1: Removing expire_all, but maybe missing commit?
    db.session.add(db_user)
    db.session.flush() 
    # db.session.expire_all() # Removed this
    
    # db.session.commit() # Wait, agent forgot to uncomment commit in first try?
    db.session.refresh(db_user)
    return db_user`
};

export const FIXED_CODE: CodeFile = {
  name: "main.py",
  language: "python",
  content: `from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from . import models, schemas
from .database import get_db

app = FastAPI()

@app.post("/users", response_model=schemas.User)
def create_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = models.User(email=user.email, password=user.password)
    
    # FIXED: Proper session handling
    db.session.add(db_user)
    
    # Removed manual flush and expire calls that were causing race conditions
    
    db.session.commit()
    db.session.refresh(db_user)
    return db_user`
};

export const SCENARIO_FAILURE_LOOP: SimulationStep[] = [
  { phase: AgentPhase.UNDERSTAND, message: "Analyzing traceback...", delay: 800 },
  { phase: AgentPhase.UNDERSTAND, message: "Identified `ObjectDeletedError` in `create_user`.", delay: 1000 },
  { phase: AgentPhase.PLAN, message: "Hypothesis 1: Session is expiring prematurely.", delay: 1200 },
  { phase: AgentPhase.PLAN, message: "Plan: Remove `expire_all()` call.", delay: 800 },
  { phase: AgentPhase.IMPLEMENT, message: "Applying patch to `main.py`...", delay: 1500, codeSnapshot: ATTEMPT_1_CODE },
  { phase: AgentPhase.VERIFY, message: "Running `pytest tests/api/test_endpoints.py`...", delay: 2000 },
  { phase: AgentPhase.FAILURE, message: "Verification Failed: Database transaction not committed.", delay: 1500, logAppend: { id: 'fail1', timestamp: new Date().toISOString(), level: 'ERROR', content: 'Test Failed: User not found in DB (Did you forget to commit?)' } },
  
  // RECURSION
  { phase: AgentPhase.PLAN, message: "Hypothesis 1 Failed. Re-evaluating...", delay: 1000 },
  { phase: AgentPhase.PLAN, message: "Hypothesis 2: `flush()` is unnecessary and `commit()` is missing.", delay: 1200 },
  { phase: AgentPhase.IMPLEMENT, message: "Refactoring session logic...", delay: 1500, codeSnapshot: FIXED_CODE },
  { phase: AgentPhase.VERIFY, message: "Running test suite...", delay: 2000 },
  { phase: AgentPhase.SUCCESS, message: "All tests passed (32/32).", delay: 1000, logAppend: { id: 'pass1', timestamp: new Date().toISOString(), level: 'SUCCESS', content: 'Tests Passed. Deployment ready.' } },
];