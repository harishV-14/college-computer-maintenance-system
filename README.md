# College Computer Maintenance System

The College Computer Maintenance System (CCMS) is a role-based maintenance
portal for reporting, assigning, diagnosing, repairing, verifying, and
tracking computer equipment issues across college laboratories.

## Features

- Role-based access for Students, Faculty, Technicians, and Administrators
- Server-side authentication with salted password hashes
- Secure session cookies with expiration and optional Remember me support
- SQLite-backed complaint, laboratory, computer, notification, and history data
- Technician diagnosis and repair workflow
- Faculty verification before a repair can be resolved
- Administrative assignment, escalation, overdue handling, and reporting
- Responsive interface for desktop and mobile browsers

## Requirements

- Python 3.9 or newer
- A modern web browser
- No third-party Python packages or internet connection required

## Installation and startup

1. Open a terminal in the project directory.
2. Start the application:

```bash
python server.py
```

3. Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser.

Do not open `index.html` directly. The application uses the same-origin API
provided by `server.py` for authentication and data persistence.

On the first startup, the server creates `ccms.db` beside `index.html`. Seed
records are created only when the database is empty and are not overwritten on
later startups.

## Deployment on Render

This repository includes a `render.yaml` blueprint for deploying the existing
Python server as a Render web service. In the Render dashboard, choose
**New > Blueprint**, connect this repository, and apply the blueprint. Render
provides the `PORT` environment variable automatically; the server binds to
`0.0.0.0` in that environment.

The SQLite database is stored on the service filesystem. On plans without a
persistent disk, database changes can be lost when the service is redeployed or
restarted. Use a persistent disk or migrate the state to a managed database
before production use.

## Demonstration accounts

The following accounts are for local demonstration only. Every account uses
the password:

**`demo-ccms-2026`**

| Email | Role | Responsibility |
|---|---|---|
| `student@college.edu` | Student | Report issues and track personal complaints |
| `faculty@college.edu` | Faculty | Review laboratory issues and verify repairs |
| `tech@college.edu` | Technician | Diagnose and repair assigned equipment |
| `tech2@college.edu` | Technician | Diagnose and repair assigned equipment |
| `admin@college.edu` | Admin | Manage users, assignments, escalations, and reports |

The login form determines the role from the authenticated account. It does not
accept a client-selected role.

## Application structure

| Path | Description |
|---|---|
| `index.html` | Frontend application shell |
| `css/style.css` | Layout, responsive styles, and accessibility states |
| `js/app.js` | Frontend views, navigation, and API client |
| `server.py` | Standard-library HTTP server, API, authentication, authorization, and SQLite persistence |
| `ccms.db` | Local SQLite database created during first startup |

## Maintenance workflow

1. A student reports a computer issue.
2. The issue is recorded and assigned to the responsible technician.
3. The technician diagnoses the issue.
4. The technician records the repair and parts used.
5. Faculty verifies whether the repair corrected the issue.
6. Correctly repaired equipment is marked resolved.
7. Failed verification or overdue work is escalated to administration.

## Security and data handling

- Passwords are stored as salted PBKDF2-HMAC-SHA256 hashes.
- Password hashes and session secrets are never returned to the frontend.
- Sessions use cryptographically random, HttpOnly, SameSite cookies.
- Sessions expire automatically; Remember me is unchecked by default.
- State-changing requests require CSRF validation.
- Login attempts are throttled after repeated failures.
- Authorization is enforced on the server for each role and workflow action.
- Database queries use parameterized SQL.

## Limitations and support

- Password recovery is not implemented. Contact the college administrator.
- Sessions are held in server memory and expire when the server process stops.
- Existing browser `localStorage` data is not migrated or deleted. Sign in to
  the SQLite-backed application instead.
- The demonstration password should be changed before any non-demo deployment.
